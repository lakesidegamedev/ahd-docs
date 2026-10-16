# Bills & Legislation

## Bill Types

Every bill needs a **category**. Policy bills need at least one **provision** (legislation type + policy option); custom bills may have no provisions.

### Policy Bills (current implementation)

- **Description**: Bills built from legislation types with named policy options and **economic/social** integer scores (-3 to +3; 0 = center). Each type has 7 options (3 left, 1 center, 3 right) with a primary axis (economic or social) per type.
- **Creation**: Any sitting Congress/Parliament member, or admins via Admin override
- **Content**: Title, summary, **category** (required), and **provisions** (1-3 per bill). Each provision is a legislation type + policy option (or effect direction). Provisions can store optional **economic** and **social** integers. Category limits which legislation types can be added (e.g. Healthcare → Medicare, Medicaid; Economy → Tax Policy, Minimum Wage, Social Security).
- **Categories**: defense, economy, education, environment, foreign policy, healthcare, industry, immigration, infrastructure, public safety, social, tax, trade, agriculture, technology, state ownership, custom. Defined in `shared/constants/legislation.ts` (`BILL_CATEGORIES`); each maps to one or more policy domains. Custom is always proposable with no provisions (flavor/roleplay).
- **Provisions**: 1-3 per bill (`MAX_PROVISIONS = 3` in `shared/constants/legislation.ts`). Each provision is one legislation type plus one policy option (or effect direction). When the bill is signed, every provision’s effect is applied to the relevant state/national metrics.
- **Cost**: `PROVISION_COSTS = [5, 10, 15]` national influence for the 1st, 2nd, 3rd provision respectively. Admins exempt. Balance shown in propose form; backend deducts on submit for non-admins. Proposing a bill (any bill, national or state) also costs a flat `BILL_PROPOSE_ACTION_COST = 10` action points.
- **Effects**: When a bill is signed (or pocket-signed), `applyLegislationEffect()` in `src/lib/legislationEffects.ts` applies each provision’s delta to its legislation type’s `effectTarget` metric.

### LegislationType Fields

Key fields on the `LegislationType` interface (`src/lib/db/types/legislation.ts`):

| Field                                 | Description                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `countryScope`                        | `"us"` \| `"uk"` \| `"international"`, which country this type belongs to. All US types are `"us"` or `"international"`; 19 UK types are `"uk"`.                                                                                                                                             |
| `effectTargetsWeighted`               | Array of weighted metric targets applied when a bill using this type is enacted.                                                                                                                                                                                                             |
| `policyOptions[].metricEffects`       | Per-option `{ category, metricId, ratePerTurn }`, direct additive metric change applied **each turn** the policy is active. Scaled for ~10-year full reversal: extreme ≈ ±0.06/turn, center = 0.                                                                                             |
| `policyOptions[].annualCostPerCapita` | **Absolute** per-capita spending level in $ per year (not a delta). Represents the total program cost at that policy level. `$0` = full abolition of the program. Positive = spending; negative = net savings/revenue (e.g., tax increases). Applied to national/state budgets when enacted. |
| `policyOptions[].minimumWageRate`     | (Minimum wage types only) The actual hourly wage in $/hour for this option. Stored alongside the standard economic/social scores so the UI can display the real dollar figure.                                                                                                               |
| `positions[].chamber`                 | `"house" \| "senate" \| "commons" \| "lords"`, committee positions for the type.                                                                                                                                                                                                             |

### US Tax System, 11-Bracket Model

All 9 US tax legislation types (`income_tax`, `corporate_tax`, `capital_gains_tax`, `payroll_tax`, `estate_tax`, `excise_tax`, `carbon_tax`, `wealth_tax`, `financial_transaction_tax`) use an **11-bracket scale** (indices 0-10) with LARP-style bill names:

| Index | Direction | Example title pattern          |
| ----- | --------- | ------------------------------ |
| 0     | Far left  | "X Expansion and Reform Act"   |
| 1-4   | Left      | Progressive-leaning rate bills |
| 5     | Center    | Status quo / baseline rate     |
| 6-9   | Right     | Rate reduction bills           |
| 10    | Far right | "X Abolition Act" / "Zero X"   |

Each bracket has an explicit `economic` score (−5 to +5), a `social` score (0 unless cross-axis), an `annualCostPerCapita` representing total per-capita revenue impact, and a LARP-style title and description. This replaced the prior 6-8 option scale.

### Absolute Cost Model

`annualCostPerCapita` on every US legislation option is an **absolute spending level**, not a delta from baseline:

- `$0` means the program is fully abolished at that option.
- Higher values mean larger government spending on that program.
- Tax types use negative values to represent net revenue collected.
- When a bill is signed, the budget system sets the program cost to the new absolute value (not adds a delta).

This contrasts with the old delta model. Re-seeding policies resets to the baseline option's absolute value.

### Natural Metric Decay

All metrics now decay naturally toward their baseline value at **0.25% per turn** when no active policy is pushing them. This prevents metrics from permanently deviating from realistic ranges after extreme legislation passes and then expires or is repealed. At 0.25%/turn, a fully-deviated metric takes approximately 20 game years (~960 turns) to return to baseline with no opposing policy active.

Implemented in `src/lib/demographicEffects.ts`.

### Federal Effect Division

Federal bills apply their metric effects to every US state. Each state receives **1/50th** of the full effect per turn (previously was 1/3). This prevents a single federal bill from dominating state-level metrics and ensures the sum of per-state effects roughly equals the intended national total across 50 states.

Configured via `FEDERAL_MULTIPLIER` in `src/lib/demographicEffects.ts`.

### US Legislation Type Changes (v3 overhaul)

- **Removed**: `medicare`, removed as redundant with `federal_healthcare_funding` and `drug_pricing_medicare`.
- **Added**: `state_spending_stimulus`, state-level economic stimulus spending legislation.
- **Added**: `state_housing`, state-level housing and development legislation.
- All ~45 remaining non-tax US types reworked with LARP-style bill names, absolute `annualCostPerCapita` values, and explicit dual-axis (`economic`, `social`) scores.

### UK Legislation Types

55 UK-specific types (seeded via `scripts/seeds/legislationTypes.ts`) cover both national (Parliament) and regional (Council) legislation. All have `countryScope: "uk"`. National types have `allowedScope: "national"`; regional types have `allowedScope: "state"`. Each has 7 policy options (spending types) or 11 brackets (tax types) with LARP-style titles, descriptions, and £/cap costs. Baseline policy values start at centrist (option #3). Seeded via admin Universal Seeder > UK Legislation, or `seed-legislation.ts`.

**34 National (Parliament) types** across 16 categories: Healthcare (4), Education (4), Economic (2), Infrastructure (2), Environment (2), Law & Justice (2), Defence (2), Foreign Policy (1), Welfare (2), Immigration (2), Labour (2), Housing (2), Governance (3), Media (2), Civil Liberties (2), plus 5 national tax types (Income Tax, NI, VAT, Corporation Tax, Excise/Customs).

**14 Regional (Council) types** plus 2 regional tax types (Council Tax, Business Rates). Regional types are subject to the **budget constraint system**, total enacted regional spending cannot exceed the region's budget (Council Tax revenue + Business Rates revenue + Westminster grant).

**7 tax types** use 11 brackets with explicit rates, LARP-style titles, and economic scores. National taxes: `uk_income_tax_rate`, `uk_national_insurance`, `uk_vat`, `uk_corporation_tax`, `uk_excise_customs`. Regional taxes: `uk_council_tax`, `uk_business_rates`.

**Key national type:** `uk_local_government_funding` controls the Westminster
grant to regions. The seated Chancellor of the Exchequer can allocate that pool
through the cabinet allocation route; `src/lib/turn/regionalBudget.ts` applies
the configured percentages, defaulting to an equal split.

**UK-specific metrics:** 14 metrics unique to the UK (e.g., `nhsWaitingTime`, `childPoverty`, `housingAffordability`, `devolutionSatisfaction`, `bbcTrust`). 4 US-only metrics excluded from UK (`uninsuredRate`, `affordabilityIndex`, `highSchoolGradRate`, `collegeEnrollment`). National effect division uses `UK_FEDERAL_MULTIPLIER = 1/12` (12 regions vs US 50 states).

**Regional Budget Constraint:** UK regions operate under a balanced-budget requirement. Revenue = Council Tax + Business Rates + Westminster grant. If enacted spending exceeds budget for more than 1 turn, forced austerity downgrades the most expensive programme one option level per turn until balanced. Property and commercial value bases drift dynamically based on investment levels (25%-300% of baseline guardrails).

Full spec: the design archive

## Bill Lifecycle

Bills move through a strict status pipeline managed by the turn processor each hour:

| Status          | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `active`        | Voting open in the origin chamber (24-hour window)                  |
| `passed_origin` | Passed origin chamber; pending transmission to second chamber       |
| `active_other`  | Voting open in the second chamber (24-hour window)                  |
| `enrolled`      | Passed both chambers; awaiting presidential action (10-hour window) |
| `signed`        | President signed, bill is law                                       |
| `vetoed`        | President vetoed the bill                                           |
| `failed`        | Failed a chamber vote or pocket-expired without presidential action |
| `withdrawn`     | Sponsor withdrew before voting opened                               |

### Proposal

1. **Cost**: Flat 10 action points to propose (`BILL_PROPOSE_ACTION_COST`). Additional provisions (2nd, 3rd) cost national influence (5, 10 respectively, on top of the 1st provision's 5); admins are exempt.
2. **Availability**: US, House or Senate members. UK, Commons members. **JP, Shūgiin or Sangiin members** (origin chamber matches the sponsor's seat). Admins can override in all countries.
3. **Required**: Category and at least one provision (legislation type + policy option). Category limits which legislation types appear in the form (see `GET /api/game/legislation-types?category=...`).
4. **Activation**: Bill immediately enters `active` status with a 24-hour `votingEndsAt` timestamp set at submission
5. **Origin chamber** is recorded from the proposing member’s selection (House, Senate, or Joint)

### Voting

1. **Window**: 24 hours per chamber
2. **Vote Options**: For / Against / Abstain (changeable before voting closes)
3. **Eligibility**: Only members of the current chamber may vote
4. **Result**: Simple majority (For > Against; abstentions are neutral)
5. **Tie Votes**: Vice President breaks ties in Senate
6. **Re-voting**: A member may change their vote at any time while voting is open

### Bicameral Process

1. Bill opens for voting in the origin chamber (House or Senate)
2. Voting closes at `votingEndsAt`; turn processor tallies all votes
3. **Passed**: status advances to `active_other` for the second chamber with a fresh 24-hour window
4. **Failed**: status set to `failed`
5. Second chamber vote closes the same way; if passed → `enrolled`

### Presidential Action

- **Sign**: Bill becomes law (`signed`); effects apply
- **Veto**: Bill fails (`vetoed`)
- **Pocket signature**: If the President takes no action within 10 hours of enrollment, the bill is automatically signed (`signed`)
- Only the character currently holding the President office sees the action panel

### Senate Filibuster / Cloture

Implemented, US Senate only (`src/lib/legislature/commands/nationalBillActions.ts`); a bill with `countryId !== "US"` is rejected.

- **Who can invoke**: Only a sitting US Senator (officeType `"senate"`). Once per character per bill.
- **Cost**: 25 action points + 5 National Political Influence (NPI).
- **Effect**: Extends the Senate's voting deadline by 12 hours, adjusted by the invoking senator's Statecraft stat (via `statMultiplier`, roughly a +/-20% band, so a stronger senator delays it more), and sets a cloture threshold of 3/5 of votes cast to pass the bill (instead of a simple majority).
- **Not usable** on a bill in status `active_both` (both chambers voting concurrently), since there is no single chamber clock to delay in that state.
- **Can be disabled**: A Senate rule change (a `statePolicies` doc with `legislationTypeId: "senate_filibuster_rules"` and `effectDirection: -1`) abolishes the filibuster; simple majority applies again.

### Veto Override

Implemented. A vetoed bill can enter status `veto_override` with its own separate voting deadline (`overrideVotingEndsAt` / `overrideVotingEndsOnTurn`).

- **Who can vote**: Any member of either chamber, via action `veto_override_vote`.
- **Weighting**: Votes are weighted by `seatsHeld`.
- **Tally**: Tracked in `vetoOverrideVotesFor` / `vetoOverrideVotesAgainst`.

## Detail Page (`/congress/bills/[id]`)

Each bill has a dedicated page showing:

- **Timeline stepper**, proposed → origin vote → second chamber → president → enacted
- **Live countdown** timer while voting is open
- **Vote bars** for both chambers (For / Against / Abstain percentages)
- **Vote buttons** for eligible members; re-voting moves the previous vote
- **Presidential action panel** (Sign / Veto), visible to the President only
- **Co-sponsors** list and full bill text
- Sidebar quick-facts (status, origin chamber, sponsor, key dates)
- Placeholder card for future **Amendments**
- **Senate Filibuster / Cloture** and **Veto Override** are implemented (see below), not placeholders

### NPP Auto-Voting

See [NPP System](./npp-system.md) for full documentation. Federal and local NPP legislators now use the same deterministic cross-pressure model:

- **Forces**: ideology + whip + district/home-region + donors
- **Federal scope**: House / Senate / Commons / upper-chamber federal votes read the baseline weighting
- **Local scope**: `stateSenate` / `regionalCouncil` bills use the same model with heavier district pressure and lighter donor pressure
- **Whips**: hard whips still force an immediate hidden-roll vote when issued; soft whips only add advisory pressure into later autonomous voting
- **Multi-seat weighting**: NPP blocs contribute their full `seatsHeld` weight to vote tallies
- **Catch-up**: Runs every turn so NPPs that gained seats after a bill opened still vote before the bill closes

## Admin Tools

Accessible via Admin → Legislation tab:

| Action            | Description                                               |
| ----------------- | --------------------------------------------------------- |
| Advance Chamber   | Skip the current chamber's vote; advance to next stage    |
| Send to President | Mark bill as `enrolled` immediately                       |
| Force Sign        | Sign the bill regardless of chamber status                |
| Force Veto        | Veto the bill regardless of chamber status                |
| Fail              | Mark the bill as `failed` immediately                     |
| Reset             | Reset bill to `active` with a fresh 24-hour voting window |

The turn processor runs `processBillLifecycle()` every turn; all status transitions happen automatically without admin intervention in normal play.

## Bill Effects

### Policy Bills (signed legislation)

- Each **provision** has a legislation type with an optional `effectTarget` (metric category + metric id + scope). When the bill is signed, `applyLegislationEffect()` applies a small delta (see `getLegislationEffectDelta` in `shared/constants/formulas.ts`) to that metric for all states (national) or per-state.
- Bills with multiple provisions apply each provision’s effect in sequence.
- Legislation types are seeded via `scripts/seeds/legislationTypes.ts` (`npm run seed:legislation`). Base policy (national and state) is seeded via `scripts/seeds/basePolicies.ts` and `scripts/seed/seed-policies.ts` (`npm run seed:policies` or `npm run seed:policies:reset`).

### Archetype Approval Impacts

When a bill is **enacted** (signed into law or veto overridden), legislators who voted FOR the bill receive archetype approval changes based on the policy shift:

| Component                | Description                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Policy domains**       | 13 domains: education, healthcare, environment, immigration, criminal_justice, defense, economic, welfare, infrastructure, governance, foreign_policy, tax, mediaInformation                         |
| **Archetype affinities** | Each archetype has a per-domain affinity (±50). Positive = likes rightward shifts, negative = likes leftward. E.g., evangelicals +35 on education (love school choice), public_sector -40 (hate it). |
| **Shift calculation**    | `shift = newPolicyIndex - oldPolicyIndex`. Moving 2 steps right = +2, 1 step left = -1.                                                                                                              |
| **Impact formula**       | `impact = shift × affinity × 0.15`, clamped to ±10 per bill. A 2-step rightward education shift gives evangelicals +10 approval.                                                                     |
| **Who gets impacts**     | All legislators who voted FOR the bill (both chambers for federal bills).                                                                                                                            |
| **When applied**         | Only at enactment (`onBillEnacted` in `src/lib/billEnactment.ts`), not during chamber voting.                                                                                                        |

**Example**: Federal Education Funding moves from index 1 (left) to index 4 (center-right), a +3 shift.

- Evangelicals (affinity +35): `3 × 35 × 0.15 = 15.75` → clamped to +10
- Public sector (affinity -40): `3 × -40 × 0.15 = -18` → clamped to -10
- Libertarians (affinity +30): `3 × 30 × 0.15 = 13.5` → clamped to +10

Implementation: `DOMAIN_AFFINITIES` and `calculateShiftImpacts()` in `src/lib/archetypeAffinities.ts`.

### Data and APIs

- **Legislation types**: `GET /api/game/legislation-types` (optional `?category=...`). Types include `policyOptions` with `economic` and `social` scores for the proposal UI.
- **Current policies**: `GET /api/game/current-policies?stateId=federal` returns `{ legislationTypeId: policyOptionIndex }` map for shift-based UI previews.
- **Propose**: `POST /api/congress/bills` with `title`, `summary`, `chamber`, `category`, and `provisions: [{ legislationTypeId, effectDirection?, economic?, social? }]`. Backend validates category and domain; deducts national influence for non-admins when provisions.length > 1.
- **Policy (base law)**: `GET /api/policy?scope=national` or `GET /api/policy?scope=state&stateId=...` returns per, legislation-type records with `economic`, `social`, and `policyOptionName` (the option that best matches the stored position). Used by the national Policy page and the state page **State Laws & Policy** tab.
- **Committee assignments**: See [Legislation System Completion Audit](./legislation-system-completion-audit.md). Committees tab on Congress page; admins assign via Admin → Legislation.

## Base policy and state laws

- **Collection**: `statePolicies` stores the current base policy per legislation type for the **nation** (one record per national-only or shared type) and for **each state** (only for non, national-only types; see `nationalOnly` on legislation types).
- **Position model**: Each record has **economic** and **social** integer scores (-3 to +3; 0 = center). The API matches the stored (economic, social) to the legislation type’s `policyOptions` and returns **policyOptionName** (exact or nearest by Manhattan distance).
- **Seed**: `scripts/seeds/basePolicies.ts` defines **national defaults** (per-type, e.g. tax +1, healthcare -1) and **state defaults** from `state.politicalLean` (bluer → more negative, redder → more positive; clamped to -3..+3). Run `npm run seed:policies` to upsert, or `npm run seed:policies:reset` to clear and reseed.
- **National Policy page**: `/policy` (USA nav) lists all national policies grouped by domain; each row shows current base **policy option name** and Economic/Social positions.
- **State Laws & Policy tab**: On each state page, a single **State Laws & Policy** tab shows state-level base policy for that state: policy area name, current base option name, and Economic/Social positions. If the list is empty, run `npm run seed:policies` (and ensure `seed:legislation` has been run so legislation types exist).

## Future Expansions

### Committee System

- Bills go through committees first
- Committee approval required before floor vote
- **Status**: Planned for later

### Leadership Control

- Speaker/Majority Leader controls agenda
- Decides which bills get voted on
- **Status**: Speaker of the House, House Majority/Minority Leader, Senate President Pro Tempore, and Senate Majority/Minority Leader are all implemented (24-hour plurality elections). Motion to Vacate the Speaker is also implemented. Leadership control over agenda/committee assignments is still planned. See [Congress Leadership](./congress-leadership.md).

### Corporation System

- Corporations affected by policy bills
- Economic simulation layer
- **Status**: Planned for later

## Legislative Strategy

### Coalition Building

- Players must build support for bills
- Need majority in both chambers + presidential signature
- Bipartisan support may be needed for controversial bills
- Vote whipping (to be added)

### Bill Priorities

- Limited actions mean strategic choices
- Writing bills vs. voting on others
- Supporting party agenda vs. personal priorities
- Voting record affects your policy positions
