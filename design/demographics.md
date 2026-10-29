# Demographics

Player guide: [Demographics](https://www.ahousedividedgame.com/wiki/demographics). Strategy companion: [Demographics & Targeting](https://www.ahousedividedgame.com/wiki/demographics-targeting).

This is the technical reference for who votes, how many of them turn out, how a candidate's appeal to each group is scored, and how party GOTV and player canvassing move turnout. The strategy-level summary is in [Demographics and Targeting (design)](./demographics-targeting.md).

## Overview

**The electorate that actually casts votes is the granular Layer-1 electorate, not the 12 archetypes.** Every country runs on a lattice of granular demographic cells (the cross-product of Layer-1 census dimensions, race, age, education, wealth in the US; ethnicity, income, urbanization variants abroad), IPF-raked to each state's census marginals. This is the live vote path everywhere; there is no flag-gated archetype fallback left in the tally engine. See [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md) for the authoritative description; `src/lib/demographics/granularElectorate.ts` is the core.

The 12 US voter archetypes described below are **legacy authoring vocabulary, not the live electorate**. Gameplay systems that were written against them (character/NPP `archetypeApprovals`, legislation `demographicEffects`, Address-driven party-group favorability, GOTV/canvassing modifiers) still author effects keyed by archetype id, and `src/lib/demographics/archetypeBucketMap.ts` projects each archetype onto 2-3 Layer-1 census buckets so those effects still land on the real (cell-based) electorate. Archetypes themselves have no independent vote-share logic any more. See [Archetype Approvals](./archetype-approvals.md) for the deprecated-field detail.

## Structure (12 Archetypes, legacy authoring vocabulary)

### Voter Groups (single category)

One category `voterGroups` with 12 mutually exclusive archetype ids: `young_renters`, `evangelicals`, `rural_traditionalists`, `union_trades`, `soccer_moms`, `college_liberals`, `small_business`, `public_sector`, `retirees`, `libertarians`, `new_immigrants`, `secular_professionals`.

Each carries a default economic lean, social lean and turnout, which differ by country (the UK set in `src/lib/countries/uk/data/ukDemographicCategories.ts` is not the US set). Those per-archetype numbers are authoring defaults and are not live vote inputs, so they are not tabulated here: the live numbers per cell come from the census position tables in `src/lib/demographics/`. The mapping of each archetype onto census buckets is `src/lib/demographics/archetypeBucketMap.ts`.

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
3. **Appeal**: position score `25 × (positionRaw/50)^1.5 + APPEAL_POSITION_FLOOR`, where `positionRaw = max(0, 50 - |econDiff|×5 - |socialDiff|×5)`, `APPEAL_POSITION_EXPONENT = 1.5` and `APPEAL_POSITION_FLOOR = 0.5` (the old squared curve is a special case, not the default), plus a **directional bonus** of up to `DIRECTION_BONUS_PER_AXIS = 5` per axis (economic, social) for a candidate whose lean matches the group's lean direction, plus `normalizeNPI(politicalInfluence) × 12.5` only when influence is included in appeal (presidential races; state races use influence for reach only). All in `src/lib/utils/demographicAppeal.ts`. `MAX_APPEAL = 50` is the declared ceiling; the practical maximum is position 25.5 + direction 10 + influence 12.5 = 48 in a presidential race and 35.5 in a state race
   - The directional factor per axis ramps from `CENTER_FRACTION = 1/3` for a dead-center candidate up to 1.0 once the candidate leans `DIRECTION_RAMP = 0.5` the group's way, and falls to 0 when opposed. A neutral group (lean 0) grants no bonus. If a leaning candidate disagrees in sign with their party on an axis, the bonus on that axis is 0.
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

State lean is computed from demographics for display on state pages and the map (`src/lib/utils/demographics.ts`, `getDisplayLean` and `getLeanLabel`; the cached value is built by `calculateStateLeanForCache` in `src/lib/demographics/cachedStateLean.ts`):

1. **Turnout-weighted average**: For each group, weight = population share × turnout × category weight. Sum `economicLean × weight` and `socialLean × weight`, divide by total weight. Each axis is rounded to 2 decimals and clamped to -5..+5.
2. **Display lean** (`getDisplayLean`): if the two axes have the same sign, their average. If they disagree in sign, the stronger axis alone (so a state at econ -0.5, social +2 shows +2 rather than being compressed to center).
3. **Label** (`getEconomicPositionName`, `src/lib/utils/politics.ts`): the display lean is rounded to the nearest whole step (`roundLabelBucket`, half away from zero) and named on the shared -5..+5 ruler:

| Rounded lean | Label |
| --- | --- |
| -5 | Far Left |
| -4 | Strong Left |
| -3 | Left |
| -2 | Lean Left |
| -1 | Center-Left |
| 0 | Centrist |
| +1 | Center-Right |
| +2 | Lean Right |
| +3 | Right |
| +4 | Strong Right |
| +5 | Far Right |

So any display lean with absolute value under 0.5 reads "Centrist". The live granular substrate keeps state leans well under 1 in absolute value, so most states label Centrist; the map shading uses a continuous scale fitted to the observed spread instead of these steps. This is why a state can look purple on the map and still be labelled "Centrist" on its page.

Used for: state page top stats bar, map Political Lean mode, state panel on map.

> The lean display scale is separate from election mechanics, elections use raw position differences (-5..+5) directly, not the display lean.

## Rules: state-level demographic turnout

The turnout system allows strategic manipulation of voter participation through party GOTV spending and player canvassing actions. Each state tracks turnout modifiers per census bucket (US: race 5, age 4, education 3, wealth 3, ideology 6 = 21 buckets; other countries use their own dimensions).

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| `CAMPAIGN_RULES_VERSION` | 1 (stamped on newly inserted races only; races already in progress keep the old rules) | `src/lib/campaignTargeting/rules.ts` |
| `TURNOUT_CAP` | 20 (modifier range -20 to +20 points, additive to baseline turnout) | `src/lib/campaignTargeting/rules.ts` |
| `TURNOUT_HALF_LIFE` | 6 turns (decay factor `2^(-1/6)` = 0.8909 per turn, about 10.9% lost per turn) | `src/lib/campaignTargeting/rules.ts` |
| Decay zero threshold | modifiers under 0.01 in absolute value snap to 0 | `src/lib/campaignTargeting/rules.ts` |
| `CANVASS_BASE_BOOST` | 2 turnout points | `src/lib/campaignTargeting/rules.ts` |
| Canvass fit | `0.2 + 0.8 × exp(-d² / 18)`, floor 0.2 | `src/lib/campaignTargeting/rules.ts` |
| Closing multiplier | ×2 when a qualifying race ends within 4 turns | `src/lib/campaignTargeting/rules.ts`, `src/app/api/canvassing/route.ts` |
| Canvass cost | 100 funds (anchor-denominated, converted to local currency) and 1 action per canvass | `src/app/api/canvassing/route.ts` (`COST_FUNDS`, `COST_ACTIONS`) |
| `MAX_CANVASS_BATCH` | 50 canvasses per request | `src/app/api/canvassing/route.ts` |
| `DOLLARS_PER_TURNOUT_POINT` | 5000 | `src/lib/utils/demographicAlignment.ts` |
| GOTV alignment multiplier | `max(0.1, 1 - 0.15 × Manhattan distance)` | `src/lib/utils/demographicAlignment.ts` |
| `gotvBudgetPercent` | 0 to 25 percent of hourly revenue | `src/lib/turn/demographicTurnoutCalculations.ts` |
| Legacy decay | 2% per turn (`DECAY_RATE = 0.02`), zero threshold 0.01 | `src/lib/utils/turnoutDecay.ts` |
| Legislation drift decay | 0.25% per turn toward baseline when no law targets the group (`LEAN_TURNOUT_DECAY_RATE_PER_TURN = 0.0025`); cumulative law-driven turnout shift capped at 10 points (`TURNOUT_MAX_DEVIATION_FROM_BASELINE`) | `src/lib/demographicEffects.ts` |

### Core Mechanics

**Modifiers**: Each bucket has a modifier from -20 to +20 points (additive to baseline turnout).

**Two modifier sets.** Each state turnout document holds `campaignModifiers` (read by races stamped with campaign rules version 1, via `turnoutForElection`) and the older `modifiers` (read by races that predate it). Both are updated by every GOTV and canvass action and both decay each turn. The difference is in the numbers:

| | Campaign rules v1 (`campaignModifiers`) | Legacy (`modifiers`) |
| --- | --- | --- |
| Decay | half-life 6 turns | 2% per turn |
| Diminishing returns | directional (see below) | symmetric: boost × (1 minus absolute current / 20), floor 0 |
| Canvass size | `2 × fit² × closing` (the same boost is added to both sets) | same boost, symmetric reduction |

**Decay**: Campaign modifiers decay toward 0 with a half-life of 6 turns, requiring sustained investment to maintain boosts. Why: a one-off burst of canvassing should not carry a whole term, and a 6 turn half-life means an unrefreshed modifier is down to a quarter after 12 turns.

**Diminishing returns (v1)**: Larger existing modifiers receive smaller boosts in the direction they already point (`addTurnoutBoost`):

- Formula: `adjustedBoost = rawBoost × (1 - max(0, sign(boost) × currentModifier) / 20)`, then clamp to -20..+20.
- Example: At +10 points, a +1 boost becomes +0.5. A positive boost on a negative modifier is not reduced, so a suppressed bucket recovers at full speed.

### Party GOTV (Passive)

Each party budget (national or state-level) targets a single chosen demographic (`gotvTargetCategory` / `gotvTargetGroup`) and spends automatically each turn:

1. **Spend**: `gotvBudgetPercent` (0-25% of hourly revenue, `floor(revenue × percent / 100)`) is the primary path; a legacy flat `gotvBudgetPerTurn` amount is used only when the percent field is 0.
2. **Alignment**: A continuous multiplier scales the boost by how close the party's position is to the target demographic's lean, `max(0.1, 1.0 - distance × 0.15)` where `distance` is the Manhattan distance on economic + social axes (same curve as the legacy canvassing curve). There is no binary "within 2 points" eligibility cutoff, the multiplier degrades smoothly from 1.0 (perfect alignment) to a floor of 0.1.
3. **Boost**: `(spend / DOLLARS_PER_TURNOUT_POINT) × alignmentMultiplier`. National spend is divided evenly across the regions of the party's own country first; state-scoped spend applies in full to one state.
4. **Treasury**: Party treasury is debited by the computed GOTV spend each turn. A budget whose target is stale (unknown group, or a state with no turnout document) produces no effect and is not charged. If the treasury is below the spend, GOTV does not run that turn.

Source: `src/lib/turn/demographicTurnoutTurn.ts` and `src/lib/turn/demographicTurnoutCalculations.ts` (`applyBoost`).

### Player Canvassing (Active)

Campaign action to boost a specific demographic in the candidate's active campaign state (home state by default; presidential candidates use their travel or primary state; a running mate may canvass the ticket's travel state):

**Cost**: 100 funds and 1 action point per canvass, up to 50 canvasses in one request.

**Effectiveness Formula** (`canvassingBoost` in `src/lib/campaignTargeting/rules.ts`):

```
CANVASS_BASE_BOOST = 2
distance² = ((candEcon - audienceEcon)² + (candSocial - audienceSocial)²) / 2
campaignFit = 0.2 + 0.8 × exp(-distance² / 18)
finalBoost = CANVASS_BASE_BOOST × campaignFit² × (closing ? 2 : 1)
```

`audience` is the share-weighted mean position of the cells in the targeted bucket (`targetAudience`).

**Fit Scaling**:

- Perfect alignment (distance 0): fit 1.0, full boost of 2 points
- Poor alignment: fit falls toward the 0.2 floor, so the boost bottoms out at 0.04 of base (2 × 0.2²= 0.08 points)

**Closing**: the closing multiplier applies when an active state race in that state, or the national presidential race of the character's country, ends within the next 4 turns (`checkActiveCampaignSeason`).

**Immediate Effect**: Unlike party GOTV, canvassing applies its effect immediately (not queued until turn processing), and `canvassingProcessed` in the turn summary is always 0.

**Legacy note**: `calculateCanvassingBoost` in `src/lib/turn/demographicTurnoutCalculations.ts` (0.05 base, alignment multiplier `max(0.1, 1 - 0.15d)`, season ×2) is the pre-campaign-rules formula and is no longer what the canvass route applies.

### Worked example: canvassing a bucket

A candidate at economic +2, social +2 canvasses a bucket whose audience mean sits at -1, -1.

- `distance² = (3² + 3²) / 2 = 9`; `fit = 0.2 + 0.8 × exp(-0.5) = 0.685`; `fit² = 0.469`.
- One canvass: `2 × 0.469 = 0.94` points. In the closing window: 1.88 points.
- With a perfect-fit candidate (boost 2), ten canvasses from 0 give `20 × (1 - 0.9^10) = 13.0` points, because each canvass loses `modifier / 20` of its size. Inside the closing window (boost 4) ten canvasses give `20 × (1 - 0.8^10) = 17.9`.
- Left alone, 13.0 decays to 6.5 after 6 turns and 3.3 after 12.
- Cost of the ten canvasses: 1,000 funds and 10 actions.

The practical reading: the first few canvasses on a bucket are the efficient ones, and bursts timed for the last 4 turns carry the most weight into the vote.

### Election Integration

State-specific turnout modifiers are applied to election calculations through the granular electorate (`src/lib/demographics/granularElectorate.ts`): US dimension-keyed modifiers (`modifiers.race.white`) apply natively to the matching bucket rates, and a cell's turnout is blended from its buckets' rates plus the modifiers of every bucket it belongs to. Archetype-keyed modifiers (`modifiers.voterGroups`) are projected onto buckets through `archetypeBucketMap.ts`. Ideology modifiers have no cell axis and are dropped on that path; races on campaign rules version 1 build their audience from `campaignModifiers` through `src/lib/campaignTargeting/audience.ts`, which preserves ideology identities. See [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md).

`deriveGroupTurnout` and `computeLiveGroupTurnouts` (`src/lib/seeds/stateDemographics.ts`) remain the archetype-group path used by polls and legacy-keyed inputs: `final turnout = baseline + sum(layer1Modifiers × layer1Weight)`.

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
  campaignModifiers: { /* same shape, read by campaign-rules-v1 races */ },
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
  gotvBudgetPercent: 5,    // 0-25
  gotvBudgetPerTurn: 100,  // legacy, used only when percent is 0
  gotvTargetCategory: "age",
  gotvTargetGroup: "young",
  chairCharacterId: ObjectId | null,
  createdAt: Date,
  updatedAt: Date
}
```

## Timing

Turnout processing runs in the `demographicsAndPartySetup` step of the turn pipeline (`src/simulation/phases/turnPhaseRegistry.ts`), in this order:

1. **`turnoutDecay`** (`applyDecayToAllStates`): decay `campaignModifiers` (half-life) and `modifiers` (2%).
2. **`partyGOTV`** (`processPartyGOTV`): spend party budgets and apply alignment-scaled boosts, so a boost bought this turn has not yet decayed.
3. **`partyOrgTurn`**, then the registration, pressure and support decay passes in the same step.

Election tallying runs later in the turn, so it reads the post-decay, post-GOTV modifiers. Player canvassing is not part of the turn: it writes immediately when the action is taken, so a canvass made between turns is decayed once at the start of the next turn processing before it can reach a tally.

## Edge cases and limits

- **Clamp**: every modifier is held in -20..+20 after each boost.
- **Zero**: a modifier under 0.01 in absolute value snaps to exactly 0 on decay. A bucket at 0 gets the full boost.
- **Recovery is not penalised**: a positive boost on a negative modifier (and vice versa) is not reduced by diminishing returns.
- **Floors**: GOTV alignment multiplier never drops below 0.1, canvass fit never below 0.2, so no party or candidate is completely locked out of a bucket, only made inefficient.
- **GOTV with no spend**: percent 0 and flat amount 0 means no boost and no treasury debit.
- **National GOTV dilution**: national spend is split only across regions in the party's own country, so a country with fewer regions gets a larger per-region boost from the same budget.
- **Wrong state**: canvassing outside your active campaign state returns 403. A presidential candidate with no travel or primary state set is blocked until they set one.
- **Per-bucket reach**: a modifier on one bucket (for example Young) reaches every cell carrying it, whatever the cell's other attributes. Ideology buckets have no cell axis in the older granular tally path and are dropped there (a documented limitation); the campaign-rules-v1 audience model (`src/lib/campaignTargeting/audience.ts`) keeps each cell's ideology identities.
- **Legacy races**: races created before campaign rules version 1 keep the old decay and canvass behaviour, because a race in progress is never retrofitted.
- **Lean display**: state lean labels are integer steps, so values between -0.5 and +0.5 all read Centrist even though the map shades them differently.

## Connections

**Driven by:**

- [Elections](./elections.md) and [Election Engine](./election-engine.md): races define the closing window (`checkActiveCampaignSeason`) and which rules version a race uses.
- [Parties](./parties.md): party budgets, treasury and position drive GOTV (`processPartyGOTV`).
- [Bills & Legislation](./bills-legislation.md): law effects drift group leans and turnout (`src/lib/demographicEffects.ts`).
- [Archetype Approvals](./archetype-approvals.md): legacy archetype-keyed effects projected onto buckets.
- [Stats & Actions](./stats-actions.md): canvassing spends funds and action points.

**Affects:**

- [Elections](./elections.md): turnout modifiers feed cell turnout in the tally (`granularElectorate.ts`).
- [Election Engine](./election-engine.md): appeal, reach, approval and Org scalars (`demographicAppeal.ts`) set each candidate's share of each cell.
- [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md): state lean and cell positions.
- Polls: quick and full demographic polls read the same appeal math.

## Diagram

The turnout and vote chain is specified in the visuals list (turn order from decay through GOTV to tally, with canvassing writing in between).

## How Demographics Affect Gameplay

### Elections (Primary & General)

- Primary: Score = alignment to party position + favorability bonus + influence bonus
- General: Vote potential from demographic appeal × reach; votes distributed proportionally each turn

### Polling

- Quick Poll: Topline appeal, best/worst 5 groups
- Full Demographic Poll: Breakdown by every category and group

## Implementation Files

- `src/lib/campaignTargeting/rules.ts`: v1 decay, canvass boost, diminishing returns, ads
- `src/lib/turn/demographicTurnoutTurn.ts`: turn processing (decay, GOTV)
- `src/lib/turn/demographicTurnoutCalculations.ts`: GOTV spend, `applyBoost`
- `src/lib/utils/turnoutDecay.ts`: legacy 2% decay
- `src/lib/utils/demographicAlignment.ts`: GOTV alignment multiplier
- `src/lib/utils/demographicAppeal.ts`: appeal and approval scalar
- `src/lib/seeds/stateDemographics.ts`: `deriveGroupTurnout`, `computeLiveGroupTurnouts`
- `src/app/api/canvassing/route.ts`: canvass endpoint
- `src/app/api/admin/party-budget/route.ts`: party budget management (admin only)
- `src/app/api/country/[code]/region/[id]/turnout/route.ts`: view turnout data
- `src/lib/db/types/stateDemographicTurnout.ts`, `src/lib/db/types/partyBudget.ts`: types
- `src/lib/turn/demographicTurnout.integration.test.ts`: integration tests

## Related Documentation

- [Election Mechanics](./elections.md), Vote accumulation, primary score
- [Stats & Actions](./stats-actions.md), Poll actions
- [Technical Architecture](./technical-architecture.md), Collections: demographicCategories, stateDemographics

Last checked: 2026-10-29, version 1.18.0
