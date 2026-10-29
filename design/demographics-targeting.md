# Demographics & Targeting

## Summary

Player guide: [Demographics & Targeting](https://www.ahousedividedgame.com/wiki/demographics-targeting). Also see [Demographics](https://www.ahousedividedgame.com/wiki/demographics) and [Canvassing](https://www.ahousedividedgame.com/wiki/canvassing).

Understanding voter demographics is key to winning elections. Each state has a unique demographic profile that determines which candidates appeal to which voters. This page is the strategy-level technical summary: which constants matter when choosing where to spend actions. Full formulas and sources for the census itself are in [Demographics](./demographics.md).

**Note on the live model:** the electorate that actually casts votes is a granular census lattice of cells, not 12 archetypes, see [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md). The archetypes (Young Renters, Evangelicals, Rural Traditionalists, Union & Trades, Soccer Moms, College Liberals, Small Business, Public Sector, Retirees, Libertarians, New Americans, Secular Professionals) are legacy authoring vocabulary that gameplay effects (approvals, legislation, GOTV) are still keyed by; they project onto the real electorate via `src/lib/demographics/archetypeBucketMap.ts` rather than having independent vote logic.

Why cells: a single archetype lump hid that, for example, a young voter and a rural voter can be the same person. Cells let a voter belong to one bucket of every census dimension at once (race, age, education, wealth), so turnout and appeal act on real overlaps.

The per-archetype lean table that used to sit here is removed: those numbers are authoring defaults that differ by country and are not live vote inputs. Live leans come from the era census tables in `src/lib/demographics/`.

## Rules

### How Demographics Affect Elections

1. **Reach**: your Political Influence determines how many voters you can reach: `sqrt(min(100, max(0, PI)) / 100)` (`normalizeNPI` in `src/lib/utils/normalizeNPI.ts`). PI 25 gives 0.5, PI 50 gives 0.707, PI 100 or more gives 1.0.
2. **Appeal**: policy alignment between your positions and each cell's leans (`src/lib/utils/demographicAppeal.ts`). `APPEAL_POSITION_EXPONENT = 1.5`, `APPEAL_POSITION_FLOOR = 0.5`, `MAX_APPEAL = 50`.
3. **Turnout**: each bucket has a baseline turnout rate modified by canvassing and GOTV.
4. **Vote share**: cells where you have high appeal and they have high turnout give you more votes.

### Turnout System

Each demographic bucket has a turnout modifier from -20 to +20 points (`TURNOUT_CAP = 20`, `src/lib/campaignTargeting/rules.ts`). Two parallel modifier sets are kept (see Data): the current-rules set `campaignModifiers` and the legacy set `modifiers`.

- **Decay**: under campaign rules version 1 (`CAMPAIGN_RULES_VERSION = 1`, current elections) modifiers decay by `value × 2^(-1/6)` per turn (`TURNOUT_HALF_LIFE = 6`), about 10.9% per turn, and snap to 0 below an absolute value of 0.01 (`decayTurnout`). Elections created before that version read the legacy set, which still decays 2% per turn (`DECAY_RATE = 0.02`, `ZERO_THRESHOLD = 0.01`, `src/lib/utils/turnoutDecay.ts`).
- **Party GOTV**: your party passively boosts the one bucket its budget targets. Boost = `spend / DOLLARS_PER_TURNOUT_POINT × alignment`, with `DOLLARS_PER_TURNOUT_POINT = 5000` (`src/lib/utils/demographicAlignment.ts`). The alignment multiplier is `max(0.1, 1 - 0.15 × (|partyEcon - lean.econ| + |partySocial - lean.social|))` (`calculateAlignmentMultiplier`). A national budget divides its spend evenly across the budget country's regions (`calculateNationalGOTVBoost`); a state budget puts all of it in one region (`calculateStateGOTVBoost`). Spend is `floor(revenue × gotvBudgetPercent / 100)` (`calculateGOTVSpend`).
- **Player canvassing**: 100 funds and 1 action per canvass (`COST_FUNDS = 100`, `COST_ACTIONS = 1`, `src/app/api/canvassing/route.ts`), up to `MAX_CANVASS_BATCH = 50` per request, for `canvassingBoost = CANVASS_BASE_BOOST × fit² × (closing ? 2 : 1)` with `CANVASS_BASE_BOOST = 2`. Fit is `campaignFit = 0.2 + 0.8 × exp(-d² / 18)` where `d² = ((candidate.econ - audience.econ)² + (candidate.social - audience.social)²) / 2`, so fit runs from 0.2 to 1.0.
- **Closing window**: canvassing effectiveness doubles when a qualifying active race in the state (or a national presidential race for the country) ends within 4 turns (`checkActiveCampaignSeason`, `src/app/api/canvassing/route.ts`).
- **Diminishing returns**: `addTurnoutBoost` shrinks a boost in the direction a modifier already points by `|current| / 20` per canvass and clamps to +/-20. A boost against the modifier's direction is not reduced, so positive action can recover a suppressed bucket.

### Targeting decisions

| Action | Effect | Cost | Best when |
| --- | --- | --- | --- |
| Canvass a bucket | `2 × fit² (× 2 closing)` turnout points, immediate | 100 funds, 1 action | Your positions sit close to the bucket and a race ends within 4 turns |
| Party GOTV | `spend / 5000 × alignment` points per turn | percent of party revenue, 0 to 25 percent | Sustained, passive support for one bucket the party aligns with |
| Targeted ad | Capped competitive bonus, `AD_BONUS_CAP = 0.25`, `AD_BOOST_PER_ACTION = 0.01` per action, 24 turn half-life (`AD_HALF_LIFE`, `rules.ts`) | 100 funds (`AD_FUNDS_PER_ACTION`), 1 action (`AD_ACTION_COST`), up to 50 per buy (`AD_MAX_ACTIONS`) | You need persuasion rather than turnout |
| Poll | Reveals appeal and turnout per bucket | see [Stats & Actions](./stats-actions.md) | Before committing any of the above |

A bucket that loves you but does not vote is worth nothing, and a bucket that votes but sits far from you gains little from canvassing (fit floor 0.2 gives a boost of only `2 × 0.2² = 0.08` points).

Ad bonus mechanics (`rules.ts`): a purchase sets `bonus = min(0.25, current + 0.01 × count)` and stamps `lastPurchaseTurn`; exposure then halves every 24 turns (`adExposure`). A cell's bonus is `0.25 × (1 - Π(1 - coverage × campaignResponse))` over all live ads, where `coverage = exposure / 0.25`. `campaignResponse` multiplies the candidate's fit to the audience, the candidate's fit to the cell, a cross-identity `agreement = 0.25 + 0.75 × exp(-conflict / 12.5)` and the audience `cohesion = 0.5 + 0.5 × exp(-variance / 4.5)`.

### Ideology-Modulated Leans

Some groups (Retirees, Soccer Moms, Union & Trades, Rural Traditionalists) shift their leans based on state ideology composition. A conservative state will push these groups further right; a progressive state pushes them left.

### State Political Lean

State lean is a turnout-weighted average of all group leans (`calculateStateLean`, `src/lib/utils/demographics.ts`): each group's weight is population share × turnout × category weight, and a category the region does not weight contributes 0. The display value is `getDisplayLean`: the average of the two axes when they share a sign, otherwise the stronger axis. The label rounds the lean to the nearest whole step on the -5..+5 ruler (Far Left, Strong Left, Left, Lean Left, Center-Left, Centrist, Center-Right, Lean Right, Right, Strong Right, Far Right, `getEconomicPositionName` in `src/lib/utils/politics.ts`). Any lean under 0.5 in absolute value reads Centrist, so most states do. Full table in [Demographics](./demographics.md).

## Data

| Collection / field | Read or written | Notes |
| --- | --- | --- |
| `stateDemographicTurnout` (`StateDemographicTurnout`, `src/lib/db/types/stateDemographicTurnout.ts`), one doc per region, `_id` is the region id | read and written | `modifiers` (legacy set), `campaignModifiers` (current rules), `campaignContactModifiers` (canvassing-only part, kept for participation receipts), `lastDecayApplied`, `lastUpdated`. Each is `category -> group -> number` in -20..+20. Turnout effects are visible to players through polls and the Demographics tab, not as raw modifiers. |
| `partyBudget` (`PartyBudget`, `src/lib/db/types/partyBudget.ts`) | read; spend recorded | `gotvBudgetPercent` (0 to 25), `gotvTargetCategory`, `gotvTargetGroup`, `scope` (`national` or `state`), `stateId`, plus the suppression and registration equivalents. The deprecated `gotvBudgetPerTurn` is only used when the percent is 0. Visible to party officers. |
| `characters` | written by canvassing and ads | `actions` and the campaign funds balance (`funds`, or `currencyBalances.campaign` under forex) debited; `targetedAds` and `targetedAdsRevision` hold standing ads. |
| `elections` and `electionCandidates` | read; ads written | `campaignRulesVersion` selects the rule set; `targetedAds` on a candidate holds `{stateId, dimension, bucket, bonus, lastPurchaseTurn}`. |
| `moneyFlowReceipts` | written | One receipt per canvass keyed by the `Idempotency-Key` header, used for crash-safe replay. |
| `politicalParties` | written | National GOTV and suppression spend is deducted from the party treasury. |

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `CAMPAIGN_RULES_VERSION` | 1 | `src/lib/campaignTargeting/rules.ts`. Stamped on newly inserted elections by `withCampaignRules`; races already in progress are never retrofitted. |
| `TURNOUT_CAP`, `TURNOUT_HALF_LIFE`, `CANVASS_BASE_BOOST` | 20, 6, 2 | `rules.ts` |
| `AD_BONUS_CAP`, `AD_HALF_LIFE`, `AD_BOOST_PER_ACTION`, `AD_MAX_ACTIONS`, `AD_ACTION_COST`, `AD_FUNDS_PER_ACTION` | 0.25, 24, 0.01, 50, 1, 100 | `rules.ts` |
| `DOLLARS_PER_TURNOUT_POINT` | 5000 | `src/lib/utils/demographicAlignment.ts` |
| `gotvBudgetPercent`, `suppressionBudgetPercent` | per party, validated 0 to 25 | party `treasury-plan` routes under `src/app/api/country/[code]/` |
| Legacy decay `DECAY_RATE` | 0.02 | `src/lib/utils/turnoutDecay.ts`, used only for the legacy `modifiers` set |
| Forex campaign rate | 1 when forex is off | `isForexEnabled` and `campaignLocalRate`; the 100 funds anchor is converted to the campaign currency when forex is on |
| Native vs legacy canvass targets | per race | `canUseNativeCanvassTargets` (`src/lib/canvassing/campaignContext.ts`). A race on legacy rules only accepts its original demographic groups. |

No era or country preset changes these constants. Country differences enter through the census buckets and leans (`src/lib/demographics/countryDemographics.ts`).

## Timing

Decay and GOTV run once per turn inside the `demographicsAndPartySetup` phase (`src/simulation/phases/turnPhaseRegistry.ts`); canvassing and ad purchases are immediate API actions between turns.

```
player canvass (API)  -> campaignModifiers / modifiers += boost   (immediate)
player ad buy (API)   -> candidate.targetedAds updated            (immediate)
turn N:
  turnoutDecay   (applyDecayToAllStates)   all regions decay
  partyGOTV      (processPartyGOTV)        GOTV and suppression applied on decayed values
  partyOrgTurn ... (later steps in the same phase)
vote resolution reads campaignModifiers and ad bonuses  (src/lib/elections/resolveElection.ts)
```

Decay runs before GOTV in the same turn, so a fresh GOTV boost is not decayed until the next turn. A canvass made between turns is decayed at the next turn start.

## Worked trace

A candidate at economic 2, social 1 canvasses an audience at economic 3, social 3 three times, outside the closing window, starting from a modifier of 0. Cost is 300 funds and 3 actions.

| Step | Calculation | Result |
| --- | --- | --- |
| Squared distance | ((2 - 3)² + (1 - 3)²) / 2 | 2.5 |
| Fit | 0.2 + 0.8 × exp(-2.5 / 18) = 0.2 + 0.8 × 0.8703 | 0.8963 |
| Boost per canvass | 2 × 0.8963² | 1.6066 |
| After canvass 1 | 0 + 1.6066 × (1 - 0/20) | 1.6066 |
| After canvass 2 | 1.6066 + 1.6066 × (1 - 1.6066/20) | 3.0841 |
| After canvass 3 | 3.0841 + 1.6066 × (1 - 3.0841/20) | 4.4429 |
| Six turns later | 4.4429 × 2^(-6/6) | 2.2214 |

The stored `campaignModifiers[category][group]` is 4.4429 after the third canvass, and the same bucket in `campaignContactModifiers` records the realised 4.4429 (clamped to +/-20). If a qualifying race ended within 4 turns the per-canvass boost would be 3.2131.

GOTV example: a state budget with revenue 50,000, `gotvBudgetPercent = 5` spends `floor(50,000 × 0.05) = 2,500`. Party at (1, 1) targeting a bucket at (2, 2.5): distance 2.5, alignment `1 - 0.15 × 2.5 = 0.625`, boost `2,500 / 5,000 × 0.625 = 0.3125` points.

## Edge cases and limits

- **Cap**: modifiers are clamped to -20..+20 in both sets.
- **Floor on fit**: fit never drops below 0.2, so even a far candidate gets `2 × 0.04 = 0.08` points per canvass. GOTV alignment never drops below 0.1.
- **Split beats stacking**: because each canvass loses `|modifier| / 20` of its size, spreading actions across buckets gives more total points than stacking one.
- **Opposite direction is not reduced**: a positive boost on a suppressed bucket gets full size, so suppression is recoverable.
- **Zero**: a bucket with no audience share cannot be targeted; `targetAudience` returns null for zero share. A party GOTV with no target category and group does nothing and spends nothing. A budget whose target has no turnout doc or no resolvable lean applies nothing and is not charged.
- **Treasury**: GOTV only spends when the party treasury covers the spend.
- **Region**: you can only canvass in your active campaign state (home state, or the travel or primary state for presidential candidates), resolved by `resolveCanvassState` in `src/lib/canvassing/eligibility.ts`.
- **Per-request limits**: 50 canvasses per request; 60 requests per minute per user (rate limit); preview 30 per minute.
- **Legacy races**: a race on legacy rules only accepts its original groups and uses the legacy Manhattan alignment model (`calculateCanvassingBoost`, base boost 0.05, alignment `max(0.1, 1 - 0.15 × distance)`, doubled in season).
- **Excluded by design**: the 12 archetypes do not carry their own vote logic; they only project onto cells.

## Invariants

- Every stored turnout modifier is within -20..+20. Enforced by clamping in `addTurnoutBoost` and `applyBoost`; tested in `rules.test.ts` ("never exceeds either turnout cap").
- Decay never changes the sign of a modifier and snaps tiny values to 0. Tested in `turnoutDecay.test.ts` and `rules.test.ts`.
- A canvass is charged exactly once per idempotency key: funds, actions and the turnout write are keyed legs of one flow (`applyCanvassSpend`). Tested in `canvassSpend.test.ts`.
- A national GOTV budget only touches regions of its own country. Tested in `demographicTurnoutTurn.test.ts`.
- Ad bonus never exceeds `AD_BONUS_CAP`. Tested in `rules.test.ts`.
- Nothing enforces that the legacy `modifiers` and current `campaignModifiers` stay equal; they diverge by design after the first canvass.

## Failure and recovery

- **Stale modifiers or a missing turnout document** for a region: canvassing returns "State turnout data not found" and GOTV skips the region without charging. Repair is a reseed of the region's turnout document.
- **Interrupted canvass** (crash between debit and turnout write): the keyed flow reconciles on retry with the same idempotency key to one charge and one boost.
- **Concurrent edit**: the turnout write is guarded by `lastUpdated`; a mismatch returns a 409 asking the player to refresh and retry.
- **Bad ad or modifier data** (non-numeric values): `decayTurnout` drops malformed categories and values rather than failing the turn.
- **Drifted totals after a rules change**: modifiers are state, not derived, so a heal that rewrites the documents is the repair; there is no recompute-from-history.

## Connections

**Driven by:**

- [Demographics](./demographics.md): turnout modifiers and cell leans set the base the targeting acts on (`src/lib/campaignTargeting/audience.ts`).
- [Parties](./parties.md): party budget and position drive GOTV (`processPartyGOTV` in `src/lib/turn/demographicTurnoutTurn.ts`).
- [Campaign Strategy](./campaign-strategy.md): action allocation and timing.

**Affects:**

- [Election Mechanics](./elections.md): turnout and appeal decide vote totals per cell (`src/lib/elections/resolveElection.ts`).
- [Election Engine](./election-engine.md): reach, appeal, approval and Org scalars.

### Related Pages

- [Demographics](./demographics.md), Full demographic system details
- [Campaign Strategy](./campaign-strategy.md), Action allocation and timing
- [Election Mechanics](./elections.md), How votes are counted

## Tests

- `src/lib/campaignTargeting/rules.test.ts`: canvass boost, caps, decay, cohesion, ad cap and half-life, fixed price.
- `src/lib/campaignTargeting/standingAds.test.ts`, `nationalAds.test.ts`, `adTargets.test.ts`, `electorate.test.ts`, `poll.test.ts`: ads and audience construction.
- `src/lib/utils/turnoutDecay.test.ts` and `src/lib/turn/demographicTurnoutTurn.test.ts`: legacy decay, GOTV scoping, canvassing alignment.
- `src/lib/canvassing/canvassSpend.test.ts`, `eligibility.test.ts`, `campaignContext.test.ts`: spend idempotency and who may canvass where.
- `src/lib/elections/resolveElection.campaign.test.ts`: campaign rules in vote resolution.
- Gaps: no test pins the closing-window doubling at the API level against a live election, and no test covers the displayed state lean label thresholds end to end.

## Known issues and history

- The design page previously quoted 19.3 points for 30 perfect canvasses on one bucket; the code gives `20 × (1 - 0.9^30) = 19.15`. Corrected above (two buckets, 15 each, is unchanged at 31.8).
- The legacy `modifiers` set and the current `campaignModifiers` set are both still written by every canvass and GOTV, with different formulas (Manhattan 0.05 base versus Gaussian fit base 2). Races created before `CAMPAIGN_RULES_VERSION = 1` read the legacy set; new races read the current one.
- Player wiki contradictions (code wins): the player page says ads are "about ₳100,000, 5 or more actions" in its tips, but the code charges `AD_FUNDS_PER_ACTION = 100` per action (the same page's key numbers table says ₳100 each); its "up to 25 points of bonus" for ads is the `AD_BONUS_CAP = 0.25` competitive weight bonus (25 percent), not 25 points of anything.
- Closing-window text on the player page is consistent with the code (4 turns).

Last checked: 2026-10-29, version 1.18.0
