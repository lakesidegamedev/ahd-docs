# China (CN), System Design

Player guide: [China](https://www.ahousedividedgame.com/wiki/cn-overview)

## Overview

China is modelled as a one-party state (`governmentType: "onePartyState"`). The Chinese Communist
Party (CCP, code id `ccp`) dominates government formation, bill passage, and executive
appointment. Other parties (CDL, CNDCA) participate in the CPPCC advisory body
and can hold NPC seats but are gated from forming governments or fielding
premier candidates. This page says CCP throughout; the party is the same one the older notes call CPC.

## Legislature

**National People's Congress (NPC)**: 2,980 seats in the modern preset and
1,226 in `1953-default`, organised across 7 geographic macro-regions. Each
region runs one multi-seat `npcDelegate` race using Hare-quota PR
(`pr_hareQuota`).

**CPPCC** (2,169 seats): advisory body only. Not elected. Not part of the
player legislative loop. Seats are seeded per-region but have no turn-engine
mechanics.

## Executive

**Premier** (head of government): appointed via parliamentary confidence vote,
gated by one-party constraints so only the CCP can form a government or field a
candidate.

## One-Party Constraints

File: `src/lib/turn/onePartyConstraints.ts`. The gates read `PoliticalParty.regimeStatus` (`ruling`, `approved` or `banned`), so they work for any country with `governmentType: "onePartyState"`.

| Operation                             | Gate                |
| ------------------------------------- | ------------------- |
| Form government                       | CCP only            |
| Field premier candidate               | CCP only            |
| Trigger VONC                          | Disabled by default |
| Invite to coalition                   | CCP only            |
| Government collapse on coalition loss | Disabled            |

China inherits `confidenceVoteMechanism: false` from the one-party-state
government-type default. It does not override that field in its country
config. `canTriggerNoConfidence` still limits movers to the ruling party as a
defence-in-depth gate if the mechanism is enabled later.

Legislative candidates: ruling and approved parties may file, banned parties and independents may not (the last gate in the same file). Executive offices (`premier`, `president`) are ruling party only.

## CCP Confidence Model

Files: `src/lib/turn/rulingPartyPriorities.ts`, `src/lib/turn/rulingPartyConfidenceTurn.ts`

The subsystem is country-agnostic, the priority profile and policy-axis
effects map for CN live on `COUNTRY_CONFIGS.CN.priorityProfile` and
`COUNTRY_CONFIGS.CN.policyAxisEffects`. See
[`docs/design/ruling-party-confidence.md`](./ruling-party-confidence.md)
for the generic design; this section describes CN's specific profile.

Each turn, enacted bills are scored against the CCP's 9-axis priority profile
(party control, social stability, state-sector strength, industrial policy,
economic growth, national security, regional balance, market openness,
anti-corruption). The score drives leader confidence drift.

| Constant | Value | Source |
| --- | --- | --- |
| `INITIAL_CONFIDENCE` | 75 | `src/lib/onePartyState/rulingPartyConfidence.ts` |
| `MAX_CONFIDENCE` | 95 | `src/lib/onePartyState/rulingPartyConfidence.ts` |
| `MIN_CONFIDENCE` | 0 | `src/lib/onePartyState/rulingPartyConfidence.ts` |

Each turn `processRulingPartyConfidenceTurn` finds the leader in `governmentFormations`, reads the leader's confidence state, computes drift with `computeTurnDrift` (enacted policy categories, unprocessed purge events, and the leader's popular legitimacy), then applies it through `adjustLeaderConfidence`, which clamps to 0 to 95. If there is no leader or no confidence state yet, the turn does nothing for that country. Why a confidence model at all: in a one-party state the premier cannot lose a legislative vote, so something has to make bad governance cost the leader; confidence is that cost.

## Regional Budget

File: `src/lib/countries/cn/cnRegionalBudget.ts`

**Revenue sources per region** (constants in `COUNTRY_CONFIGS.CN.onePartyRegionalBudget`, `src/lib/countries/cn/institutionsFacts.ts`):

1. **EIT local share** (企业所得税地方分成): 40% of Enterprise Income Tax
   collected in-territory. Derived from enacted `cn_enterprise_income_tax` rate
   × regional GDP × 6% corporate profit ratio. Defaults to 25% EIT if not
   enacted.

2. **Central transfer grant** (中央转移支付): Finance Minister
   (`CN_minister_of_finance` cabinet setting) sets allocation percentages.
   Defaults to an equal 1/7th split of a national pool sized by
   `centralTransferPerCapita: 35` (`COUNTRY_CONFIGS.CN.onePartyRegionalBudget`,
   `src/lib/countries/cn/institutionsFacts.ts`) × national population, a flat per-capita
   figure, not the generic 4,000 default used elsewhere. Era overrides (e.g.
   the 1953 seed) rescale it further (`centralTransferPerCapita: 2.77`).

3. **Provincial resource tax** from the enacted
   `cn_provincial_resource_tax` policy.

4. **Standing business tax** at 24% of the configured 0.50 GDP consumption
   base. Always collected, not gated on enactment, so regions are reliably
   self-funding.

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

Worked example: a region with `regionGdp` 1,000,000 (million CNY), 25% EIT, gets `1,000,000 x 1,000,000 x 0.06 x 0.25 x 0.4` = 6.0 billion CNY of EIT share, plus `1,000,000 x 1,000,000 x 0.5 x 0.24` = 120 billion CNY of business tax, plus its transfer share.

**Austerity**: `turnsOverBudget` increments each processed turn with `surplus < 0` and resets to 0 otherwise. When it exceeds 1 (a second consecutive deficit) and the region has at least one enacted policy, the policy with the highest per-capita cost is moved down one option index, matching UK and JP behaviour. A policy already at its cheapest option (index 0), or with zero cost, is left alone.

**Provincial spending bills**: The provincial-scope §29 legislation
(`cn_provincial_education`, `cn_provincial_public_security`,
`cn_provincial_economic_development`, `cn_provincial_health_services`,
`cn_provincial_culture_propaganda`, `cn_provincial_environmental_policy`,
`cn_provincial_infrastructure_investment`) all carry `annualCostPerCapita`
on their policy options, so each region's enacted spending is summed
against revenue to drive the austerity check. Regions default to the
statutory baseline (center option) on seed; provincial People's Congress
legislation moves them.

## Regions

7 macro-regions replace 31 provincial-level divisions for gameplay
(`src/lib/constants/cn.ts`), named with pinyin, not English:

| Code | Pinyin name | English gloss   |
| ---- | ----------- | --------------- |
| DB   | Dongbei     | Northeast       |
| HB   | Huabei      | North (Beijing) |
| HD   | Huadong     | East (Shanghai) |
| HZ   | Huazhong    | Central (Wuhan) |
| HN   | Huanan      | South           |
| XN   | Xinan       | Southwest       |
| XB   | Xibei       | Northwest       |

Total NPC seats: 2,980 (`TOTAL_CN_NPC_SEATS`). Total CPPCC seats: 2,169 (`seats` on the CPPCC entry in `src/lib/constants/countryClientConfig.ts`). Provincial People's Congress seats total 4,000 (`TOTAL_CN_PEOPLES_CONGRESS_SEATS`).

NPC seats per region, modern apportionment (`CN_NPC_SEATS`, `src/lib/constants/states.ts`):

| Region | DB | HB | HD | HZ | HN | XN | XB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Modern | 238 | 323 | 922 | 395 | 316 | 466 | 320 |
| `1953-default` (`CN_NPC_SEATS_1953`) | 88 | 129 | 379 | 215 | 118 | 219 | 78 |

The 1953 total is 1,226 (`TOTAL_CN_NPC_SEATS_1953`). Why 7 regions: 31 provincial-level divisions would give 31 separate budgets, elections and policy tables for one country; seven macro-regions keep the per-turn cost and the number of races a player must follow manageable.

## Elections

Each 5-year cycle includes one multi-seat `npcDelegate` PR race per region,
a matching regional `peoplesCongress` race, and a regional `governor` race.
NPC and People's Congress races run 48 hours (`npcDelegate: durationHours 48`, 24 primary plus 24 general; `peoplesCongress` the same, in `src/lib/constants/electionDurations.ts`). The CPPCC is appointed rather than elected,
and China has no snap elections. Races are scheduled by `ensureCNElections` (`src/lib/countries/cn/elections/perpetual.ts`), with all seats of a region contested together. The ceremonial President is synchronized to
the CCP chair through `syncPartyChairHeadOfState` (`src/lib/turn/partyChairHeadOfState.ts`), driven by `headOfStateSelection: "partyChairSync"`.

## Timing

- **`cnBillLifecycle`** (country phase, `src/lib/turn/countryPhases.ts`): runs `processCNBillLifecycle`, which enacts or fails NPC bills and then calls `processRulingPartyConfidenceTurn` for CN with the categories of the bills just enacted. Confidence therefore moves in the same turn a bill passes.
- **`cnElections`** (country phase, same file): `ensureCNElections` creates or maintains the regional NPC races.
- **`cnRegionalBudgetProcessing`** (inside `stateEffectsPhase`, `src/simulation/phases/stateEffectsPhase.ts`): runs `processAllOnePartyRegionalBudgets`. It is gated by `regionalBudgetPhaseDue` and runs every second turn by default (`REGIONAL_BUDGET_EVERY_TURNS = 2` in `src/simulation/phases/regionalBudgetCadence.ts`), in slot 1 alongside Japan, offset from the UK and DE phases (slot 0). The cadence can be overridden between 1 and 4 turns by environment.
- Regional budgets run after `subsidyBudget` and `regionalBudgetProcessing` in the base phase list (`src/simulation/phases/turnPhaseNames.ts`), so subsidy costs are current when the deficit check reads them.

## Edge cases and limits

- Confidence is clamped to 0 to 95. A leader with no confidence state yet is skipped, not created, by the turn.
- A region with no `gdp` is treated as 0, so its EIT, resource and business tax are 0 and only the central transfer funds it.
- If `onePartyRegionalBudget` is absent from a country config, `processOnePartyRegionalBudgets` returns 0 regions processed rather than falling back to defaults.
- The code does not normalise Finance Minister percentages: a region's grant is its stated percent of the fixed pool, so percentages summing above 100 pay out more than the pool.
- If no EIT policy is enacted, or its option has no rate, the rate falls back to `defaultTaxRate` 25.
- `canCollapseGovernment` always returns false in a one-party state, so losing seats can never topple the government. Regime change runs through the separate conversion path in the confidence system, not through coalition loss.
- Austerity never touches a policy with zero cost, and cannot downgrade below the first option.

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

Last checked: 2026-10-29, version 1.18.0
