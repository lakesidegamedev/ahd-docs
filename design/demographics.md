# Demographics

## Overview

**The electorate that actually casts votes is the granular Layer-1 electorate, not the 12 archetypes.** Every country runs on a lattice of granular demographic cells (the cross-product of Layer-1 census dimensions, race, age, education, wealth in the US; ethnicity, income, urbanization variants abroad), IPF-raked to each state's census marginals. This is the live vote path everywhere; there is no flag-gated archetype fallback left in the tally engine. See [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md) for the authoritative description; `src/lib/demographics/granularElectorate.ts` is the core.

The 12 US voter archetypes described below are **legacy authoring vocabulary, not the live electorate**. Gameplay systems that were written against them (character/NPP `archetypeApprovals`, legislation `demographicEffects`, Address-driven party-group favorability, GOTV/canvassing modifiers) still author effects keyed by archetype id, and `src/lib/demographics/archetypeBucketMap.ts` projects each archetype onto 2-3 Layer-1 census buckets so those effects still land on the real (cell-based) electorate. Archetypes themselves have no independent vote-share logic any more. See [Archetype Approvals](./archetype-approvals.md) for the deprecated-field detail.

## Structure (12 Archetypes, legacy authoring vocabulary)

### Voter Groups (single category)

One category `voterGroups` with 12 mutually exclusive archetypes:

| ID                    | Name                  | Econ  | Social | Turnout |
| --------------------- | --------------------- | ----- | ------ | ------- |
| young_renters         | Young Renters         | -4    | -4     | 46%     |
| evangelicals          | Evangelicals          | +4    | +5     | 73%     |
| rural_traditionalists | Rural Traditionalists | +4    | +4     | 71%     |
| union_trades          | Union & Trades        | -3    | +1     | 63%     |
| soccer_moms           | Soccer Moms           | -1    | -0.5   | 60%     |
| college_liberals      | College Liberals      | -4.5  | -5     | 67%     |
| small_business        | Small Business        | +4    | +2     | 72%     |
| public_sector         | Public Sector Workers | -3    | -3     | 67%     |
| retirees              | Retirees              | +1    | +2     | 76%     |
| libertarians          | Libertarians          | +5    | -3     | 68%     |
| new_immigrants        | New Americans         | -3    | -2     | 42%     |
| secular_professionals | Secular Professionals | -3    | -4.5   | 68%     |

> **Note:** State ideology composition modulates leans for retirees, soccer moms, union & trades, and rural traditionalists, their actual values shift slightly based on how conservative or progressive each state is.

Groups have `defaultEconomicLean`, `defaultSocialLean`, and `defaultTurnout`.

### State Demographics

Per state (`StateDemographics`):

- **categoryWeights**: `{ voterGroups: 100 }`
- **groups**: `Record<groupId, StateDemographicGroup>`
  - `population`: 0-100 (percentage of state; all 12 sum to 100)
  - `economicLean`: -5 to +5 (derived from defaults + ideology modulation)
  - `socialLean`: -5 to +5 (derived from defaults + ideology modulation)

### Derivation

Group sizes and leans are derived from Layer 1 (race, education, wealth, age, ideology) via weighted formulas. No manual per-state data entry, all values come from census-style config. See `src/lib/seeds/stateDemographics.ts`.

**Ideology modulation:** For four swing groups, leans shift based on the state's conservative/progressive ideological composition:

- **Retirees**, lean more conservative in high-evangelical/patriot states
- **Soccer Moms**, lean slightly left in high-progressive states
- **Union & Trades**, economic lean shifts with progressive vs. patriot balance
- **Rural Traditionalists**, social lean shifts with overall conservative density

### Vote / Appeal Calculation

Shared formula in `src/lib/utils/demographicAppeal.ts`, used by the election engine, poll route, and NPP dropout. "Group" here means a granular Layer-1 unit (or, for legacy-keyed inputs, the archetype projected onto units, see Overview above). The steps below describe the **group-level competitive allocation** path (primaries, polls, and the general-election fallback); live general-election vote accumulation defaults to the swing-flow model, which builds on this same appeal/reach/approval math but adds coattail, median-voter, persuasion, and incumbency drivers, see [Elections](./elections.md) and [Election Engine](./election-engine.md):

1. For each category, for each group: get state population share, group lean, turnout
2. **Reach**: `normalizeNPI(politicalInfluence)`, sqrt curve mapping influence to a 0-1 fraction of turned-out voters the candidate reaches, hard-capped at 1.0 once influence reaches 100
3. **Appeal**: position score `25 × (positionRaw/50)^1.5 + APPEAL_POSITION_FLOOR`, where `positionRaw = max(0, 50 − |econDiff|×5 − |socialDiff|×5)` and the exponent `APPEAL_POSITION_EXPONENT = 1.5` is the live default (the old γ=2 squared curve is a special case, not the default), plus a **directional bonus** of up to `DIRECTION_BONUS_PER_AXIS = 5` per axis (EP, SP) for a candidate whose lean matches the group's lean direction, ramping continuously from a center credit rather than a hard cliff, plus `normalizeNPI(politicalInfluence) × 12.5` when influence is included in appeal (presidential races), max ~50 total (position ~25 + influence ~25)
4. **Group-level allocation**: Each group contributes to the turn pool proportionally to its size. Within each group, candidates split that contribution by relative `(appeal × reach × approval × partyOrg)`. Groups vote as blocs.
5. **Approval scalar**: `(favorability / 100)^0.8` (`APPROVAL_SCALAR_EXPONENT`), voters won't support candidates they don't approve of; 0% approval = 0 votes
6. **Party org scalar** (general elections): `normalizedOrgShare ^ 0.2` (`ORG_WEIGHT_EXPONENT`), a party's normalized share of statewide Org, diminishing returns; primaries use a uniform neutral 1×
7. **Final votes**: Sum over groups of each candidate's share from that group

## Policy Positions

Candidates have `policies.economic` and `policies.social` (-5 to +5). Compared to each group's `economicLean` and `socialLean` for alignment.

## State-Level Distribution

- Each state has different `categoryWeights` and `groups` data
- Admin configurable via Admin → Demographics
- Affects which policies are popular in each state

### Default Category Weights

There is a single category, `voterGroups`, weighted 100% (`categoryWeights: { voterGroups: 100 }` in `src/lib/seeds/stateDemographics.ts`). There is no per-category weighting across race/wealth/education/ideology/age, and no gender dimension exists in the Layer-1 census dimensions (`src/lib/demographics/usDemographics.ts` has race, age, education, wealth, ideology only).

## State Political Lean

State lean is computed from demographics for display on state pages and the map (`src/lib/utils/demographics.ts`):

1. **Turnout-weighted average**: For each group, multiply population share × turnout to get voter weight. Sum `economicLean × weight` and `socialLean × weight`, divide by total weight.
2. **Display lean**: Average of economic and social lean. Clamped to −5..+5.
3. **Label**: Based on compressed thresholds matching real-world state variance:

| Display lean | Label      |
| ------------ | ---------- |
| ≤ −0.6       | Very Left  |
| −0.6 to −0.2 | Left       |
| −0.2 to +0.2 | Center     |
| +0.2 to +0.6 | Right      |
| ≥ +0.6       | Very Right |

Used for: state page top stats bar, map Political Lean mode (blue/red shading), state panel on map.

> The lean display scale is separate from election mechanics, elections use raw position differences (−5..+5) directly, not the display lean.

## State-Level Demographic Turnout

The turnout system allows strategic manipulation of voter participation through party GOTV spending and player canvassing actions. Each state tracks turnout modifiers for **21 Layer 1 demographics** (race: 5, age: 4, education: 3, wealth: 3, ideology: 6).

### Core Mechanics

**Modifiers**: Each demographic has a modifier from **-20% to +20%** (additive to baseline turnout).

**Decay**: All modifiers decay **2% per turn** toward 0%, requiring sustained investment to maintain boosts.

**Diminishing Returns**: Larger existing modifiers receive smaller boosts:

- Formula: `adjustedBoost = rawBoost × (1 - |currentModifier| / 20)`
- Example: At +10% modifier, a 1% boost becomes 0.5% effective boost

### Party GOTV (Passive)

Each party budget (national or state-level) targets a single chosen demographic (`gotvTargetCategory` / `gotvTargetGroup`) and spends automatically each turn:

1. **Spend**: `gotvBudgetPercent` (0-25% of hourly revenue) is the primary path; a legacy flat `gotvBudgetPerTurn` amount is used only when the percent field is 0.
2. **Alignment**: A continuous multiplier scales the boost by how close the party's position is to the target demographic's lean, `max(0.1, 1.0 - distance × 0.15)` where `distance` is the Manhattan distance on economic + social axes (same curve as canvassing). There is no binary "within 2 points" eligibility cutoff, the multiplier degrades smoothly from 1.0 (perfect alignment) to a floor of 0.1.
3. **Boost**: `(spend / DOLLARS_PER_TURNOUT_POINT) × alignmentMultiplier`, where `DOLLARS_PER_TURNOUT_POINT = 5000` (`src/lib/utils/demographicAlignment.ts`). National spend is divided evenly across all states first; state-scoped spend applies in full to one state.
4. **Treasury**: Party treasury is debited by the computed GOTV spend each turn.

Source: `src/lib/turn/demographicTurnoutTurn.ts` and `src/lib/turn/demographicTurnoutCalculations.ts`.

### Player Canvassing (Active)

Campaign action to boost a specific demographic in the candidate's home state:

**Cost**: 100 funds, 1 action point

**Effectiveness Formula**:

```
baseBoost = 0.05%
distance = |charEcon - demoEcon| + |charSocial - demoSocial|
alignmentMultiplier = max(0.1, 1.0 - distance × 0.15)
seasonMultiplier = isActiveCampaignSeason ? 2.0 : 1.0
finalBoost = baseBoost × alignmentMultiplier × seasonMultiplier
```

**Alignment Scaling**:

- Perfect alignment (distance 0): 1.0x multiplier
- Poor alignment (distance 10): 0.1x multiplier (minimum)

**Campaign Season**: Active campaign season = 4 turns before election. During this period, canvassing is **2x more effective**.

**Immediate Effect**: Unlike other actions, canvassing applies its effect immediately (not queued until turn processing).

### Election Integration

State-specific turnout modifiers are applied to election calculations via `deriveGroupTurnout`:

1. **Baseline turnout** for each voter group (e.g., Young Renters: 38%)
2. **Layer 1 contribution**: Each voter group is composed of Layer 1 demographics (race, age, education, wealth, ideology)
3. **Modifier application**: For each Layer 1 demographic in the composition, apply state-specific modifier
4. **Final turnout**: `baseline + sum(layer1Modifiers × layer1Weight)`

**Example**: Young Renters in PA:

- Baseline: 38%
- Composed of: Young (age), Renters (wealth), etc.
- If PA Young modifier is +5%, final turnout ≈ 43%

### Data Structures

**StateDemographicTurnout** (`stateDemographicTurnout` collection):

```typescript
{
  _id: "PA",  // state ID
  modifiers: {
    race: { white: 2.5, black: -1.2, hispanic: 0, asian: 0, other: 0 },
    age: { young: 5.0, mid: 0, mature: -0.5, senior: 1.0 },
    education: { no_college: 0, college: 3.5, graduate: 2.0 },
    wealth: { low: -1.0, middle: 0, high: 0.5 },
    ideology: { evangelicals: 0, environmentalists: 4.0, ... }
  },
  lastDecayApplied: Date,
  lastUpdated: Date
}
```

**PartyBudget** (`partyBudgets` collection):

```typescript
{
  _id: ObjectId,
  partyId: "DEM",
  scope: "state",  // or "national"
  stateId: "PA",   // required if scope === "state"
  treasury: 10000,
  gotvBudgetPerTurn: 100,
  chairCharacterId: ObjectId | null,
  createdAt: Date,
  updatedAt: Date
}
```

### Turn Processing Order

Demographic turnout processing occurs in **sequential order** during turn processing:

1. **Decay**: Apply 2% decay to all existing modifiers
2. **Party GOTV**: Process all active party budgets, apply alignment-based boosts
3. **Player Canvassing**: Process queued canvassing actions (currently immediate, but designed for queue integration)

### UI Components

**Turnout Display** (`/state/[id]` → "Turnout" tab):

- Shows baseline, modifier, and actual turnout for all 21 Layer 1 demographics
- Color-coded: green = boosted, red = decreased
- Grouped by category (race, age, education, wealth, ideology)

**Canvassing Panel** (`/campaign/[id]` → "Canvassing" section):

- Two-step selection: category → specific group
- Shows cost (100 funds, 1 action)
- Displays effectiveness factors (alignment, campaign season)

### Admin Controls

**Party Budget Management** (`/api/admin/party-budget`):

- GET: Fetch budgets with optional partyId/stateId filters
- POST: Update `gotvBudgetPerTurn` or `treasury`
- Admin-only endpoint

### Implementation Files

**Core Logic**:

- `src/lib/turn/demographicTurnoutTurn.ts`, Turn processing (decay, GOTV, canvassing)
- `src/lib/utils/turnoutDecay.ts`, 2% decay formula with threshold rounding
- `src/lib/utils/demographicAlignment.ts`, Party GOTV alignment filtering
- `src/lib/utils/diminishingReturns.ts`, Diminishing returns calculation

**Election Integration**:

- `src/lib/seeds/stateDemographics.ts`, `deriveGroupTurnout` (applies state modifiers), `computeLiveGroupTurnouts` (fetches state modifiers from DB)

**API Routes**:

- `src/app/api/canvassing/route.ts`, Player canvassing endpoint
- `src/app/api/admin/party-budget/route.ts`, Party budget management
- `src/app/api/state/[id]/turnout/route.ts`, View turnout data

**UI Components**:

- `src/app/campaign/[id]/components/CanvassingPanel.tsx`, Canvassing interface
- `src/app/state/[id]/components/TurnoutDisplay.tsx`, Turnout visualization

**Types & Collections**:

- `src/lib/db/types/stateDemographicTurnout.ts`, StateDemographicTurnout type
- `src/lib/db/types/partyBudget.ts`, PartyBudget type (discriminated union)
- `src/lib/db/collections/`, Collection getters

**Tests**:

- `tests/integration/demographicTurnout.test.ts`, Integration test suite

## How Demographics Affect Gameplay

### Elections (Primary & General)

- Primary: Score = alignment to party position + favorability bonus + influence bonus
- General: Vote potential from demographic appeal × reach; votes distributed proportionally each turn

### Polling

- Quick Poll: Topline appeal, best/worst 5 groups
- Full Demographic Poll: Breakdown by every category and group

## Related Documentation

- [Election Mechanics](./elections.md), Vote accumulation, primary score
- [Stats & Actions](./stats-actions.md), Poll actions
- [Technical Architecture](./technical-architecture.md), Collections: demographicCategories, stateDemographics
