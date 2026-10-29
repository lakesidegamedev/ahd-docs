# China (CN), System Design

Player guide: [China](https://www.ahousedividedgame.com/wiki/cn-overview)

## Summary

China is modelled as a one-party state (`governmentType: "onePartyState"`, `src/lib/countries/cn/institutionsFacts.ts`). The Chinese Communist Party (CCP, code id `ccp`) dominates government formation, bill passage, and executive appointment. Other parties (CDL, CNDCA) participate in the CPPCC advisory body and can hold NPC seats but are gated from forming governments or fielding premier candidates. This page says CCP throughout; the party is the same one the older notes call CPC.

Three systems make China different from the parliamentary countries: a set of one-party gates, a leader confidence model that replaces the confidence vote, and a regional budget with a central transfer and austerity. Seven macro-regions replace the 31 provincial-level divisions.

## Rules

### Legislature

**National People's Congress (NPC)**: 2,980 seats in the modern preset and 1,226 in `1953-default`, organised across 7 geographic macro-regions. Each region runs one multi-seat `npcDelegate` race using Hare-quota PR (`lowerChamber: "pr_hareQuota"`, `src/lib/countries/cn/institutionsFacts.ts`).

**CPPCC** (2,169 seats): advisory body only. Not elected. Not part of the player legislative loop. Seats are seeded per-region but have no turn-engine mechanics.

### Executive

**Premier** (head of government): appointed via parliamentary confidence vote, gated by one-party constraints so only the CCP can form a government or field a candidate. The ceremonial President is synchronized to the CCP chair through `syncPartyChairHeadOfState` (`src/lib/turn/partyChairHeadOfState.ts`), driven by `headOfStateSelection: "partyChairSync"`.

### One-Party Constraints

File: `src/lib/turn/onePartyConstraints.ts`. The gates read `PoliticalParty.regimeStatus` (`ruling`, `approved` or `banned`), so they work for any country with `governmentType: "onePartyState"`.

| Operation                             | Gate                | Function                        |
| ------------------------------------- | ------------------- | ------------------------------- |
| Form government                       | CCP only            | `canFormGovernment`             |
| Field premier candidate               | CCP only            | `canFieldExecutiveCandidate`    |
| Trigger VONC                          | Disabled by default | `canTriggerNoConfidence`        |
| Invite to coalition                   | CCP only            | `canInviteToCoalition`          |
| Government collapse on coalition loss | Disabled            | `canCollapseGovernment`         |

China inherits `confidenceVoteMechanism: false` from the one-party-state government-type default (`src/lib/constants/countriesCore.ts`). It does not override that field in its country config. `canTriggerNoConfidence` still limits movers to the ruling party as a defence-in-depth gate if the mechanism is enabled later.

Legislative candidates: ruling and approved parties may file, banned parties and independents may not (`canFieldLegislativeCandidate`, the last gate in the same file). Executive offices (`premier`, `president`, plus the legacy key `npcPremier`) are ruling party only. Vote weight per candidate comes from `resolveRegimeMultiplier`, which reads `DEFAULT_OPS_VOTE_MULTIPLIERS` in `src/lib/constants/countriesCore.ts` unless the country sets `opsVoteMultipliers`:

| Regime status | Default multiplier |
| --- | --- |
| `ruling` | 3.0 |
| `approved` | 0.375 |
| independent (no party) | 0.0 |
| `banned` | 0.0 |

### CCP Confidence Model

Files: `src/lib/onePartyState/rulingPartyPriorities.ts` (re-exported from `src/lib/turn/rulingPartyPriorities.ts`), `src/lib/onePartyState/rulingPartyConfidence.ts` (re-exported from `src/lib/turn/rulingPartyConfidence.ts`), `src/lib/turn/rulingPartyConfidenceTurn.ts`.

The subsystem is country-agnostic, the priority profile and policy-axis effects map for CN live on `COUNTRY_CONFIGS.CN.priorityProfile` and `COUNTRY_CONFIGS.CN.policyAxisEffects` (`src/lib/countries/cn/institutionsFacts.ts`). See [`ruling-party-confidence.md`](./ruling-party-confidence.md) for the generic design; this section describes CN's specific profile.

Each turn, enacted bills are scored against the CCP's 9-axis priority profile. The score drives leader confidence drift. Why a confidence model at all: in a one-party state the premier cannot lose a legislative vote, so something has to make bad governance cost the leader; confidence is that cost.

| Axis id | Name | Weight |
| --- | --- | --- |
| `party_control` | Party Control | 0.20 |
| `social_stability` | Social Stability | 0.15 |
| `economic_growth` | Economic Growth | 0.15 |
| `state_sector` | State-Sector Strength | 0.12 |
| `industrial_policy` | Industrial Policy | 0.12 |
| `national_security` | National Security | 0.12 |
| `regional_balance` | Regional Balance | 0.07 |
| `market_openness` | Managed Market Openness | 0.04 |
| `anti_corruption` | Anti-Corruption Legitimacy | 0.03 |

| Constant | Value | Source |
| --- | --- | --- |
| `INITIAL_CONFIDENCE` | 75 | `src/lib/onePartyState/rulingPartyConfidence.ts` |
| `MAX_CONFIDENCE` | 95 | `src/lib/onePartyState/rulingPartyConfidence.ts` |
| `MIN_CONFIDENCE` | 0 | `src/lib/onePartyState/rulingPartyConfidence.ts` |
| `RENEWAL_BUMP` | 5 | `src/lib/onePartyState/rulingPartyConfidence.ts` |
| `MAX_HISTORY_ENTRIES` | 50 | `src/lib/onePartyState/rulingPartyConfidence.ts` |
| `PURGE_SEVERITY_DELTA` | minor -2, regional -4, senior -7, faction -10, extreme -15 | `src/lib/onePartyState/rulingPartyPriorities.ts` |

Formulas (`src/lib/onePartyState/rulingPartyPriorities.ts`):

```
weightedSum = sum(effect.delta x axis.weight)       over the category's axis effects
totalWeight = sum(axis.weight)                      over the same axes
score       = clamp(round(weightedSum / (totalWeight x 50) x 100), -100, 100)

scoreToTurnDelta(score):
  score >= 40        -> +1
  10 <= score < 40   -> 0   (+0.25 only when fractional mode is requested; the turn does not request it)
  -9 <= score < 10   -> 0
  -39 <= score < -9  -> -1
  score <= -40       -> max(-4, round(score / 20))

popularBleed(popularLegitimacy):  >= 30 -> 0;  15 to <30 -> -0.25;  < 15 -> -0.5
totalDelta = sum(policy deltas) + sum(unprocessed purge deltas) + popularBleed
```

A category with no entry in the effects map uses the `default` entry, which is empty, so it scores 0.

Each turn `processRulingPartyConfidenceTurn` finds the leader in `governmentFormations`, reads the leader's confidence state, computes drift with `computeTurnDrift` (enacted policy categories, unprocessed purge events, and the leader's popular legitimacy), then applies it through `adjustLeaderConfidence`, which clamps to 0 to 95. If there is no leader or no confidence state yet, the turn does nothing for that country.

Low confidence has consequences (`getConfidenceConsequenceLevel`): below 50 `discipline_loss`, below 35 `challenge_risk`, below 25 `appointment_resistance`, below 15 `forced_crisis`. The display bands (`CONFIDENCE_BANDS`) are secure 80, stable 65, watchful 50, strained 35, crisis 20, critical 0.

### Regional Budget

File: `src/lib/countries/cn/cnRegionalBudget.ts`

**Revenue sources per region** (constants in `COUNTRY_CONFIGS.CN.onePartyRegionalBudget`, `src/lib/countries/cn/institutionsFacts.ts`):

1. **EIT local share** (企业所得税地方分成): 40% of Enterprise Income Tax collected in-territory. Derived from enacted `cn_enterprise_income_tax` rate x regional GDP x 6% corporate profit ratio. Defaults to 25% EIT if not enacted.
2. **Central transfer grant** (中央转移支付): Finance Minister (`CN_minister_of_finance` cabinet setting) sets allocation percentages. Defaults to an equal 1/7th split of a national pool sized by `centralTransferPerCapita: 35` x national population, a flat per-capita figure, not the generic 4,000 default used elsewhere. Era overrides (e.g. the 1953 seed) rescale it further (`centralTransferPerCapita: 2.77`).
3. **Provincial resource tax** from the enacted `cn_provincial_resource_tax` policy.
4. **Standing business tax** at 24% of the configured 0.50 GDP consumption base. Always collected, not gated on enactment, so regions are reliably self-funding.

| Constant | Value | Source |
| --- | --- | --- |
| `localTaxRetentionShare` | 0.4 | `src/lib/countries/cn/institutionsFacts.ts` |
| `corporateProfitRatio` | 0.06 | `src/lib/countries/cn/institutionsFacts.ts` |
| `centralTransferPerCapita` (modern) | 35 | `src/lib/countries/cn/institutionsFacts.ts` |
| `centralTransferPerCapita` (`1953-default`) | 2.77 | `src/lib/countries/cn/eras/1953.ts` |
| `centralTransferPerCapita` (pure-function fallback only) | 4,000 | `src/lib/countries/cn/cnRegionalBudget.ts` |
| `defaultTaxRate` (EIT when none enacted) | 25 | `src/lib/countries/cn/institutionsFacts.ts` |
| `resourceExtractionRatio` | 0.03 | `src/lib/countries/cn/institutionsFacts.ts` |
| `businessTaxConsumptionRatio` | 0.5 | `src/lib/countries/cn/institutionsFacts.ts` |
| `businessTaxRate` | 24 | `src/lib/countries/cn/institutionsFacts.ts` |
| Primary tax key | `cn_enterprise_income_tax` | `src/lib/countries/cn/institutionsFacts.ts` |
| Resource tax key | `cn_provincial_resource_tax` | `src/lib/countries/cn/institutionsFacts.ts` |

Formulas, all in `calculateCNRegionalBudget` (`src/lib/countries/cn/cnRegionalBudget.ts`), with `regionGdp` in millions of CNY:

```
eitShare        = regionGdp x 1,000,000 x corporateProfitRatio x (eitRate / 100) x localTaxRetentionShare
centralTransfer = ministerAllocation ?? (centralTransferPerCapita x nationalPopulation) / regionCount
resourceTax     = regionGdp x 1,000,000 x resourceExtractionRatio x (resourceTaxRate / 100)
businessTax     = regionGdp x 1,000,000 x businessTaxConsumptionRatio x (businessTaxRate / 100)
totalBudget     = eitShare + centralTransfer + resourceTax + businessTax
surplus         = totalBudget - enactedBillCosts
```

`ministerAllocation` for a region is `(allocationPercents[region] / 100) x centralTransferPerCapita x nationalPopulation`; a region the Finance Minister leaves unset gets `100 / regionCount` percent. `enactedBillCosts` is the sum of each enacted option's `annualCostPerCapita` times the region's population, plus the region's annual subsidy cost. The national pool is therefore fixed by population; the Finance Minister only changes how it is split.

Quick example: a region with `regionGdp` 1,000,000 (million CNY), 25% EIT, gets `1,000,000 x 1,000,000 x 0.06 x 0.25 x 0.4` = 6.0 billion CNY of EIT share, plus `1,000,000 x 1,000,000 x 0.5 x 0.24` = 120 billion CNY of business tax, plus its transfer share. The full trace is in Worked trace below.

**Austerity**: `turnsOverBudget` increments each processed turn with `surplus < 0` and resets to 0 otherwise. When it exceeds 1 (a second consecutive deficit) and the region has at least one enacted policy, the policy with the highest per-capita cost is moved down one option index, matching UK and JP behaviour. A policy already at its cheapest option (index 0), or with zero cost, is left alone.

**Provincial spending bills**: The provincial-scope legislation (`cn_provincial_education`, `cn_provincial_public_security`, `cn_provincial_economic_development`, `cn_provincial_health_services`, `cn_provincial_culture_propaganda`, `cn_provincial_environmental_policy`, `cn_provincial_infrastructure_investment`) all carry `annualCostPerCapita` on their policy options, so each region's enacted spending is summed against revenue to drive the austerity check. Regions default to the statutory baseline (center option) on seed; provincial People's Congress legislation moves them.

### Regions

7 macro-regions replace 31 provincial-level divisions for gameplay (`src/lib/constants/cn.ts`), named with pinyin, not English:

| Code | Pinyin name | English gloss   |
| ---- | ----------- | --------------- |
| DB   | Dongbei     | Northeast       |
| HB   | Huabei      | North (Beijing) |
| HD   | Huadong     | East (Shanghai) |
| HZ   | Huazhong    | Central (Wuhan) |
| HN   | Huanan      | South           |
| XN   | Xinan       | Southwest       |
| XB   | Xibei       | Northwest       |

Total NPC seats: 2,980 (`TOTAL_CN_NPC_SEATS`). Total CPPCC seats: 2,169 (`seats` on the CPPCC entry in `src/lib/constants/countryClientConfig.ts`). Provincial People's Congress seats total 4,000 (`TOTAL_CN_PEOPLES_CONGRESS_SEATS`; 3,781 in 1953, `TOTAL_CN_PEOPLES_CONGRESS_SEATS_1953`).

NPC seats per region, modern apportionment (`CN_NPC_SEATS`, `src/lib/constants/states.ts`):

| Region | DB | HB | HD | HZ | HN | XN | XB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Modern | 238 | 323 | 922 | 395 | 316 | 466 | 320 |
| `1953-default` (`CN_NPC_SEATS_1953`) | 88 | 129 | 379 | 215 | 118 | 219 | 78 |

The 1953 total is 1,226 (`TOTAL_CN_NPC_SEATS_1953`). Why 7 regions: 31 provincial-level divisions would give 31 separate budgets, elections and policy tables for one country; seven macro-regions keep the per-turn cost and the number of races a player must follow manageable.

### Elections

Each 5-year cycle includes one multi-seat `npcDelegate` PR race per region, a matching regional `peoplesCongress` race, and a regional `governor` race. NPC and People's Congress races run 48 hours (`npcDelegate: durationHours 48`, 24 primary plus 24 general; `peoplesCongress` the same, in `src/lib/constants/electionDurations.ts`). The CPPCC is appointed rather than elected, and China has no snap elections. Races are scheduled by `ensureCNElections` (`src/lib/countries/cn/elections/perpetual.ts`), with all seats of a region contested together; its siblings `ensureCNPeoplesCongressElections` and `ensureCNGovernorElections` in the same file schedule the other two, the People's Congress cycle anchored to the NPC end turn so both fire on the same turn.

## Data

| Collection | Fields read or written | Player-visible |
| --- | --- | --- |
| `governmentFormations` | read: current leader reference | yes (government pages) |
| `countryLeaderStates` | read and written: `partyConfidence`, `confidenceHistory` (last 50 entries), `popularLegitimacy`, `updatedAt` | yes, as the confidence band on the leader page |
| `states` | read: `gdp`, `population` per macro-region | yes |
| `statePolicies` | read: enacted regional and `cn_national` rows; written by austerity: `policyOptionId`, `policyOptionIndex`, `economic`, `social`, `effectDirection` | yes |
| `legislationTypes` | read: `policyOptions` (`rate`, `annualCostPerCapita`) | yes |
| `cabinetSettings` | read: `CN_minister_of_finance` `allocationPercents` | yes |
| `regionalBudgets` | written (upsert per region): `eitShare`, `centralTransferGrant`, `resourceTaxRevenue`, `businessTaxRevenue`, `totalBudget`, `enactedBillCosts`, `subsidyCosts`, `surplus`, `isOverBudget`, `turnsOverBudget`, `chancellorAllocation`, `turn`, `updatedAt` | yes |
| `PoliticalParty.regimeStatus` | read by the one-party gates | partly (party status) |

The budget write also sets the UK-shape fields `councilTaxRevenue`, `businessRatesRevenue`, `westminsterGrant` and the value baselines to 0, and `$unset`s the JP, DE and RU fields (`residentTaxRevenue`, `fixedAssetTaxRevenue`, `nationalGrant`, `incomeTaxShare`, `vatShare`, `federalEqualizationGrant`, `tradeTaxRevenue`, `unionGrant`) so a document never carries two country shapes.

## Configuration

| Setting | Default | Set in |
| --- | --- | --- |
| `governmentType` | `onePartyState` | `src/lib/countries/cn/institutionsFacts.ts` |
| `confidenceVoteMechanism` | false (government-type default) | `src/lib/constants/countriesCore.ts` |
| `headOfStateSelection` | `partyChairSync` | `src/lib/countries/cn/institutionsFacts.ts` |
| `opsVoteMultipliers` | unset, falls back to `DEFAULT_OPS_VOTE_MULTIPLIERS` (3.0 / 0.375 / 0 / 0) | `src/lib/constants/countriesCore.ts` |
| `onePartyRegionalBudget` | the constants table in Rules | `src/lib/countries/cn/institutionsFacts.ts` |
| `priorityProfile`, `policyAxisEffects` | 9 axes above, per-category effects map | `src/lib/countries/cn/institutionsFacts.ts` |
| `hasLeaderConfidenceModel` | true | `src/lib/countries/cn/institutionsFacts.ts` |
| `1953-default` preset | `centralTransferPerCapita: 2.77`, 1,226 NPC seats | `src/lib/countries/cn/eras/1953.ts`, `src/lib/countries/cn/eras/index.ts` |
| `AHD_REGIONAL_BUDGET_EVERY_TURNS` | unset, so 2 (valid 1 to 4; anything else falls back to 2) | `src/simulation/phases/regionalBudgetCadence.ts` |

Only the 1953 era overrides `onePartyRegionalBudget`; every other CN era uses the modern values.

## Timing

- **`cnBillLifecycle`** (country phase, `src/lib/turn/countryPhases.ts`): runs `processCNBillLifecycle`, which enacts or fails NPC bills and then calls `processRulingPartyConfidenceTurn` for CN with the categories of the bills just enacted. Confidence therefore moves in the same turn a bill passes.
- **`cnElections`** (country phase, same file): `ensureCNElections` creates or maintains the regional NPC races. `cnPeoplesCongressElections` does the same for the People's Congress.
- **`cnRegionalBudgetProcessing`** (inside `stateEffectsPhase`, `src/simulation/phases/stateEffectsPhase.ts`): runs `processAllOnePartyRegionalBudgets`. It is gated by `regionalBudgetPhaseDue` and runs every second turn by default (`REGIONAL_BUDGET_EVERY_TURNS = 2` in `src/simulation/phases/regionalBudgetCadence.ts`), in slot 1 alongside Japan, offset from the UK and DE phases (slot 0). The cadence can be overridden between 1 and 4 turns by environment.
- Regional budgets run after `subsidyBudget` and `regionalBudgetProcessing` in the base phase list (`src/simulation/phases/turnPhaseNames.ts`), so subsidy costs are current when the deficit check reads them.

```
country phases:  cnBillLifecycle (enact bills -> confidence drift)   cnElections / cnPeoplesCongressElections
state effects:   subsidyBudget -> regionalBudgetProcessing -> cnRegionalBudgetProcessing (odd turns only by default)
```

## Worked trace

Confidence drift. A CN leader sits at `partyConfidence` 75 with `popularLegitimacy` 25. This turn one bill in the `market-liberalization` category is enacted and no purge is pending.

1. Axis effects: `state_sector` -40, `party_control` -20, `economic_growth` +30, `market_openness` +25.
2. `weightedSum` = -40 x 0.12 + -20 x 0.20 + 30 x 0.15 + 25 x 0.04 = -4.8 - 4.0 + 4.5 + 1.0 = -3.3.
3. `totalWeight` = 0.12 + 0.20 + 0.15 + 0.04 = 0.51.
4. `score` = round(-3.3 / (0.51 x 50) x 100) = round(-12.94) = -13.
5. `scoreToTurnDelta(-13)`: in -39 to -10, so -1.
6. Popular bleed at legitimacy 25 (15 to under 30): -0.25. Purge delta 0.
7. `totalDelta` = -1 - 0 - 0.25 = -1.25. New confidence = clamp(75 - 1.25, 0, 95) = 73.75, written to `countryLeaderStates` with a history entry.

Regional budget. Seven regions, national population 1,000,000,000, one region with `regionGdp` 1,000,000 (million CNY) and population 150,000,000, EIT enacted at 25, resource tax not enacted, no Finance Minister split, no subsidies.

1. `eitShare` = 1e12 x 0.06 x 0.25 x 0.4 = 6.0e9.
2. `centralTransfer` = 35 x 1e9 / 7 = 5.0e9.
3. `resourceTax` = 0 (rate 0).
4. `businessTax` = 1e12 x 0.5 x 0.24 = 1.2e11.
5. `totalBudget` = 6.0e9 + 5.0e9 + 0 + 1.2e11 = 1.31e11.
6. One enacted option costs 400 per capita: `enactedBillCosts` = 400 x 150,000,000 = 6.0e10. `surplus` = 7.1e10, so `turnsOverBudget` stays 0.
7. If that option cost 1,000 per capita instead, costs are 1.5e11 and `surplus` is -1.9e10: `turnsOverBudget` becomes 1, nothing happens. On the next processed turn in deficit it becomes 2 and the most expensive policy drops one option index.

## Edge cases and limits

- Confidence is clamped to 0 to 95. A leader with no confidence state yet is skipped, not created, by the turn (the later `adjustLeaderConfidence` call would self-heal a missing row, but the turn returns before reaching it).
- A region with no `gdp` is treated as 0, so its EIT, resource and business tax are 0 and only the central transfer funds it.
- If `onePartyRegionalBudget` is absent from a country config, `processOnePartyRegionalBudgets` returns 0 regions processed rather than falling back to defaults.
- The code does not normalise Finance Minister percentages: a region's grant is its stated percent of the fixed pool, so percentages summing above 100 pay out more than the pool.
- If no EIT policy is enacted, or its option has no rate, the rate falls back to `defaultTaxRate` 25. The fallback uses `||`, so an enacted rate of exactly 0 also becomes 25 in the live processor.
- `canCollapseGovernment` always returns false in a one-party state, so losing seats can never topple the government. Regime change runs through the separate conversion path in the confidence system, not through coalition loss.
- Austerity never touches a policy with zero cost, and cannot downgrade below the first option. It moves one policy per region per processed turn.
- Banned parties and independents get a 0.0 vote multiplier and cannot file for legislative seats.
- Deliberately excluded: CPPCC seats have no turn mechanics, and China has no snap elections.

## Invariants

- Confidence stays within 0 to 95: enforced by `clampConfidence` and covered in `src/lib/turn/rulingPartyConfidence.test.ts`.
- Confidence history never exceeds 50 entries: `trimHistory` with `MAX_HISTORY_ENTRIES`; persistence behaviour in `src/lib/turn/rulingPartyConfidence.persistence.test.ts`.
- NPC seats sum to 2,980 (modern) and 1,226 (1953): `src/lib/constants/cnSeats.era.test.ts` and `src/lib/constants/historicalSeats.cn.test.ts`.
- A regional budget document carries exactly one country shape: the `$unset` in the upsert; no dedicated test beyond `src/lib/turn/onePartyRegionalBudgetShape.test.ts`.
- The Finance Minister split summing to 100 percent: not enforced.
- `totalBudget` equals the sum of its four revenue legs: by construction in `calculateCNRegionalBudget`, spot-checked in `src/lib/turn/cnRegionalBudget.test.ts`.

## Failure and recovery

- **No confidence state for a leader** (for example an admin-formed government): the turn skips the country and confidence stops moving. Other reform actions self-heal the row; the next leader installation writes the full state.
- **Stale or mixed-shape budget documents** after a country changes budget model: readers could resolve the old shape. The CN processor clears the other shapes on every write, so a rerun of the phase repairs it.
- **Regional budgets look a turn late**: expected, since the phase runs every second turn by default. Setting the cadence to 1 restores every-turn processing without a deploy.
- **Seat counts wrong for an era**: history of this class of bug is in the seat constants above; a reseed with the correct preset repairs the chamber.
- Budget and confidence values are recomputed from enacted laws each processed turn, so a rerun after a data fix converges without manual edits, apart from policies already moved down by austerity.

## Connections

**Driven by:**

- [Bills and legislation](./bills-legislation.md): enacted NPC bills feed the confidence drift (`processCNBillLifecycle` in `src/lib/turn/onePartyBillLifecycle.ts`); enacted provincial bills set regional spending (`annualCostPerCapita`) and tax rates (`getTaxRateFromPolicy`).
- [Ruling-party confidence](./ruling-party-confidence.md): the generic confidence subsystem this page configures.
- [One-party states as shipped](./one-party-states-as-shipped.md): the shared one-party surface China is one instance of.
- Cabinet settings: the `CN_minister_of_finance` setting sets the central transfer split.

**Affects:**

- [Coalitions](./coalitions.md): `canInviteToCoalition` limits coalition invites to the ruling party.
- [Parties](./parties.md): `canFormGovernment`, `canFieldExecutiveCandidate` and legislative candidate filing gate which parties can compete.
- Regional policy: austerity rewrites `statePolicies` options when a region is in sustained deficit.

## Tests

- `src/lib/turn/onePartyConstraints.test.ts`, `src/lib/turn/onePartyConstraints.parliamentary.test.ts`: the gates.
- `src/lib/turn/rulingPartyPriorities.test.ts`, `src/lib/turn/rulingPartyConfidence.test.ts`, `src/lib/turn/rulingPartyConfidence.persistence.test.ts`, `src/lib/turn/rulingPartyConfidenceTurn.test.ts`: scoring, clamping, persistence and the per-turn driver.
- `src/lib/turn/cnRegionalBudget.test.ts`, `src/lib/turn/onePartyRegionalBudgetShape.test.ts`: the budget math and document shape.
- `src/lib/turn/perpetualElections.cn.test.ts`, `src/lib/constants/cnSeats.era.test.ts`, `src/lib/constants/historicalSeats.cn.test.ts`: election scheduling and seat counts.
- Gaps: no test found for the EIT `||` fallback with an enacted 0% rate, and no CN test exercises the austerity downgrade (the austerity tests found cover the UK, RU and DD processors).

## Known issues and history

- The header comment of `src/lib/countries/cn/cnRegionalBudget.ts` still says the budget runs "every turn"; the live cadence is every second turn.
- The EIT fallback treats an enacted 0% rate as "not enacted" (see Edge cases).
- `CONFIDENCE_CONSEQUENCE_DESCRIPTIONS` still names "CPC" in a player-facing string; this page uses CCP.

Last checked: 2026-10-29, version 1.18.0
