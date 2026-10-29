# Bills & Legislation

## Summary

Technical reference for how a bill is built, costed, voted on, enacted and turned into metric changes. It covers the proposal rules, the status pipeline run by the turn processor, the exact constants and where they live, and the edge cases.

Player guide: [Bills & Legislation](https://www.ahousedividedgame.com/wiki/bills-legislation)

In short: a sitting legislator pays action points and national influence to propose a bill with 1 to 3 provisions. The bill walks a per-country status pipeline (origin chamber, second chamber, executive action, optional veto override). On enactment the provisions rewrite base policy rows, move metrics, change budgets, and shift legislator approval among voter groups.

## Rules

### Bill types

Every bill needs a **category**. Policy bills need at least one **provision** (legislation type + policy option); custom bills may have no provisions.

#### Policy bills (current implementation)

- **Description**: Bills built from legislation types with named policy options and **economic/social** integer scores (-3 to +3; 0 = center). Each type has 7 options (3 left, 1 center, 3 right) with a primary axis (economic or social) per type.
- **Creation**: Any sitting Congress/Parliament member, or admins via Admin override.
- **Content**: Title, summary, **category** (required), and **provisions** (1-3 per bill). Each provision is a legislation type + policy option (or effect direction). Provisions can store optional **economic** and **social** integers. Category limits which legislation types can be added (e.g. Healthcare allows Medicare and Medicaid; Economy allows Tax Policy, Minimum Wage, Social Security).
- **Categories** (`BILL_CATEGORIES` in `shared/constants/legislation.ts`): defense, economy, education, environment, foreign policy, healthcare, industry, immigration, infrastructure, public safety, social, tax, trade, agriculture, technology, state ownership, custom. Each maps to one or more policy domains. Custom is always proposable with no provisions (flavor/roleplay). Trade bills use tariff provisions (`TARIFF_BILL_CATEGORIES`), industry bills use subsidy provisions (`SUBSIDY_BILL_CATEGORIES`), and state ownership bills use nationalization provisions (`NATIONALIZATION_BILL_CATEGORIES`).
- **Provisions**: 1-3 per bill (`MAX_PROVISIONS = 3` in `shared/constants/legislation.ts`). When the bill is signed, every provision's effect is applied to the relevant state/national metrics.
- **Effects**: When a bill is signed (or pocket-signed), `applyLegislationEffect()` in `src/lib/legislationEffects.ts` applies each provision's delta to its legislation type's `effectTarget` metric.

#### Proposal cost

| Constant | Value | File |
| --- | --- | --- |
| `PROVISION_COSTS` | `[5, 10, 15]` national influence for the 1st, 2nd, 3rd provision | `shared/constants/legislation.ts` |
| `getProvisionCostTotal(n)` | cumulative: 5 for one, 15 for two, 30 for three | `shared/constants/legislation.ts` |
| `BILL_PROPOSE_ACTION_COST` | 10 action points, flat, for any bill (national or state) | `shared/constants/legislation.ts` |

```text
npiCost    = sum(PROVISION_COSTS[0 .. n-1])        (n = number of charged provisions)
actionCost = 10                                    (admins pay neither)
```

Admins are exempt. The propose form shows the balance and the backend deducts on submit (`src/lib/legislature/commands/proposeNationalBill.ts`, which charges `nationalInfluence`). Tariff provisions do not cost NPI; subsidy, end-subsidy, union-law, central-bank-independence and electoral-law provisions use the same ladder as policy provisions (`countProvisionsChargedNationalInfluence` in `shared/constants/legislation.ts`). The amounts spent are stored on the bill (`proposalNpiCost`, `proposalActionCost`). If the bill is enacted, the action points and NPI spent are refunded to the sponsor (`onBillEnacted` in `src/lib/billEnactment.ts`; the action refund is capped at the sponsor's Energy-scaled action cap).

#### LegislationType fields

Key fields on the `LegislationType` interface (`src/lib/db/types/legislation.ts`):

| Field | Description |
| --- | --- |
| `countryScope` | `"us"`, `"uk"`, `"international"` and other country codes: which country this type belongs to. UK types are `"uk"` (see UK Legislation Types below). |
| `effectTargetsWeighted` | Array of weighted metric targets applied when a bill using this type is enacted. |
| `policyOptions[].metricEffects` | Per-option `{ category, metricId, ratePerTurn }`, direct additive metric change applied **each turn** the policy is active. Scaled for ~10-year full reversal: extreme is about +/-0.06 per turn, center = 0. |
| `policyOptions[].annualCostPerCapita` | **Absolute** per-capita spending level in $ per year (not a delta). Represents the total program cost at that policy level. `$0` = full abolition of the program. Positive = spending; negative = net savings/revenue (e.g., tax increases). Applied to national/state budgets when enacted. |
| `policyOptions[].minimumWageRate` | (Minimum wage types only) The actual hourly wage in $/hour for this option. Stored alongside the standard economic/social scores so the UI can display the real dollar figure. |
| `positions[].chamber` | `"house"`, `"senate"`, `"commons"` or `"lords"`: committee positions for the type. |

#### US tax system, 11-bracket model

All 9 US tax legislation types (`income_tax`, `corporate_tax`, `capital_gains_tax`, `payroll_tax`, `estate_tax`, `excise_tax`, `carbon_tax`, `wealth_tax`, `financial_transaction_tax`) use an **11-bracket scale** (indices 0-10) with LARP-style bill names:

| Index | Direction | Example title pattern |
| --- | --- | --- |
| 0 | Far left | "X Expansion and Reform Act" |
| 1-4 | Left | Progressive-leaning rate bills |
| 5 | Center | Status quo / baseline rate |
| 6-9 | Right | Rate reduction bills |
| 10 | Far right | "X Abolition Act" / "Zero X" |

Each bracket has an explicit `economic` score (-5 to +5), a `social` score (0 unless cross-axis), an `annualCostPerCapita` representing total per-capita revenue impact, and a LARP-style title and description. This replaced the prior 6-8 option scale.

#### Absolute cost model

`annualCostPerCapita` on every US legislation option is an **absolute spending level**, not a delta from baseline:

- `$0` means the program is fully abolished at that option.
- Higher values mean larger government spending on that program.
- Tax types use negative values to represent net revenue collected.
- When a bill is signed, the budget system sets the program cost to the new absolute value (not adds a delta).

This contrasts with the old delta model. Re-seeding policies resets to the baseline option's absolute value.

#### US legislation type changes (v3 overhaul)

- **Removed**: `medicare`, removed as redundant with `federal_healthcare_funding` and `drug_pricing_medicare`.
- **Added**: `state_spending_stimulus`, state-level economic stimulus spending legislation.
- **Added**: `state_housing`, state-level housing and development legislation.
- All ~45 remaining non-tax US types reworked with LARP-style bill names, absolute `annualCostPerCapita` values, and explicit dual-axis (`economic`, `social`) scores.

#### UK legislation types

The UK has 62 legislation types in the seed catalogue (`src/lib/seeds/reference/legislationTypes.ts`, re-exported by `scripts/seeds/legislationTypes.ts`), about 44 national (Parliament) and 18 regional (Council) at the time of writing; the per-category counts below are from the earlier 55-type catalogue and are indicative. All have `countryScope: "uk"`. National types have `allowedScope: "national"`; regional types have `allowedScope: "state"`. Each has 7 policy options (spending types) or 11 brackets (tax types) with LARP-style titles, descriptions, and GBP-per-capita costs. Baseline policy values start at centrist (option #3). They are written to the database by the core seed and can be re-seeded on their own with `seedUkLegislation` (`src/lib/countries/uk/seedLegislation.ts`), an admin-only destructive action.

**34 National (Parliament) types** across 16 categories: Healthcare (4), Education (4), Economic (2), Infrastructure (2), Environment (2), Law & Justice (2), Defence (2), Foreign Policy (1), Welfare (2), Immigration (2), Labour (2), Housing (2), Governance (3), Media (2), Civil Liberties (2), plus 5 national tax types (Income Tax, NI, VAT, Corporation Tax, Excise/Customs).

**14 Regional (Council) types** plus 2 regional tax types (Council Tax, Business Rates). Regional types are subject to the **budget constraint system**: total enacted regional spending cannot exceed the region's budget (Council Tax revenue + Business Rates revenue + Westminster grant).

**7 tax types** use 11 brackets with explicit rates, LARP-style titles, and economic scores. National taxes: `uk_income_tax_rate`, `uk_national_insurance`, `uk_vat`, `uk_corporation_tax`, `uk_excise_customs`. Regional taxes: `uk_council_tax`, `uk_business_rates`.

**Key national type:** `uk_local_government_funding` controls the Westminster grant to regions. The seated Chancellor of the Exchequer can allocate that pool through the cabinet allocation route; `src/lib/turn/regionalBudget.ts` applies the configured percentages, defaulting to an equal split.

**UK-specific metrics:** 14 metrics unique to the UK (e.g., `nhsWaitingTime`, `childPoverty`, `housingAffordability`, `devolutionSatisfaction`, `bbcTrust`). 4 US-only metrics excluded from UK (`uninsuredRate`, `affordabilityIndex`, `highSchoolGradRate`, `collegeEnrollment`). National effect division uses `UK_FEDERAL_MULTIPLIER = 1/12` in `shared/constants/formulas.ts` (12 regions vs US 50 states); see Federal effect division.

**Regional budget constraint** (`src/lib/turn/regionalBudget.ts`): UK regions operate under a balanced-budget requirement. Revenue = Council Tax + Business Rates + Westminster grant. If enacted spending exceeds budget for more than 1 turn, forced austerity downgrades the most expensive programme one option level per turn until balanced. Property and commercial value bases drift dynamically based on investment levels (25%-300% of baseline guardrails).

### Bill lifecycle

Bills move through a strict status pipeline managed by the turn processor each hour:

| Status | Meaning |
| --- | --- |
| `proposed` | Drafted but not yet active; activated by the lifecycle (`activateProposed: true` for US) |
| `active` | Voting open in the origin chamber (24-hour window) |
| `passed_origin` | Passed origin chamber; pending transmission to second chamber |
| `active_other` | Voting open in the second chamber (24-hour window) |
| `active_both` | Both configured chambers voting concurrently (countries that use the concurrent stage) |
| `cabinet_review` | Parked in a cabinet stage, in country flows that have one |
| `enrolled` | Passed all required chambers; awaiting presidential action (10-hour window) |
| `signed` | President signed (or pocket-signed); bill is law |
| `vetoed` | President vetoed; opens the override window |
| `veto_override` | Override vote open (24 hours); passing makes the bill law without a signature |
| `override_shugiin` | Japan's lower-house override of an upper-house rejection (a `BillStatus` value in `src/lib/db/types/legislation.ts`) |
| `override_failed` | Override did not reach two-thirds of seats; bill dies |
| `failed` | Failed a chamber vote |
| `withdrawn` | Sponsor withdrew while the bill was `proposed` or in its first (`active`) vote |

Per-country stage graphs are configs under `src/lib/turn/billLifecycle/configs/` (the US one lives in `src/lib/countries/us/elections/billLifecycle.ts`); the engine is `src/lib/turn/billLifecycle/engine.ts`. `VOTING_HOURS = 24` and `EXECUTIVE_ACTION_HOURS = 10` are in `configs/configuredCountry.ts`; the US config sets `VOTING_HOURS = 24` and `PRESIDENT_HOURS = 10` itself.

#### Proposal

1. **Cost**: Flat 10 action points to propose (`BILL_PROPOSE_ACTION_COST`) plus cumulative national influence per provision (5 for the first, 15 for two, 30 for three); admins are exempt. The spend is checked and deducted in one conditional database update, so two simultaneous proposals cannot both spend the same balance.
2. **Availability**: US, House or Senate members. UK, Commons members. **JP, Shugiin or Sangiin members** (origin chamber matches the sponsor's seat). Admins can override in all countries.
3. **Required**: Category and at least one provision (legislation type + policy option). Category limits which legislation types appear in the form (see `GET /api/game/legislation-types?category=...`).
4. **Activation**: Bill immediately enters `active` status with a 24-hour `votingEndsAt` timestamp set at submission.
5. **Origin chamber** is recorded from the proposing member's selection (House, Senate, or Joint).

#### Voting

1. **Window**: 24 hours per chamber.
2. **Vote options**: For / Against / Abstain (changeable before voting closes).
3. **Eligibility**: Only members of the current chamber may vote.
4. **Result**: Simple majority (For > Against; abstentions are neutral). `meetsBillPassRule` in `src/lib/congress/billPassRule.ts` requires For strictly greater than Against.
5. **Tie votes**: A tied vote fails; no tie-breaking vote is cast by the Vice President in the bill engine.
6. **Supermajority bills**: nationalize and privatize bills need two-thirds of For plus Against (abstentions excluded, no votes cast fails), except in one-party states where a simple majority applies; war declarations need two-thirds in every government type (`getBillPassRule`). The two-thirds test is `votesFor * 3 >= 2 * (votesFor + votesAgainst)` with at least one vote cast. The two-thirds bar supersedes the filibuster threshold.
7. **Re-voting**: A member may change their vote at any time while voting is open.

#### Bicameral process

1. Bill opens for voting in the origin chamber (House or Senate).
2. Voting closes at `votingEndsAt`; turn processor tallies all votes.
3. **Passed**: status advances to `active_other` for the second chamber with a fresh 24-hour window.
4. **Failed**: status set to `failed`.
5. Second chamber vote closes the same way; if passed, `enrolled`.

#### Presidential action

- **Sign**: Bill becomes law (`signed`); effects apply.
- **Veto**: Bill fails (`vetoed`).
- **Pocket signature**: If the President takes no action within 10 hours of enrollment (`PRESIDENT_HOURS`, `onTimeout: "sign"`), the bill is automatically signed (`signed`). An absent or vacant presidency therefore signs the bill rather than blocking it.
- International-organization membership bills skip presidential action and enact directly after the final chamber vote.
- Only the character currently holding the President office sees the action panel.

#### Senate filibuster / cloture

Implemented, US Senate only (`src/lib/legislature/commands/nationalBillActions.ts`); a bill with `countryId !== "US"` is rejected.

- **Who can invoke**: Only a sitting US Senator (officeType `"senate"`). Once per character per bill.
- **Cost**: 25 action points + 5 political influence (`filibusterActionCost = 25`, `filibusterNpiCost = 5` in `nationalBillActions.ts`). The filibuster spends the character's `politicalInfluence` field, not the `nationalInfluence` field that proposals spend.
- **Effect**: Extends the Senate's voting deadline by 12 hours, adjusted by the invoking senator's Statecraft stat (via `statMultiplier`, roughly a +/-20% band, so a stronger senator delays it more), and sets a cloture threshold: the bill passes the Senate only if For reaches three-fifths of For + Against + Abstain (`CLOTURE_VOTE_SHARE = 3 / 5`, `clotureVotesRequired(cast) = ceil(0.6 * cast)` in `src/lib/turn/billLifecycle/clotureRules.ts`) instead of a simple majority. Members who never vote are excluded, but abstentions raise the bar (`didPassWithFilibusterCheck`, called from `evaluatePassRule` in `src/lib/turn/billLifecycle/engine.ts`). The cost is refunded if the invocation write fails.
- **Not usable** on a bill in status `active_both` (both chambers voting concurrently), since there is no single chamber clock to delay in that state.
- **Can be disabled**: A Senate rule change (a `statePolicies` doc with `legislationTypeId: "senate_filibuster_rules"` and `effectDirection: -1`) abolishes the filibuster; simple majority applies again.

#### Veto override

Implemented. A veto opens status `veto_override` with its own voting deadline (`overrideVotingEndsAt` / `overrideVotingEndsOnTurn`), set at veto time to 24 hours later (`OVERRIDE_WINDOW_HOURS = 24` in `src/lib/presidentialBillAction.ts`). The override passes only with two thirds of the seats in each chamber (stage `threshold: "twoThirdsSeats"`), not two thirds of votes cast; vacancies and abstentions do not lower the bar. Japan's lower house has its own two-thirds override of an upper-house rejection.

- **Who can vote**: Any member of either chamber, via action `veto_override_vote`.
- **Weighting**: Votes are weighted by `seatsHeld`.
- **Tally**: Tracked in `vetoOverrideVotesFor` / `vetoOverrideVotesAgainst`; the per-chamber display is frozen when the override closes (`overrideDisplaySnapshot`) so a later election cannot rewrite it.

### Natural metric decay

Metrics decay toward their baseline at **0.25% of the remaining distance per turn** when no active policy is pushing them. This is proportional (exponential) decay, so a metric never overshoots its baseline, and it stops weak laws from leaving a metric permanently displaced after a law expires or is repealed. A metric displaced by 10 points returns to within 1 point of baseline in about 920 turns (the source comment calls this about 19 game years) with no opposing policy.

```text
calculateDecay(current, baseline):
  distance = current - baseline
  if |distance| < DECAY_THRESHOLD: return baseline
  return current - distance * DECAY_RATE
```

- `DECAY_RATE = 0.0025` and `DECAY_THRESHOLD = 0.001` (below that distance the value snaps to baseline) live in `src/lib/turn/metricDecay.ts`.
- The old standalone `processMetricDecay` phase is now a deliberate no-op returning 0. State metric decay runs inside `processStatePolicyEffects` (`src/lib/policyEffects.ts`), which reads `stateMetrics` and `stateBaselines` together and writes one consolidated update per state, so there is no second writer racing policy effects.
- Lean and turnout use the same rate through `LEAN_TURNOUT_DECAY_RATE_PER_TURN = 0.0025` in `src/lib/demographicEffects.ts`.

### Federal effect division

Federal bills apply their metric effects to every state or region. On the per-turn tick path each state receives only a fraction of the full effect, so a single federal bill cannot dominate state-level metrics and the per-state effects sum to roughly the intended national total.

| Constant | Value | File |
| --- | --- | --- |
| `FEDERAL_MULTIPLIER` | 1/50 (US, 50 states; default for any country without an override) | `shared/constants/formulas.ts` |
| `UK_FEDERAL_MULTIPLIER` | 1/12 (12 regions) | `shared/constants/formulas.ts` |
| `JP_FEDERAL_MULTIPLIER` | 1/8 (8 regions) | `shared/constants/formulas.ts` |
| `DE_FEDERAL_MULTIPLIER` | 1/16 (16 Laender) | `shared/constants/formulas.ts` |
| `NATIONAL_LAW_DECAY_MULTIPLIER` | 0.21 (decay path only, same for every country) | `shared/constants/formulas.ts` |
| `MAX_EFFECT_PER_LAW` | 12 (decay-path points one law can move a metric, before the scope multiplier) | `shared/constants/formulas.ts` |
| `POLICY_INTENSITY_GAMMA` | 0.8 (convexity of intensity to magnitude) | `shared/constants/formulas.ts` |

`getFederalMultiplier(countryId)` returns the per-country value and falls back to `FEDERAL_MULTIPLIER`. It governs the per-turn tick path (`computeTickRates`). The decay path in `src/lib/policyEffects.ts` uses the region-count-independent `NATIONAL_LAW_DECAY_MULTIPLIER` through `nationalDecayScope`, so national laws decay at the same speed in every country. State-scope laws use a multiplier of 1.

### Bill effects

#### Policy bills (signed legislation)

- Each **provision** has a legislation type with an optional `effectTarget` (metric category + metric id + scope). When the bill is signed, `applyLegislationEffect()` applies a small delta to that metric for all states (national) or per-state. The delta is `getLegislationEffectDelta(effectDirection)` in `shared/constants/formulas.ts`: 0 for direction 0, else +0.5 or -0.5 (a fixed `magnitude = 0.5`). The ongoing per-turn effect then comes from the policy-effects phase (`src/lib/policyEffects.ts`), scaled by the federal multiplier above.
- Bills with multiple provisions apply each provision's effect in sequence.
- Legislation types are seeded via `scripts/seeds/legislationTypes.ts` (`npm run seed:legislation`). Base policy (national and state) is seeded via `scripts/seeds/basePolicies.ts` and `scripts/seed/seed-policies.ts` (`npm run seed:policies` or `npm run seed:policies:reset`).

#### Voter approval impacts

When a bill is **enacted** (signed into law or veto overridden), legislators who voted FOR the bill receive approval changes among voter groups based on the policy shift. The groups are the Layer-1 census buckets the vote engine counts (for example `education:no_college`), not the older voter archetypes:

| Component | Description |
| --- | --- |
| **Policy domains** | 15 domains: education, healthcare, environment, immigration, criminal_justice, defense, economic, welfare, infrastructure, governance, foreign_policy, tax, mediaInformation, technology, agriculture |
| **Bucket affinities** | Each census bucket has a per-domain affinity, set per country (`DOMAIN_BUCKET_AFFINITIES` in `src/lib/bucketAffinities.ts`; a country with no table falls back to the US one). Positive = likes rightward shifts, negative = likes leftward. |
| **Shift calculation** | `shift` is the change in the option's combined economic plus social position score (falls back to the option index when scores are missing). Rightward is positive. |
| **Impact formula** | `impact = shift * affinity * 0.15 * position multiplier` (`SHIFT_IMPACT_SCALE = 0.15` in `src/lib/archetypeAffinities.ts`), rounded and clamped to +/-10 per bill. |
| **Position multiplier** | With position scores: `clamp(0.5 + abs(newScore) / 5, 0.5, 1.5)`, so higher when the new position is more extreme. Without scores (legacy): `[1.5, 1.25, 1.0, 0.5, 1.0, 1.25, 1.5][newIndex]`, default 1.0. |
| **Who gets impacts** | All legislators who voted FOR the bill (both chambers for federal bills). |
| **When applied** | Only at enactment (`onBillEnacted` in `src/lib/billEnactment.ts`), not during chamber voting. |

Implementation: `calculateShiftImpacts()` in `src/lib/archetypeAffinities.ts` (the file name is historical; it computes census-bucket impacts), with the affinity tables in `src/lib/bucketAffinities.ts`. A shift of 0 returns no impacts. See [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md) for the buckets and [Archetype Approvals](./archetype-approvals.md) for the retired model.

### Detail page (`/congress/bills/[id]`)

Each bill has a dedicated page showing:

- **Timeline stepper**: proposed, origin vote, second chamber, president, enacted.
- **Live countdown** timer while voting is open.
- **Vote bars** for both chambers (For / Against / Abstain percentages).
- **Vote buttons** for eligible members; re-voting moves the previous vote.
- **Presidential action panel** (Sign / Veto), visible to the President only.
- **Co-sponsors** list and full bill text.
- Sidebar quick-facts (status, origin chamber, sponsor, key dates).
- Placeholder card for future **Amendments** (amending is not implemented).
- **Senate filibuster / cloture** and **veto override** are implemented (see above), not placeholders.

### NPP auto-voting

See [NPP System](./npp-system.md) for full documentation. Federal and local NPP legislators now use the same deterministic cross-pressure model:

- **Forces**: ideology + whip + district/home-region + donors.
- **Federal scope**: House / Senate / Commons / upper-chamber federal votes read the baseline weighting.
- **Local scope**: `stateSenate` / `regionalCouncil` bills use the same model with heavier district pressure and lighter donor pressure.
- **Whips**: hard whips still force an immediate hidden-roll vote when issued; soft whips only add advisory pressure into later autonomous voting.
- **Multi-seat weighting**: NPP blocs contribute their full `seatsHeld` weight to vote tallies.
- **Catch-up**: Runs every turn so NPPs that gained seats after a bill opened still vote before the bill closes.

### Admin tools

Accessible via Admin, Legislation tab:

| Action | Description |
| --- | --- |
| Advance Chamber | Skip the current chamber's vote; advance to next stage |
| Send to President | Mark bill as `enrolled` immediately |
| Force Sign | Sign the bill regardless of chamber status |
| Force Veto | Veto the bill regardless of chamber status |
| Fail | Mark the bill as `failed` immediately |
| Reset | Reset bill to `active` with a fresh 24-hour voting window |

The turn processor runs `processBillLifecycle()` (`src/lib/billLifecycle.ts`) every turn; all status transitions happen automatically without admin intervention in normal play.

### Legislative strategy

- Players must build support for bills: a majority in both chambers plus a presidential signature (or a pocket signature if the presidency is silent). Bipartisan support may be needed for controversial bills.
- Limited actions mean strategic choices: writing bills versus voting on others, supporting the party agenda versus personal priorities. Voting record affects your policy positions.
- Vote whipping: see [Voting and whips](https://www.ahousedividedgame.com/wiki/voting-and-whips).

## Data

### Collections

| Collection | Fields read or written | Player-visible |
| --- | --- | --- |
| `bills` | `status`, `title`, `summary`, `category`, `provisions`, `sponsorId`, `coSponsors`, `originChamber`, `currentChamber`, vote tallies (`votesFor`, `votesAgainst`, `votesAbstain`, `votes`, `otherChamber*`), `votingEndsAt` / `votingEndsOnTurn`, `otherChamberVotingEndsAt` / `otherChamberVotingEndsOnTurn`, `presidentActionDeadline` / `presidentActionDeadlineOnTurn`, `overrideVotingEndsAt` / `overrideVotingEndsOnTurn`, `vetoOverrideVotesFor` / `vetoOverrideVotesAgainst`, `filibusterInvocations`, `preFilibusterStatus`, `proposalNpiCost`, `proposalActionCost`, `voteSnapshot`, `otherChamberVoteSnapshot`, `overrideDisplaySnapshot`, `budgetValidation` | Mostly yes (bill page). `budgetValidation` and proposal cost fields are internal |
| `stateBills` | State and regional bills (own lifecycle in `src/lib/turn/billLifecycle/regionalEngine.ts`) | Yes |
| `statePolicies` | `scope`, `stateId`, `countryId`, `legislationTypeId`, `policyOptionId`, `policyOptionIndex`, `enactedAt`, `enactedTurn`, `enactedBy`, `economic`, `social`, `effectDirection` | Yes (Policy page, State Laws tab) |
| `legislationTypes` | Policy options, scores, costs, effect targets (seed data) | Yes, through the legislation-types API |
| `characters` | `actions`, `nationalInfluence` (proposal cost and refund), `politicalInfluence` (filibuster cost), `stats.statecraft`, `statXp.statecraft` | Own character only |
| `electedOfficials` | `seatsHeld` (vote weight, override threshold) | Yes |
| `stateMetrics`, `macroMetrics`, `stateBaselines` | Metric values moved by enacted bills and decay | Yes |
| `gameState` | `manuallyEnabledSeats` (create-department provisions) | Partly |
| `gameConfig` | `interstateMoneyWiringEnabled` (read when enacting tariff-rate bills) | No |

### APIs

- **Legislation types**: `GET /api/game/legislation-types` (optional `?category=...`). Types include `policyOptions` with `economic` and `social` scores for the proposal UI.
- **Current policies**: `GET /api/game/current-policies?stateId=federal` returns a `{ legislationTypeId: policyOptionIndex }` map for shift-based UI previews.
- **Propose**: `POST /api/congress/bills` with `title`, `summary`, `chamber`, `category`, and `provisions: [{ legislationTypeId, effectDirection?, economic?, social? }]`. Backend validates category and domain; deducts the cumulative provision NPI cost for non-admins.
- **Policy (base law)**: `GET /api/policy?scope=national` or `GET /api/policy?scope=state&stateId=...` returns per-legislation-type records with `economic`, `social`, and `policyOptionName` (the option that best matches the stored position). Used by the national Policy page and the state page **State Laws & Policy** tab.
- **Committee assignments**: See [Legislation System Completion Audit](./legislation-system-completion-audit.md). Committees tab on Congress page; admins assign via Admin, Legislation.

### Base policy and state laws

- **Collection**: `statePolicies` stores the current base policy per legislation type for the **nation** (one record per national-only or shared type) and for **each state** (only for non-national-only types; see `nationalOnly` on legislation types).
- **Position model**: Each record has **economic** and **social** integer scores (-3 to +3; 0 = center). The API matches the stored (economic, social) to the legislation type's `policyOptions` and returns **policyOptionName** (exact or nearest by Manhattan distance).
- **Seed**: `scripts/seeds/basePolicies.ts` defines **national defaults** (per-type, e.g. tax +1, healthcare -1) and **state defaults** from `state.politicalLean` (bluer is more negative, redder more positive; clamped to -3..+3). Run `npm run seed:policies` to upsert, or `npm run seed:policies:reset` to clear and reseed. Era-specific base policy tables live in `src/lib/seeds/reference/basePolicies<year>.ts`.
- **National Policy page**: `/policy` (USA nav) lists all national policies grouped by domain; each row shows current base **policy option name** and Economic/Social positions.
- **State Laws & Policy tab**: On each state page, a single **State Laws & Policy** tab shows state-level base policy for that state: policy area name, current base option name, and Economic/Social positions. If the list is empty, run `npm run seed:policies` (and ensure `seed:legislation` has been run so legislation types exist).

## Configuration

There is no single bills setting in `gameConfig`. Behaviour comes from constants and per-country lifecycle configs.

| Setting | Default | Effect | Where |
| --- | --- | --- | --- |
| `MAX_PROVISIONS` | 3 | Provision cap | `shared/constants/legislation.ts` |
| `PROVISION_COSTS`, `BILL_PROPOSE_ACTION_COST` | `[5, 10, 15]`, 10 | Proposal cost | `shared/constants/legislation.ts` |
| `VOTING_HOURS`, `EXECUTIVE_ACTION_HOURS` | 24, 10 | Voting and executive windows | `src/lib/turn/billLifecycle/configs/configuredCountry.ts` |
| US `VOTING_HOURS`, `PRESIDENT_HOURS` | 24, 10 | US stage windows | `src/lib/countries/us/elections/billLifecycle.ts` |
| `activateProposed` | `true` for US and configured countries | Whether the engine activates `proposed` bills | `src/lib/turn/billLifecycle/types.ts` (type), country configs |
| Per-country stage graphs | UK, DE, IE, JP, one-party, regional | Which stages, thresholds and chambers apply | `src/lib/turn/billLifecycle/configs/` |
| `OVERRIDE_WINDOW_HOURS` | 24 | Veto override window | `src/lib/presidentialBillAction.ts` |
| `senate_filibuster_rules` policy | present, direction not -1 | Direction -1 abolishes the filibuster | `statePolicies` row, `federal` |
| `gameConfig.interstateMoneyWiringEnabled` | off unless `true` | Nets sourced imports when a tariff-rate bill is enacted | `src/lib/billEnactment.ts` |
| Government type `onePartyState` | n/a | Nationalize and privatize bills use a simple majority | `src/lib/congress/billPassRule.ts` |
| Bucket affinity tables per country | US fallback | Approval impact sizes | `src/lib/countries/<cc>/data/<cc>BucketAffinities.ts` |

Era presets choose the base policy tables and legislation types in force; a scenario can reseed them with `npm run seed:policies:reset`.

## Timing

- The bill lifecycle runs in the turn phase `billsCampaignsAndActivity` (`src/simulation/phases/turnPhaseRegistry.ts`). Inside it, `billLifecycle` (national), the per-country bill phases and `stateBillTimers` (state and regional bills, `src/lib/turn/billLifecycle/regionalEngine.ts`) run in parallel in one `Promise.all` group, alongside cabinet nominations and the SCOTUS turn.
- Within that phase, NPP voting has already run (`nppBehavior`, earlier in the turn), so NPP votes cast that turn are counted when the bill closes.
- Deadlines are stored as both a timestamp and a turn number (`votingEndsAt`, `votingEndsOnTurn`); the lifecycle prefers the turn number when present, which is why filibuster extension moves both together.
- Enactment (`onBillEnacted`) writes `statePolicies`; the social-axis drift phase later in the same turn reads whatever `statePolicies` rows the bill phases just wrote, and the policy-effects pass reads them on the turns that follow.
- Natural decay runs inside the state policy-effects pass, not as its own phase.

```text
player action (propose, vote, filibuster, sign/veto)   [any time, API route]
   v
turn: nppBehavior            NPP votes cast
   v
turn: billsCampaignsAndActivity
        billLifecycle / country bill phases / stateBillTimers   (parallel)
        -> close windows, tally, advance status, onBillEnacted
   v
turn: social-axis drift      reads new statePolicies rows
   v
following turns: policy effects + decay (processStatePolicyEffects)
```

Total elapsed time in a sequential bicameral presidential system is up to 24 + 24 + 10 hours, so about 58 hours at most (more if a filibuster adds its delay).

## Worked trace

A US Representative proposes a two-provision bill (income tax cut plus a minimum wage rise) in the House, then it clears both chambers and the President signs.

1. Proposal cost: 10 action points, and 5 + 10 = 15 NPI (`nationalInfluence`). The bill enters `active` with `votingEndsAt` 24 hours out; `proposalNpiCost = 15` and `proposalActionCost = 10` are stored on it.
2. House vote closes with 230 For, 200 Against, 5 Abstain. For exceeds Against (230 > 200), so it moves to `active_other` with a fresh 24-hour window.
3. Senate closes 51 For, 49 Against with no filibuster, so the bill becomes `enrolled` with a 10-hour presidential window.
4. The President signs inside the window. `onBillEnacted` applies both provisions, refunds the 10 action points (capped at the sponsor's action cap) and 15 NPI to the sponsor, and grants approval changes to legislators who voted For.
5. Had a senator filibustered, the Senate deadline moves by `round(12 h * statMultiplier)`: 12 hours at a neutral Statecraft stat (`filibusterDelayTurns = max(1, round(12)) = 12`). The bar becomes `clotureVotesRequired(100) = ceil(0.6 * 100) = 60` For, and 51 For of 100 cast falls short, so the bill is `failed`.
6. Approval impact for a For-voter on the tax provision (US tax domain, illustrative scores moving from 0 to +2, so `shift = 2` and `positionMultiplier = clamp(0.5 + 2/5) = 0.9`):

| Bucket | Affinity | Raw impact `2 * affinity * 0.15 * 0.9` | Stored |
| --- | --- | --- | --- |
| `wealth:high` | 18 | 4.86 | +5 |
| `wealth:low` | -14.75 | -3.9825 | -4 |
| `race:white` | 45 | 12.15 | +10 (clamped) |

7. Per-turn metric effect afterwards: on the tick path a policy option with `ratePerTurn = 0.06` gives each US state `0.06 * (1/50) = 0.0012` per turn. Separately, a metric at 60 against a baseline of 50 with no pushing policy decays to `60 - (60 - 50) * 0.0025 = 59.975` after one turn.

## Edge cases and limits

- **Provision cap**: at most `MAX_PROVISIONS = 3`; NPI total is capped by the ladder at 30.
- **Admins** pay no NPI or action points and can override sponsorship rules in every country.
- **Ties fail**: For must strictly exceed Against. With no votes cast, a two-thirds rule fails.
- **Abstentions**: neutral for simple majority and two-thirds (excluded from the base), but they count in the filibuster three-fifths base.
- **Filibuster**: once per senator per bill, US only, not on `active_both`, disabled if a Senate rule change sets `senate_filibuster_rules` to direction -1. Statecraft scales the 12-hour delay by about plus or minus 20% (`statMultiplier`), with a minimum extension of one turn.
- **Withdrawal**: only the sponsor, only while `proposed` or `active`.
- **Pocket signature**: silence signs the bill. Parliamentary executives have no ordinary bill veto.
- **Frozen legislature**: in parliamentary countries with no seated head of government, proposals are blocked and active bills pause until formation completes.
- **Budget gate**: a state bill the state budget cannot fund is rejected at signature or auto-sign; national bills are checked but an enacted national bill is not blocked (the result is recorded in `budgetValidation` as a warning).
- **Approval impact clamp**: each legislator's per-bucket change is clamped to plus or minus 10 per bill, and a centrist option scales it by 0.5 against 1.5 at the extremes.
- **Decay floor**: a metric within 0.001 of baseline snaps to baseline.
- **Unmapped domain**: a policy domain with no affinity table gives no approval impact rather than an error.
- **Excluded**: committees and amendments are not implemented (see Known issues and history).

## Invariants

- For must strictly exceed Against to pass a simple majority; two-thirds needs at least one vote cast: `meetsBillPassRule`, tested in `src/lib/congress/billPassRule.test.ts`.
- A proposal spend cannot be double-spent: one conditional update checks and deducts the balance. Deduction is tested in `proposeNationalBill.test.ts`; a true concurrent double-submit is not tested.
- Approval impact per bucket stays within +/-10: clamped in `calculateShiftImpacts`; covered by `archetypeAffinities.test.ts`.
- A metric never overshoots baseline under decay: proportional formula, covered by `src/lib/turn/metricDecay.test.ts`.
- A filibuster's date and turn deadlines move together: enforced in `nationalBillActions.ts`; `nationalBillActions.test.ts` covers the filibuster action but the date and turn lockstep is not asserted there.
- A refunded amount never exceeds what was spent: refunds read `proposalNpiCost` and `proposalActionCost` from the bill. Not enforced by a dedicated test of the cap.
- National bill budget check is warn-only by design; nothing enforces a spending ceiling on national bills.
- The cost ladder sums as `getProvisionCostTotal` says: tested in `shared/constants/legislation.test.ts`; no check that the form and backend agree.

## Failure and recovery

- **Bill stuck in a status past its deadline.** Usually a turn that did not complete, or a deadline stored only as a timestamp without a turn number. Rerunning the turn closes it; a stuck single bill can be moved with the admin Advance, Fail or Reset actions.
- **Duplicate or half-applied enactment.** The turn is not wrapped in a transaction; crash recovery resumes or releases the turn lock. A bill whose effects did not land is repaired by reconciling enacted bills against `statePolicies` (see `src/lib/resetLegislation/reconcileEnactments.ts`) or a targeted heal.
- **Empty Policy page or State Laws tab.** Legislation types or base policies are missing; reseed legislation types, then base policies.
- **Wrong baseline policy after a reseed.** `seed:policies:reset` returns every row to the baseline option; enacted laws are lost unless reapplied.
- **UK regional deficit.** The forced austerity step corrects overspend automatically, one option level per turn.
- **Lost refund.** A failed refund write leaves the sponsor short; compensate with a heal against the stored `proposalNpiCost` and `proposalActionCost`.

## Connections

**Driven by**

- Sponsor resources: action points and NPI (`proposeNationalBill.ts`, `proposeStateBill.ts`), and Statecraft for filibuster delay (`src/lib/stats/statMultiplier.ts`).
- Chamber composition from elections: seats held in `electedOfficials` set vote weights and the override threshold. See [Elections](./elections.md) where relevant.
- NPP voting and whips: [NPP System](./npp-system.md), `src/lib/nppAutonomy/`.
- Government status: head of government and cabinet (government formation freezes legislation).
- Existing policy state in `statePolicies`, which the new option is compared against to compute the shift.
- Budget capacity for state bills (`src/lib/budget/validation.ts`).

**Affects**

- State and national metrics through `applyLegislationEffect` and the per-turn policy-effects phase (`src/lib/legislationEffects.ts`, `src/lib/policyEffects.ts`).
- Legislator approval among census buckets at enactment (`onBillEnacted` calling `calculateShiftImpacts`); see [Granular Electorate](./granular-electorate-as-shipped.md).
- Federal and regional budgets through `annualCostPerCapita`, and the UK regional budget constraint (`src/lib/turn/regionalBudget.ts`).
- Corporations through tariff, subsidy, nationalize, privatize and competition provisions.
- Related design docs: [Congress Leadership](./congress-leadership.md) for leadership roles, and the [Legislation Completion Audit](./legislation-system-completion-audit.md) for committee status. API gating for the bill routes: [API Middleware](./api-middleware.md).

## Tests

- Lifecycle engine: `src/lib/turn/billLifecycle/engine.test.ts`, `engineCountryScope.test.ts`, `rules.test.ts`, `resolvePhaseVotes.test.ts`, `regionalEngine.test.ts`, `regionalEngine.budgetGate.test.ts`, `configs/configuredCountry.test.ts`, `__tests__/chambersFor.test.ts`, `__tests__/joinConflictClose.test.ts`, `__tests__/voteOpenNotice.test.ts`.
- Legacy lifecycle and helpers: `src/lib/billLifecycle.test.ts`, `src/lib/billLifecycleHelpers.test.ts`, `src/lib/billLifecycle.budgetGate.test.ts`.
- Pass rules and voting: `src/lib/congress/billPassRule.test.ts`, `billVoting.test.ts`, `billProposal.test.ts`, `billProposalLimits.test.ts`.
- Proposal and actions: `src/lib/legislature/commands/proposeNationalBill.test.ts`, `proposeStateBill.test.ts`, `nationalBillActions.test.ts`, `stateBillActions.budgetGate.test.ts`.
- Enactment and effects: `src/lib/billEnactment.test.ts`, `billEnactment.budgetGate.test.ts`, `src/lib/legislationEffects.test.ts`, `src/lib/presidentialBillAction.test.ts`.
- Approval impacts: `src/lib/archetypeAffinities.test.ts`, `archetypeAffinities.shiftDirection.test.ts`, `archetypeAffinities.cn.test.ts`.
- Decay and formulas: `src/lib/turn/metricDecay.test.ts`, `shared/constants/formulas.test.ts`, `shared/constants/formulas.intensity.test.ts`.

Gaps: no dedicated test file for `clotureRules.ts` (the cloture path is covered through engine tests and the wiki chart tests in `src/lib/wiki/charts/legislature.test.ts`), no test that the refund respects the action cap end to end, and no automated check that the UK type counts on this page match the seed.

## Known issues and history

- **Cloture wording mismatch.** The in-game notification sent to the sponsor says "3/5 of votes cast"; the rule counts For + Against + Abstain (`clotureRules.ts`). Abstentions therefore raise the bar more than the message suggests.
- **Two influence currencies.** Proposals spend `nationalInfluence`; the filibuster spends `politicalInfluence`. Both are called NPI in places on this page and in the UI, which is easy to confuse.
- **UK type counts.** The per-category counts are from an earlier 55-type catalogue and are indicative only; the seed holds 62 UK types.
- **Option count.** The "7 options, -3 to +3" description is the legacy ladder; `policyOptionIndex` in `src/lib/db/types/statePolicy.ts` notes newer political laws use 0 to 4. Not fully reconciled on this page.
- **Amendments** are not implemented; the detail page shows a placeholder card.
- **Committee system (planned).** Bills would go through committees first, with committee approval required before a floor vote. Status: planned for later.
- **Leadership control (partly done).** Speaker of the House, House Majority/Minority Leader, Senate President Pro Tempore, and Senate Majority/Minority Leader are all implemented (24-hour plurality elections). Motion to Vacate the Speaker is also implemented. Leadership control over agenda and committee assignments is still planned. See [Congress Leadership](./congress-leadership.md).
- **Corporation system (planned).** Corporations affected by policy bills and an economic simulation layer. Status: planned for later.
- **History.** The US tax types moved from a 6-8 option scale to 11 brackets, and the US legislation types moved from a delta cost model to an absolute cost model (v3 overhaul, described above). Approval impacts moved from voter archetypes to census buckets.

Last checked: 2026-10-29, version 1.18.0
