# Demographics

## Summary

Player guide: [Demographics](https://www.ahousedividedgame.com/wiki/demographics). Strategy companion: [Demographics & Targeting](https://www.ahousedividedgame.com/wiki/demographics-targeting).

This is the technical reference for who votes, how many of them turn out, how a candidate's appeal to each group is scored, and how party GOTV and player canvassing move turnout. The strategy-level summary is in [Demographics and Targeting (design)](./demographics-targeting.md). Canvassing from the player's side is in [Canvassing (design)](./canvassing.md).

**The electorate that actually casts votes is the granular Layer-1 electorate, not the 12 archetypes.** Every country runs on a lattice of granular demographic cells (the cross-product of Layer-1 census dimensions, race, age, education, wealth in the US; ethnicity, income, urbanization variants abroad), IPF-raked to each state's census marginals. This is the live vote path everywhere; there is no flag-gated archetype fallback left in the tally engine. See [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md) for the authoritative description; `src/lib/demographics/granularElectorate.ts` is the core.

The 12 US voter archetypes described below are **legacy authoring vocabulary, not the live electorate**. Gameplay systems that were written against them (character/NPP `archetypeApprovals`, legislation `demographicEffects`, Address-driven party-group favorability, GOTV/canvassing modifiers) still author effects keyed by archetype id, and `src/lib/demographics/archetypeBucketMap.ts` projects each archetype onto 2-3 Layer-1 census buckets so those effects still land on the real (cell-based) electorate. Archetypes themselves have no independent vote-share logic any more. See [Archetype Approvals](./archetype-approvals.md) for the deprecated-field detail.

## Rules

### Structure (12 archetypes, legacy authoring vocabulary)

#### Voter groups (single category)

One category `voterGroups` with 12 mutually exclusive archetype ids: `young_renters`, `evangelicals`, `rural_traditionalists`, `union_trades`, `soccer_moms`, `college_liberals`, `small_business`, `public_sector`, `retirees`, `libertarians`, `new_immigrants`, `secular_professionals`.

Each carries a default economic lean, social lean and turnout, which differ by country (the UK set in `src/lib/countries/uk/data/ukDemographicCategories.ts` is not the US set). Those per-archetype numbers are authoring defaults and are not live vote inputs, so they are not tabulated here: the live numbers per cell come from the census position tables in `src/lib/demographics/` (the US Layer-1 table is `src/lib/countries/us/data/usDemographics.ts`, re-exported by `src/lib/demographics/usDemographics.ts`). The mapping of each archetype onto census buckets is `src/lib/demographics/archetypeBucketMap.ts`; non-US archetypes project through `src/lib/demographics/countryArchetypeBuckets.ts`.

> **Note:** State ideology composition modulates leans for retirees, soccer moms, union & trades, and rural traditionalists, their actual values shift slightly based on how conservative or progressive each state is.

Groups have `defaultEconomicLean`, `defaultSocialLean`, and `defaultTurnout`.

#### State demographics

Per state (`StateDemographics`, `src/lib/db/types/demographics.ts`):

- **categoryWeights**: `{ voterGroups: 100 }`
- **groups**: `Record<groupId, StateDemographicGroup>`
  - `population`: 0-100 (percentage of state; all 12 sum to 100)
  - `economicLean`: -5 to +5 (derived from defaults + ideology modulation)
  - `socialLean`: -5 to +5 (derived from defaults + ideology modulation)
  - `turnout`: the derived archetype turnout, always stored from the underlying Layer 1

#### Derivation

Group sizes and leans are derived from Layer 1 (race, education, wealth, age, ideology) via weighted formulas. No manual per-state data entry, all values come from census-style config. See `src/lib/seeds/stateDemographics.ts` and `src/lib/seeds/stateDemographicsPure.ts`.

**Ideology modulation:** For four swing groups, leans shift based on the state's conservative/progressive ideological composition:

- **Retirees**, lean more conservative in high-evangelical/patriot states
- **Soccer Moms**, lean slightly left in high-progressive states
- **Union & Trades**, economic lean shifts with progressive vs. patriot balance
- **Rural Traditionalists**, social lean shifts with overall conservative density

#### Policy positions

Candidates have `policies.economic` and `policies.social` (-5 to +5). Compared to each group's `economicLean` and `socialLean` for alignment.

#### Default category weights

There is a single category, `voterGroups`, weighted 100% (`categoryWeights: { voterGroups: 100 }` in `src/lib/seeds/stateDemographics.ts`). There is no per-category weighting across race/wealth/education/ideology/age, and no gender dimension exists in the Layer-1 census dimensions (`src/lib/countries/us/data/usDemographics.ts` has race 5, age 4, education 3, wealth 3 and ideology 6 groups only).

### Vote / appeal calculation

Shared formula in `src/lib/utils/demographicAppeal.ts`, used by the election engine, poll route, and NPP dropout. "Group" here means a granular Layer-1 unit (or, for legacy-keyed inputs, the archetype projected onto units, see Summary above). The steps below describe the **group-level competitive allocation** path (primaries, polls, and the general-election fallback); live general-election vote accumulation defaults to the swing-flow model, which builds on this same appeal/reach/approval math but adds coattail, median-voter, persuasion, and incumbency drivers, see [Elections](./elections.md) and [Election Engine](./election-engine.md):

1. For each category, for each group: get state population share, group lean, turnout
2. **Reach**: `normalizeNPI(politicalInfluence)` = `sqrt(min(100, max(0, PI)) / 100)` (`src/lib/utils/normalizeNPI.ts`), a sqrt curve mapping influence to a 0-1 fraction of turned-out voters the candidate reaches, hard-capped at 1.0 once influence reaches 100 (PI 25 gives 0.5, PI 50 gives 0.707). US presidential primaries use a different reach curve, `1 - exp(-PI / 45)` (`normalizeNationalReachPresidentialPrimary`, same file), not covered here.
3. **Appeal**: position score `25 × (positionRaw/50)^1.5 + APPEAL_POSITION_FLOOR`, where `positionRaw = max(0, 50 - |econDiff|×5 - |socialDiff|×5)`, `APPEAL_POSITION_EXPONENT = 1.5` and `APPEAL_POSITION_FLOOR = 0.5` (the old squared curve is a special case, not the default), plus a **directional bonus** of up to `DIRECTION_BONUS_PER_AXIS = 5` per axis (economic, social) for a candidate whose lean matches the group's lean direction, plus `normalizeNPI(politicalInfluence) × 12.5` only when influence is included in appeal (presidential races; state races use influence for reach only). All in `src/lib/utils/demographicAppeal.ts` (`calcAppeal`). `MAX_APPEAL = 50` is the declared ceiling; the practical maximum is position 25.5 + direction 10 + influence 12.5 = 48 in a presidential race and 35.5 in a state race
   - The directional factor per axis ramps from `CENTER_FRACTION = 1/3` for a dead-center candidate up to 1.0 once the candidate leans `DIRECTION_RAMP = 0.5` the group's way, and falls to 0 when opposed. Formula: `lean = clamp(charAxis / 0.5, -1, 1)`, `align = lean × sign(groupAxis)`, `factor = clamp(1/3 + (2/3) × align, 0, 1)`. A neutral group (lean 0) grants no bonus. If a leaning candidate disagrees in sign with their party on an axis, the bonus on that axis is 0.
4. **Group-level allocation**: Each group contributes to the turn pool proportionally to its size. Within each group, candidates split that contribution by relative `(appeal × reach × approval × partyOrg)`. Groups vote as blocs.
5. **Approval scalar**: `(favorability / 100)^0.8` (`APPROVAL_SCALAR_EXPONENT`, `approvalScalar`), voters won't support candidates they don't approve of; 0% approval = 0 votes; favorability is clamped to 0-100 and defaults to 50 when missing
6. **Party org scalar** (general elections): `normalizedOrgShare ^ 0.2` (`ORG_WEIGHT_EXPONENT` in `src/lib/electionEngine/electionFormulaFactors.ts`), a party's normalized share of statewide Org, diminishing returns; primaries use a uniform neutral 1×
7. **Final votes**: Sum over groups of each candidate's share from that group

### State political lean

State lean is computed from demographics for display on state pages and the map (`src/lib/utils/demographics.ts`, `calculateStateLean`, `getDisplayLean` and `getLeanLabel`; the cached value is built by `calculateStateLeanForCache` in `src/lib/demographics/cachedStateLean.ts`):

1. **Turnout-weighted average**: For each group, weight = (population share / 100) × (turnout / 100) × (category weight / 100). A category absent from `categoryWeights` contributes 0. Turnout falls back to the group's `defaultTurnout`, then 55. Sum `economicLean × weight` and `socialLean × weight`, divide by total weight. Each axis is rounded to 2 decimals and clamped to -5..+5. Zero total weight gives 0, 0.
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

So any display lean with absolute value under 0.5 reads "Centrist". Where the granular substrate drives the lean, state leans stay well under 1 in absolute value, so most states label Centrist; the map shading uses a continuous scale fitted to the observed spread instead of these steps. This is why a state can look purple on the map and still be labelled "Centrist" on its page. Which path produces the cached lean depends on the preset, see Configuration.

Used for: state page top stats bar, map Political Lean mode, state panel on map. If a state has no cached lean, `getStateLean` falls back to the 2020 election margin (`ELECTION_2020_MARGIN`), then 0.

> The lean display scale is separate from election mechanics, elections use raw position differences (-5..+5) directly, not the display lean.

### State-level demographic turnout

The turnout system allows strategic manipulation of voter participation through party GOTV spending and player canvassing actions. Each state tracks turnout modifiers per census bucket (US: race 5, age 4, education 3, wealth 3, ideology 6 = 21 buckets; other countries use their own dimensions).

#### Constants

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
| Canvass rate limit | 60 requests per 60 seconds per user | `src/app/api/canvassing/route.ts` |
| `DOLLARS_PER_TURNOUT_POINT` | 5000 | `src/lib/utils/demographicAlignment.ts` |
| GOTV alignment multiplier | `max(0.1, 1 - 0.15 × Manhattan distance)` | `src/lib/utils/demographicAlignment.ts` (`calculateAlignmentMultiplier`) |
| `MAX_GOTV_PERCENT` | 25 (whole percent of hourly revenue) | `src/lib/api/schemas/settings.ts` |
| Legacy decay | 2% per turn (`DECAY_RATE = 0.02`), zero threshold 0.01 | `src/lib/utils/turnoutDecay.ts` |
| Legacy canvass | base 0.05 point × `max(0.1, 1 - 0.15 × Manhattan distance)` × (2 in season) | `calculateCanvassingBoost` in `src/lib/turn/demographicTurnoutCalculations.ts` |
| Legislation drift decay | 0.25% per turn toward baseline when no law targets the group (`LEAN_TURNOUT_DECAY_RATE_PER_TURN = 0.0025`); cumulative law-driven turnout shift capped at 10 points (`TURNOUT_MAX_DEVIATION_FROM_BASELINE`) | `src/lib/demographicEffects.ts` |

#### Core mechanics

**Modifiers**: Each bucket has a modifier from -20 to +20 points (additive to baseline turnout).

**Two modifier sets (plus a canvass ledger).** Each state turnout document holds `campaignModifiers` (read by races stamped with campaign rules version 1, via `turnoutForElection`) and the older `modifiers` (read by races that predate it). Both are updated by every GOTV action and both decay each turn. The difference is in the numbers:

| | Campaign rules v1 (`campaignModifiers`) | Legacy (`modifiers`) |
| --- | --- | --- |
| Decay | half-life 6 turns | 2% per turn |
| Diminishing returns | directional (see below) | symmetric: boost × (1 minus absolute current / 20), floor 0 |
| Canvass size | `2 × fit² × closing`, fit from the share-weighted audience position | `0.05 × max(0.1, 1 - 0.15 × Manhattan distance) × closing`, distance to the bucket's Layer-1 lean |
| GOTV size | same boost as the legacy set | same boost as the campaign set |

A canvass therefore writes two different boosts, one per set (`src/app/api/canvassing/route.ts`: `modernBoost` into `campaignModifiers`, `boost` into `modifiers`), while GOTV and suppression write the same raw boost into both (`applyBoost(state, demo, boost, boost)`).

A third document field, `campaignContactModifiers`, records the realized canvass contribution only (the change actually applied to `campaignModifiers`, clamped to -20..+20). It decays on the same half-life as `campaignModifiers`.

**Decay**: Campaign modifiers decay toward 0 with a half-life of 6 turns, requiring sustained investment to maintain boosts. Why: a one-off burst of canvassing should not carry a whole term, and a 6 turn half-life means an unrefreshed modifier is down to a quarter after 12 turns.

**Diminishing returns (v1)**: Larger existing modifiers receive smaller boosts in the direction they already point (`addTurnoutBoost`):

- Formula: `adjustedBoost = rawBoost × (1 - max(0, sign(boost) × currentModifier) / 20)`, then clamp to -20..+20.
- Example: At +10 points, a +1 boost becomes +0.5. A positive boost on a negative modifier is not reduced, so a suppressed bucket recovers at full speed.

#### Party GOTV (passive)

Each party budget (national or state-level) targets a single chosen demographic (`gotvTargetCategory` / `gotvTargetGroup`) and spends automatically each turn:

1. **Spend**: `gotvBudgetPercent` (0-25% of hourly revenue, `floor(revenue × percent / 100)`) is the primary path; a legacy flat `gotvBudgetPerTurn` amount is used only when the percent field is 0 (`calculateGOTVSpend`).
2. **Alignment**: A continuous multiplier scales the boost by how close the party's position is to the target demographic's lean, `max(0.1, 1.0 - distance × 0.15)` where `distance` is the Manhattan distance on economic + social axes (same curve as the legacy canvassing curve). There is no binary "within 2 points" eligibility cutoff (the helper `isWithinTwoPoints` still exists in `src/lib/utils/demographicAlignment.ts` but nothing in the turn uses it), the multiplier degrades smoothly from 1.0 (perfect alignment) to a floor of 0.1.
3. **Boost**: `(spend / DOLLARS_PER_TURNOUT_POINT) × alignmentMultiplier`. National spend is divided evenly across the regions of the party's own country first (`calculateNationalGOTVBoost`); state-scoped spend applies in full to one state (`calculateStateGOTVBoost`).
4. **Treasury**: The treasury is debited by the computed GOTV spend each turn: a state budget draws on the state party treasury, a national budget on the national party treasury. A budget whose target is stale (unknown group, or a state with no turnout document) produces no effect and is not charged. If the treasury is below the spend, GOTV does not run that turn. If the treasury is negative, every spending percent on that budget is reset to 0.
5. **Who sets it**: the national party chair, vice chair, treasurer or an admin, through `POST /api/country/[code]/parties/[id]/gotv`. The percent must be a whole number from 0 to 25, and a target category and group must be given together.

Source: `src/lib/turn/demographicTurnoutTurn.ts` (`processPartyGOTV`) and `src/lib/turn/demographicTurnoutCalculations.ts` (`applyBoost`).

**Sibling spends in the same pass.** The same loop also runs voter suppression (a negative boost with the same formula, target in `suppressionTargetCategory` / `suppressionTargetGroup`, percent in `suppressionBudgetPercent`) and voter-registration drives (`registrationBudgetPercent`, spending the same `DOLLARS_PER_TURNOUT_POINT` rate into registration pools, capped at `REG_DRIVE_MAX_BOOST_PER_STATE = 0.1` point per state in `src/lib/parties/registrationDrive.ts`). Both are described with the party systems in [Parties](./parties.md), not here.

#### Player canvassing (active)

Campaign action to boost a specific demographic in the candidate's active campaign state (home state by default; presidential candidates use their travel or primary state; a running mate may canvass the ticket's travel state, drawing on the ticket's shared daily surrogate pool):

**Cost**: 100 funds and 1 action point per canvass, up to 50 canvasses in one request.

**Effectiveness formula** (`canvassingBoost` in `src/lib/campaignTargeting/rules.ts`):

```
CANVASS_BASE_BOOST = 2
distance² = ((candEcon - audienceEcon)² + (candSocial - audienceSocial)²) / 2
campaignFit = 0.2 + 0.8 × exp(-distance² / 18)
finalBoost = CANVASS_BASE_BOOST × campaignFit² × (closing ? 2 : 1)
```

`audience` is the share-weighted mean position of the cells in the targeted bucket (`targetAudience`).

**Fit scaling**:

- Perfect alignment (distance 0): fit 1.0, full boost of 2 points
- Poor alignment: fit falls toward the 0.2 floor, so the boost bottoms out at 0.04 of base (2 × 0.2² = 0.08 points)

**Closing**: the closing multiplier applies when an active state race in that state, or the national presidential race of the character's country, ends within the next 4 turns (`checkActiveCampaignSeason`: `endTurn` between the current turn and the current turn + 4).

**Immediate effect**: Unlike party GOTV, canvassing applies its effect immediately (not queued until turn processing), and `canvassingProcessed` in the turn summary is always 0. The write is crash-safe and idempotent: funds, actions and the turnout write are keyed legs of one flow, and an `Idempotency-Key` header replays a stored outcome without charging twice.

**Legacy set**: for the older `modifiers` set the route still applies the `calculateCanvassingBoost` formula (0.05 base, Manhattan alignment, season ×2) with symmetric diminishing returns, once per canvass in the batch. It is the weaker of the two. When a native (non-legacy) bucket has no legacy equivalent, the legacy boost is 0.

#### Election integration

State-specific turnout modifiers are applied to election calculations through the granular electorate (`src/lib/demographics/granularElectorate.ts`): US dimension-keyed modifiers (`modifiers.race.white`) apply natively to the matching bucket rates, and a cell's turnout is blended from its buckets' rates plus the modifiers of every bucket it belongs to. Archetype-keyed modifiers (`modifiers.voterGroups`) are projected onto buckets through `archetypeBucketMap.ts`. Ideology modifiers have no cell axis and are dropped on that path; races on campaign rules version 1 build their audience from `campaignModifiers` through `src/lib/campaignTargeting/audience.ts`, which preserves ideology identities. See [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md).

`deriveGroupTurnout` and `computeLiveGroupTurnouts` (`src/lib/seeds/stateDemographics.ts`) remain the archetype-group path used by polls and legacy-keyed inputs: `final turnout = baseline + sum(layer1Modifiers × layer1Weight)`.

#### How demographics affect gameplay

- **Primary:** Score = alignment to party position + favorability bonus + influence bonus.
- **General:** Vote potential from demographic appeal × reach; votes distributed proportionally each turn.
- **Quick Poll:** Topline appeal, best/worst 5 groups.
- **Full Demographic Poll:** Breakdown by every category and group.

## Data

| Collection | Fields used | Read or written by | Player-visible |
| --- | --- | --- | --- |
| `stateDemographicTurnout` | `_id` (region), `countryId`, `modifiers`, `campaignModifiers`, `campaignContactModifiers`, `lastDecayApplied`, `lastUpdated` | Written by decay, GOTV and the canvass route; read by the tally and polls | Yes: `GET /api/country/[code]/region/[id]/turnout` returns baselines, modifiers and actual turnout per bucket |
| `partyBudgets` | `partyId`, `countryId`, `scope`, `stateId`, `gotvBudgetPercent`, `gotvBudgetPerTurn`, `gotvTargetCategory`, `gotvTargetGroup`, plus suppression, registration and org-building percents | Read by `processPartyGOTV`; written by the party budget routes (the reset-on-negative-treasury path writes it back) | Party officers see their own budgets |
| `politicalParties` (`treasury`, position) and `statePartyOrg` (`treasury`) | treasury debited by GOTV spend | Read and debited by `processPartyGOTV` | Treasury is shown to party officers |
| `stateDemographics` | `categoryWeights`, `groups.*.{population,economicLean,socialLean,turnout}`, `cachedEconomicLean`, `cachedSocialLean`, `layer1PositionOverrides`, `layer1TurnoutOverrides` | Read by the lean calculation, appeal and polls; written by seeding, legislation drift and the lean cache | Lean, label and group sizes on the region page and map |
| `demographicDefaults` | same shape, the durable base | Read by the granular substrate and the campaign audience | Indirect |
| `demographicCategories` | archetype group defaults | Read by `loadDemographicCategories` | No |
| `characters` | `policies.economic`, `policies.social`, `politicalInfluence`, funds, actions | Read by canvassing and appeal; funds and actions debited by canvassing | Own stats |
| `elections` | `campaignRulesVersion`, `endTurn`, `endTime`, `state`, `electionType`, `countryId` | Read for the rules version and the closing window | Race pages |

```typescript
// StateDemographicTurnout (stateDemographicTurnout collection)
{
  _id: "PA",
  countryId: "US",
  modifiers: {
    race: { white: 2.5, black: -1.2, hispanic: 0, asian: 0, other: 0 },
    age: { young: 5.0, mid: 0, mature: -0.5, senior: 1.0 },
    education: { no_college: 0, college: 3.5, graduate: 2.0 },
    wealth: { low: -1.0, middle: 0, high: 0.5 },
    ideology: { evangelicals: 0, environmentalists: 4.0, ... }
  },
  campaignModifiers: { /* same shape, read by campaign-rules-v1 races */ },
  campaignContactModifiers: { /* canvass-only component */ },
  lastDecayApplied: Date,
  lastUpdated: Date
}

// PartyBudget (partyBudgets collection), national or state scope
{
  _id: ObjectId,
  partyId: "DEM",
  countryId: "US",
  scope: "state",  // or "national"
  stateId: "PA",   // required if scope === "state"
  gotvBudgetPercent: 5,    // 0-25
  gotvBudgetPerTurn: 100,  // legacy, used only when percent is 0
  gotvTargetCategory: "age",
  gotvTargetGroup: "young",
  suppressionBudgetPercent: 0,
  orgBuildingPercent: 0,
  registrationBudgetPercent: 0,
  createdAt: Date,
  updatedAt: Date
}
```

The treasury is not stored on the budget; it is read from the party (national) or the state party row (state). Types: `src/lib/db/types/stateDemographicTurnout.ts`, `src/lib/db/types/partyBudget.ts`, `src/lib/db/types/demographics.ts`.

## Configuration

There is no gameConfig switch for the turnout or appeal math. Behaviour is set by constants (see Rules), the race's rules version, the preset and per-budget settings.

| Setting | Default | Where set |
| --- | --- | --- |
| `campaignRulesVersion` on an election | stamped 1 on new races, absent on older ones (treated as 0, legacy rules) | `withCampaignRules` in `src/lib/campaignTargeting/rules.ts` |
| `gotvBudgetPercent` | 0, max 25, whole numbers | `gotvBudgetSchema` in `src/lib/api/schemas/settings.ts`, set per budget |
| `gotvBudgetPerTurn` | legacy flat spend, used only when percent is 0 | `partyBudgets` row |
| GOTV target | none; GOTV does nothing without a category and group | `partyBudgets` row |
| `categoryWeights` | `{ voterGroups: 100 }` | `src/lib/seeds/stateDemographics.ts` |
| Cached state lean path | granular substrate only for the US `1953-default` preset; every other preset uses the archetype-level `calculateStateLean` | `calculateStateLeanForCache` in `src/lib/demographics/cachedStateLean.ts` |
| Closing window | 4 turns | `checkActiveCampaignSeason` in `src/app/api/canvassing/route.ts` |
| Forex scaling of the canvass fund cost | on when forex is enabled: 100 anchor funds times the frozen campaign rate; off: 100 | `isForexEnabled`, `campaignLocalRate` in the canvass route |
| Appeal exponents | position 1.5, approval 0.8, org 0.2 | `demographicAppeal.ts`, `electionFormulaFactors.ts` |

Country and era variants: US turnout buckets are the 21 listed above; other countries use their own Layer-1 dimensions (`src/lib/demographics/countryDemographics.ts`). Era position tables and per-state overrides shape cell positions (`src/lib/demographics/granularElectorate.ts`).

## Timing

Turnout processing runs in the `demographicsAndPartySetup` step of the turn pipeline (`src/simulation/phases/turnPhaseRegistry.ts`), in this order:

1. **`turnoutDecay`** (`applyDecayToAllStates`): decay `campaignModifiers` and `campaignContactModifiers` (half-life) and `modifiers` (2%).
2. **`partyGOTV`** (`processPartyGOTV`): spend party budgets and apply alignment-scaled boosts, so a boost bought this turn has not yet decayed.
3. **`partyOrgTurn`**, then the registration, pressure and support decay passes in the same step.

```
  canvass (any time, immediate write)
        |
        v
  [turn start] turnoutDecay  ->  partyGOTV  ->  partyOrgTurn ... (later phases) ... election tally
   decay both sets            boost both sets                                       reads post-decay,
   (6-turn half-life /        (alignment x $/pt)                                    post-GOTV modifiers
    2% per turn)
```

Election tallying runs later in the turn, so it reads the post-decay, post-GOTV modifiers. Player canvassing is not part of the turn: it writes immediately when the action is taken, so a canvass made between turns is decayed once at the start of the next turn processing before it can reach a tally. Appeal, reach, approval and Org scalars are evaluated inside the tally and in polls, not in a separate phase.

## Worked trace

**Turnout chain.** A candidate at economic +2, social +2 canvasses the age bucket `young` in a state three times in one request, outside the closing window. The bucket's share-weighted audience mean sits at -1, -1 and the bucket's Layer-1 lean is -3, -3. Starting modifier is +5.0 in both sets.

- Campaign boost: `distance² = (3² + 3²) / 2 = 9`; `fit = 0.2 + 0.8 × exp(-0.5) = 0.6852`; `fit² = 0.4695`; boost = `2 × 0.4695 = 0.9391`.
- Campaign set, directional diminishing returns per canvass: 5.0 + 0.9391 × (1 - 5/20) = 5.7043; then 5.7043 + 0.9391 × (1 - 0.2852) = 6.3755; then 6.3755 + 0.9391 × (1 - 0.3188) = 7.0152. Stored in `campaignModifiers.age.young` (7.015) and mirrored into `campaignContactModifiers`.
- Legacy set: Manhattan distance to (-3, -3) is 5 + 5 = 10, so the multiplier is `max(0.1, 1 - 1.5) = 0.1` and the boost is `0.05 × 0.1 = 0.005` per canvass. Three canvasses: 5.0 + 0.005 × 0.75 = 5.00375, then 5.00750, then 5.01125. Stored in `modifiers.age.young`.
- Cost: 3 actions and 300 anchor funds.
- Next turn, `turnoutDecay`: campaign 7.0152 × 2^(-1/6) = 7.0152 × 0.8909 = 6.2499; legacy 5.0112 × 0.98 = 4.9110.
- Same turn, `partyGOTV`: a national budget at 5% of an hourly revenue of 400,000 spends `floor(400,000 × 5 / 100) = 20,000`. The party sits at (-2, -2) and the target is `age:young` at (-3, -3), Manhattan distance 2, multiplier `1 - 0.3 = 0.7`. Across 51 regions: `20,000 / 51 = 392.16` per region, `/ 5000 = 0.07843` point, times 0.7 = 0.05490. Campaign set: 6.2499 + 0.0549 × (1 - 0.3125) = 6.2876. Legacy set: 4.9110 + 0.0549 × (1 - 0.2456) = 4.9524. The party treasury is debited 20,000 (total, not per region).
- The tally that turn reads 6.2876 for races on campaign rules v1 and 4.9524 for older races.

**Appeal and share.** A state race (influence is reach only). Candidate A: economic +2, social +1, political influence 49, favorability 64, party Org share 0.5. Group: economic +1, social +2.

- `positionRaw = max(0, 50 - 1×5 - 1×5) = 40`; position score `25 × (40/50)^1.5 + 0.5 = 25 × 0.7155 + 0.5 = 18.389`.
- Direction: economic `lean = clamp(2/0.5) = 1`, `align = 1`, factor `1/3 + 2/3 = 1`; social the same. Bonus `5 × (1 + 1) = 10`. Appeal = 28.389 (a presidential race would add `sqrt(0.49) × 12.5 = 8.75`, giving 37.139).
- Reach `sqrt(49/100) = 0.7`. Approval `0.64^0.8 = 0.6998`. Org scalar `0.5^0.2 = 0.8706`.
- Weight = `28.389 × 0.7 × 0.6998 × 0.8706 = 12.105`.
- Rival B: economic -1, social 0, influence 36, favorability 50, Org share 0.5. Position raw 30, score `25 × 0.6^1.5 + 0.5 = 12.119`; direction economic 0, social `5/3` (a centrist keeps its center credit); appeal 13.786; weight `13.786 × 0.6 × 0.5743 × 0.8706 = 4.136`.
- A's share of this group's votes = `12.105 / (12.105 + 4.136) = 74.5%` of the group's turned-out pool, which then adds into the state total.

**Lean label.** Two groups give state economic lean -0.5 and social +2.0. Signs disagree, so the display lean is the stronger axis, +2.0, which rounds to bucket +2 and reads "Lean Right". A state at economic 0.3, social 0.4 averages to 0.35, rounds to bucket 0, and reads "Centrist".

## Edge cases and limits

- **Clamp**: every modifier is held in -20..+20 after each boost.
- **Zero**: a modifier under 0.01 in absolute value snaps to exactly 0 on decay. A bucket at 0 gets the full boost.
- **Recovery is not penalised**: a positive boost on a negative modifier (and vice versa) is not reduced by diminishing returns in the campaign set. The legacy set is symmetric and does reduce it.
- **Floors**: GOTV alignment multiplier never drops below 0.1, canvass fit never below 0.2, so no party or candidate is completely locked out of a bucket, only made inefficient.
- **GOTV with no spend**: percent 0 and flat amount 0 means no boost and no treasury debit. No target group means no effect.
- **National GOTV dilution**: national spend is split only across regions in the party's own country, so a country with fewer regions gets a larger per-region boost from the same budget (a bug once split a UK budget across every country's regions and leaked boosts into foreign countries).
- **Wrong state**: canvassing outside your active campaign state returns 403. A presidential candidate with no travel or primary state set is blocked until they set one.
- **Insufficient resources**: canvassing without enough funds returns 400; actions or funds changing mid-request return 409; a concurrent turnout change returns 409.
- **Per-bucket reach**: a modifier on one bucket (for example Young) reaches every cell carrying it, whatever the cell's other attributes. Ideology buckets have no cell axis in the older granular tally path and are dropped there (a documented limitation); the campaign-rules-v1 audience model (`src/lib/campaignTargeting/audience.ts`) keeps each cell's ideology identities.
- **Legacy races**: races created before campaign rules version 1 keep the old decay and canvass behaviour, because a race in progress is never retrofitted. A race that still uses legacy canvass groups cannot be canvassed through the new bucket catalog (400).
- **Lean display**: state lean labels are integer steps, so values between -0.5 and +0.5 all read Centrist even though the map shades them differently.
- **Missing group data**: a group absent from `stateDemographics` is skipped in the lean average; a state with no weighted groups returns lean 0, 0.
- **Max appeal**: `MAX_APPEAL = 50` is declared but not enforced as a clamp; the realized maximum is 48 (presidential) or 35.5 (state), because the influence factor tops out at 1.0 (an old comment in `calcAppeal` says 2.0, which is stale).

## Invariants

- Every turnout modifier stays within -20..+20. Enforced by the clamp in `addTurnoutBoost` and `applyBoost`; tested in `demographicTurnout.integration.test.ts` ("respects +20% cap", "respects -20% cap") and `src/lib/campaignTargeting/rules.test.ts`.
- Decay never increases a modifier's magnitude. Enforced by the multiplicative decay factors; tested in `src/lib/utils/turnoutDecay.test.ts` and `rules.test.ts`.
- Canvass fit is in [0.2, 1.0] and GOTV alignment is in [0.1, 1.0]. Enforced by the floors; tested in `src/lib/utils/demographicAlignment.test.ts` and `rules.test.ts`.
- A GOTV budget never spends more than its treasury, and a stale target is never charged. Enforced in `processPartyGOTV`; `demographicTurnoutTurn.test.ts` covers the treasury ledger rows, and I did not find a test that names the stale-target no-charge case.
- 0% favorability yields 0 votes. Enforced by the power-curve form of `approvalScalar`; tested in `src/lib/electionEngine/voteDistribution.test.ts` ("zero favorability candidate gets effectively no votes").
- Appeal never reaches 0 (position floor 0.5). Enforced by `APPEAL_POSITION_FLOOR`; tested in `src/lib/utils/demographicAppeal.test.ts`.
- Group populations in a state sum to 100. Enforced at seed time by the derivation; `validateCategoryWeights` checks category weights sum to 100 (tested in `src/lib/utils/demographics.test.ts`). No runtime check on every turn.
- The two modifier sets stay in step on GOTV but not on canvassing. Not enforced by any test; the difference is by design.

## Failure and recovery

- **Missing or empty turnout documents.** `applyDecayToAllStates` logs a warning and returns when the collection is empty, so no decay runs. Repair is a reseed of the region turnout documents.
- **Corrupt modifier values.** Non-numeric or non-finite entries are dropped by `decayTurnout` on the next turn. A modifier stuck out of range is clamped on its next boost.
- **GOTV does nothing.** Usual causes: no target group, a stale target (renamed bucket or region), or a treasury below the spend. The visible symptom is no change in the region's turnout table and no treasury debit. The fix is for the party officer to reselect a valid target; a negative treasury zeroes the budget percentages and needs the treasury refilled and the budget set again.
- **Canvass partly applied.** A crash between the fund debit and the turnout write is reconciled by the keyed flow, so a client retry with the same `Idempotency-Key` converges to exactly one charge and one boost.
- **Wrong cached lean on the map.** The lean is a cache; a heal or recompute of the cached lean fields on `stateDemographics` repairs it.
- **Concurrent canvass.** A 409 "State turnout changed while canvassing" is expected under contention and safe to retry.

## Connections

**Driven by:**

- [Elections](./elections.md) and [Election Engine](./election-engine.md): races define the closing window (`checkActiveCampaignSeason`) and which rules version a race uses.
- [Parties](./parties.md): party budgets, treasury and position drive GOTV (`processPartyGOTV`).
- [Bills & Legislation](./bills-legislation.md): law effects drift group leans and turnout (`src/lib/demographicEffects.ts`).
- [Archetype Approvals](./archetype-approvals.md): legacy archetype-keyed effects projected onto buckets (`archetypeBucketMap.ts`).
- [Stats & Actions](./stats-actions.md): canvassing spends funds and action points.

**Affects:**

- [Elections](./elections.md): turnout modifiers feed cell turnout in the tally (`granularElectorate.ts`).
- [Election Engine](./election-engine.md): appeal, reach, approval and Org scalars (`demographicAppeal.ts`) set each candidate's share of each cell.
- [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md): state lean and cell positions.
- Polls: quick and full demographic polls read the same appeal math.

## Tests

- `src/lib/campaignTargeting/rules.test.ts`: canvass fit, diminishing returns, decay, rules-version gating.
- `src/lib/turn/demographicTurnout.integration.test.ts`: full turnout cycle, caps, diminishing returns.
- `src/lib/turn/demographicTurnoutTurn.test.ts`, `src/lib/turn/demographicTurnoutCalculations.test.ts`: decay pass, GOTV spend and boost, treasury handling.
- `src/lib/utils/demographicAlignment.test.ts`, `src/lib/utils/turnoutDecay.test.ts`, `src/lib/utils/diminishingReturns.test.ts`: alignment, legacy decay, legacy diminishing returns.
- `src/lib/utils/demographicAppeal.test.ts`, `src/lib/utils/normalizeNPI.test.ts`: appeal, direction bonus, approval scalar, reach curve.
- `src/lib/utils/demographics.test.ts`, `src/lib/demographics/cachedStateLean.test.ts`: state lean and the cache path.
- `src/app/api/canvassing/route.test.ts`: the canvass endpoint.

Gaps: no test pins the two-boost behaviour of a canvass (campaign versus legacy set) side by side; the label table in `getEconomicPositionName` and the 55 turnout fallback in `calculateStateLean` have no dedicated assertion that I could find; the registration and suppression passes are only indirectly covered here.

## Known issues and history

- **Corrected in this page:** the previous text said the canvass route no longer applies the legacy `calculateCanvassingBoost` formula and that one boost is added to both sets. The route still computes both: a v1 boost into `campaignModifiers` and the weaker legacy boost into `modifiers`. The previous data block also showed a `treasury` and `chairCharacterId` on `PartyBudget`; neither field exists (treasury comes from the party rows). `campaignContactModifiers`, suppression and registration spends were missing and are now listed.
- **Cached lean uses two paths.** The granular substrate drives the cached state lean only for the US `1953-default` preset; every other preset uses the older archetype-level `calculateStateLean`, whose axes are strongly collinear. The code comment in `cachedStateLean.ts` records that extending the substrate to all presets was tried and reverted, and that unifying the paths needs its own calibration audit. The comment points to a `leanAxisIndependence.test.ts` that is not in the repo.
- **Dead helper.** `isWithinTwoPoints` in `src/lib/utils/demographicAlignment.ts` is unused; the within-2-points GOTV cutoff it implemented was replaced by the continuous alignment multiplier.
- **Stale comments.** `calcAppeal` says `normalizeNPI` caps at 2.0 (it caps at 1.0). The type comment in `src/lib/db/types/stateDemographicTurnout.ts` says modifiers decay at 2% and GOTV is "aligned demographics only"; both are out of date.
- **Player wiki versus code.** The Demographics wiki page says calibrated state leans typically span about -2.5 to +2.5. The cached-lean code comments say the granular substrate keeps leans well under 1 in absolute value (hence most states label Centrist), and this page followed the code comments. The two disagree on the realistic spread and should be re-measured. The wiki's "maximum appeal about 35.5" is the state-race value; a presidential race reaches 48.
- **History.** Campaign rules version 1 introduced the 6-turn half-life, directional diminishing returns and the fit-squared canvass; older races keep the previous behaviour.

Last checked: 2026-10-29, version 1.18.0
