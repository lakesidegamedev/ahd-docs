# Canvassing

Canvassing is a player action that directly boosts voter turnout for a specific demographic group in the character's active campaign state - typically the home state, but `travelState` or `primaryCampaignState` for active presidential candidates. Unlike ads (which raise favorability) or party GOTV spending (which is passive and automatic), canvassing is an active, targeted intervention that modifies how many voters from a chosen group show up on election day.

Player guide: [Canvassing](https://www.ahousedividedgame.com/wiki/canvassing)

Source: `src/app/api/canvassing/route.ts` (the action), `src/lib/campaignTargeting/rules.ts` (current formula), `src/lib/canvassing/eligibility.ts` (where you may canvass).

## Mechanic

### Cost

- `COST_FUNDS = 100` and `COST_ACTIONS = 1` per use (`src/app/api/canvassing/route.ts`). Funds are an anchor-denominated constant: in countries with their own currency the 100 is converted to local units at the frozen campaign rate.
- A request may batch `count` canvasses (`MAX_CANVASS_BATCH = 50`, minimum 1). Cost is `count × 100` funds and `count × 1` actions, checked for the whole batch.
- Deducted immediately when the action is submitted. The spend is idempotent: an `Idempotency-Key` header (1 to 128 characters) replays the stored outcome without charging twice.
- Running-mate surrogate: the running mate on an active general-phase presidential ticket canvasses the ticket's `runningMateTravelState` and draws from the ticket campaign's shared daily surrogate pool, not from the nominee's own pools. An empty pool returns 409.

### Targeting

The player selects a demographic group from two levels:

1. **Category** - one of five Layer 1 categories: `race`, `age`, `education`, `wealth`, `ideology`.
2. **Group** - a specific group within that category (21 groups total):

| Category  | Groups                                                                            |
| --------- | --------------------------------------------------------------------------------- |
| Race      | White, Black, Hispanic, Asian, Other                                              |
| Age       | Young (18-29), Middle-Aged (30-49), Mature (50-64), Senior (65+)                  |
| Education | No College, College Educated, Graduate Degree                                     |
| Wealth    | Low Income, Middle Income, High Income                                            |
| Ideology  | Evangelicals, Environmentalists, Libertarians, Progressives, Patriots, Gun Owners |

Canvassing targets a single state at a time. The target is determined server-side from the character's active candidacy:

| Character state                                                 | Canvass target              |
| --------------------------------------------------------------- | --------------------------- |
| Active presidential candidate, campaign suspended               | none - API 403              |
| Active presidential candidate, primary phase, primary state set | `primaryCampaignState`      |
| Active presidential candidate, primary phase, no primary state  | none - UI disabled, API 403 |
| Active presidential candidate, general phase, travel state set  | `travelState`               |
| Active presidential candidate, general phase, no travel state   | none - UI disabled, API 403 |
| Any other character                                             | `homeState`                 |

An active presidential candidacy "captures" the canvass target - even at home, a presidential candidate must `travelState` home to canvass there. This keeps canvassing aligned with the rest of the presidential travel system. Attempting to canvass in any other state returns a 403 error.

### Effectiveness Formula

Races inserted under the current campaign rules (`campaignRulesVersion >= 1`, `CAMPAIGN_RULES_VERSION` in `src/lib/campaignTargeting/rules.ts`) use this formula. Rules are stamped only on newly inserted races, never retrofitted to a race in progress.

```
CANVASS_BASE_BOOST = 2 (turnout points)
distance²          = ((charEcon - demoEcon)² + (charSocial - demoSocial)²) / 2
campaignFit        = 0.2 + 0.8 × exp(-distance² / 18)
closingMult        = isActiveCampaignSeason ? 2 : 1
boost              = CANVASS_BASE_BOOST × campaignFit² × closingMult
```

Applied per canvass, `count` times in a row, by `addTurnoutBoost` (`src/lib/campaignTargeting/rules.ts`):

```
resistance = max(0, sign(boost) × current) / TURNOUT_CAP     // TURNOUT_CAP = 20
current    = clamp(current + boost × (1 - resistance), -20, 20)
```

**Fit** is based on the distance between the character's `policies.economic` / `policies.social` positions and the target audience's average lean (share-weighted over the voter cells in the bucket). With D as the straight-line gap between the two positions, `distance² = D² / 2`:

| D | Fit | Boost multiplier (fit squared) |
| - | --- | ------------------------------ |
| 0 | 1.00 | 1.00 |
| 3 | 0.82 | 0.68 |
| 6 | 0.49 | 0.24 |
| 10 | 0.25 | 0.06 |
| far | 0.20 (floor) | 0.04 |

Fit is squared so that a near match is worth much more than a poor one; the 0.2 floor keeps any audience reachable at a small effect.

**Campaign season multiplier**: `checkActiveCampaignSeason` doubles the boost when an active election in the target state, or a national presidential election for the character's country, has `endTurn` between the current turn and current turn + 4 (inclusive). Elections without an `endTurn` fall back to an `endTime` within the next 4 hours (1 turn is 1 game hour). Outside the window the multiplier is 1.

**Diminishing returns**: resistance applies only in the direction of the boost. A positive boost on a modifier at +10 lands at half strength and reaches zero at +20. A positive boost on a suppressed (negative) modifier is not reduced, so canvassing can recover a bucket that has been pushed down.

**Worked example.** A perfectly aligned character (boost 2) canvassing from a modifier of 0: 1 canvass gives +2.0, 5 give +8.2, 10 give +13.0, 20 give +17.6, 50 give +19.9. In campaign season (boost 4): 1 gives +4.0, 5 give +13.5, 10 give +17.9. A D = 6 audience (boost 0.49 base) needs far more actions for the same result.

**Realized contact**: the part of the change that actually landed (after resistance and the cap) is also added to `campaignContactModifiers[category][group]`, clamped to ±20, which the election engine reads separately from the turnout modifier.

#### Legacy path

For races without campaign rules, and as a parallel record on every request, the legacy formula (`calculateCanvassingBoost`, `src/lib/turn/demographicTurnoutCalculations.ts`) writes to `modifiers`:

```
BASE_BOOST          = 0.05 (turnout points)
distance            = |charEcon - demoEcon| + |charSocial - demoSocial|
alignmentMultiplier = max(0.1, 1.0 - distance × 0.15)
boost               = BASE_BOOST × alignmentMultiplier × (campaign season ? 2 : 1)
```

Diminishing returns on this path are symmetric, `boost × max(0, 1 - |current| / 20)` (`applyDiminishingReturns`, `src/lib/utils/diminishingReturns.ts`), clamped to ±20. A race that predates campaign rules rejects the non-native group names with "This race uses legacy canvassing groups" and accepts only its original groups.

### Timing

Canvassing takes effect **immediately** upon the API call - the modifier is written to the database in the same request, not queued for turn processing. The `lastUpdated` timestamp on the `StateDemographicTurnout` document is updated at the same time. The write carries the `lastUpdated` it read, so a concurrent turn change returns 409 ("State turnout changed while canvassing") instead of overwriting.

Per turn, the turn processor then runs, in order (`demographicsAndPartySetup` in `src/simulation/phases/turnPhaseRegistry.ts`): `turnoutDecay` (`applyDecayToAllStates`), then `partyGOTV`. Vote accumulation later reads the resulting modifiers.

## Integration with Demographics

### Modifier Decay

All current-rules turnout modifiers (`campaignModifiers` and `campaignContactModifiers`), including those set by canvassing, decay toward zero by `value × 2^(-1/6)` each turn: a half-life of 6 turns (`TURNOUT_HALF_LIFE`, about 10.9% lost per turn, `src/lib/campaignTargeting/rules.ts`). Values under 0.01 snap to 0. The legacy `modifiers` field decays 2% per turn (`DECAY_RATE = 0.02`, zero threshold 0.01, `src/lib/utils/turnoutDecay.ts`). A single canvass action therefore does not persist indefinitely; sustained canvassing is required to maintain a boost into election day.

### How Modifiers Affect Election Turnout

Canvassing modifies `stateDemographicTurnout.campaignModifiers[category][group]` (current rules, falling back to a copy of `modifiers` when absent) and the legacy `modifiers[category][group]` for the target state. During election resolution, `deriveGroupTurnout` (in `src/lib/seeds/stateDemographics.ts`) applies these Layer 1 modifiers to the 12 voter archetypes:

1. Each voter archetype is composed of Layer 1 demographics with weighted contributions.
2. For each Layer 1 demographic in the archetype's composition, the state modifier is fetched and multiplied by that weight.
3. The sum of weighted modifiers is added to the archetype's baseline turnout.

**Example**: Young Renters (baseline 38% turnout) are heavily composed of the `young` age group. If a player has canvassed young voters in their state and raised the `age.young` modifier to +5, Young Renters' effective turnout in that state rises toward 43%. Under current rules that takes about 3 aligned canvasses (3 gives +5.7); under the legacy 0.05 base it would take roughly 100.

### Interaction with Party GOTV

Party GOTV spending and player canvassing both write to the same modifier fields in `stateDemographicTurnout` (party GOTV also uses `canvassingBoost` from `src/lib/campaignTargeting/rules.ts`). They stack additively, both subject to the ±20 cap. Turn processing order:

1. **Decay** applied to all modifiers.
2. **Party GOTV** boosts applied (passive, budget-driven).
3. Canvassing effects are applied at request time (immediate), not during turn processing.

## Database

### Collection: `stateDemographicTurnout`

One document per state/region. Canvassing reads and writes this document.

| Field                        | Type     | Notes                                         |
| ---------------------------- | -------- | --------------------------------------------- |
| `_id`                        | `string` | State ID (e.g. `"PA"`)                        |
| `modifiers[category][group]` | `number` | −20 to +20; legacy field, updated on every request |
| `campaignModifiers[category][group]` | `number` | −20 to +20; the current-rules turnout modifier |
| `campaignContactModifiers[category][group]` | `number` | −20 to +20; realized canvass contact, decays like `campaignModifiers` |
| `lastUpdated`                | `Date`   | Set to `new Date()` on every canvassing write |
| `lastDecayApplied`           | `Date`   | Set by turn decay, not by canvassing          |

The update is a targeted `$set` on `modifiers.${category}.${group}` plus the `campaignModifiers` and `campaignContactModifiers` maps - only the chosen group's modifier changes.

### Collection: `characters`

Canvassing deducts cost from the acting character via `$inc` (the keyed, idempotent spend in `src/lib/canvassing/canvassSpend.ts`):

| Field     | Change (per canvass) |
| --------- | ------ |
| `funds` (or `currencyBalances.campaign` when forex is on) | −100 (anchor, converted to local) |
| `actions` | −1     |

### Collection: `elections`

Two read-only queries at request time:

1. **Eligibility resolution** - for active presidential candidates, joins `electionCandidates` to `elections` filtered by `electionType: "president"`, `status: "active"` to determine the candidate's canvass target state (travel or primary campaign).
2. **Campaign season check** - queries for an election where `state` matches the canvass target, `status === "active"`, and `endTime` is within the next 4 hours, to apply the 2× campaign-season multiplier.

### Collection: `electionCandidates`

Read-only at request time. Eligibility resolution looks up the authenticated character's active candidacies (`status: "active"`) to detect presidential candidacy and read `travelState` / `primaryCampaignState`.

## Edge cases and limits

- **Cap**: modifiers are clamped to ±`TURNOUT_CAP = 20` (`src/lib/campaignTargeting/rules.ts`). At +20 a positive canvass adds nothing, but still costs funds and actions.
- **Zero and negative**: at 0 there is no resistance. A negative modifier (pushed down by an opponent or an event) takes the full boost.
- **Floor on fit**: 0.2, so squared 0.04. No audience is unreachable, only inefficient.
- **No target**: a presidential candidate in primary with no primary state, or in general with no travel state, cannot canvass (UI disabled, API 403). A suspended presidential campaign cannot canvass.
- **Changing travel state** changes the target state immediately; modifiers already written stay in the old state and decay there.
- **Other candidates' travel** does not matter: canvassing reads only the acting character's own eligibility.
- **Primaries**: canvassing works in the primary phase in the candidate's `primaryCampaignState`; it modifies the state's turnout modifiers.
- **Batch**: if the first request of a batch is replayed with the same key it returns `duplicate: true` and is not charged again.
- **Insufficient resources** return 400 ("Insufficient funds" or "Insufficient actions"). A balance that changes mid-request returns 409.
- **Why the boost is small and capped**: turnout is a state-wide stock that also receives party GOTV. A small per-action boost with directional resistance and a hard cap stops a few players from setting a group's turnout alone.

## Connections

**Driven by**

- [Stats & Actions](./stats-actions.md): the character's 1 action per canvass.
- Character policies (`policies.economic`, `policies.social`): the fit between you and the audience.
- Presidential travel and primary state (`travelState`, `primaryCampaignState`, `runningMateTravelState`) through `resolveCanvassState`.
- Election `endTurn` through `checkActiveCampaignSeason`: the 2x window.

**Affects**

- [Demographics](./demographics.md): `deriveGroupTurnout` in `src/lib/seeds/stateDemographics.ts` reads the modifiers when building archetype turnout; vote accumulation then reads turnout.
- Party GOTV: both write to the same turnout modifiers and stack.
- Finances: `-100` funds a canvass from the character's own funds (or the surrogate pool).
- Not [Campaign Manager](./campaign-manager.md): canvassing does not touch the campaign funds or actions pools.

## Strategy Notes

- **Canvass demographics you're aligned with.** A distant audience gets as little as 0.04 of the base boost (fit squared, floor 0.2), making it nearly wasted spend. At perfect alignment you get the full 2 points (or 4 in campaign season) per canvass.
- **Time it for campaign season.** The 2× closing multiplier makes the 4 turns before an election the highest-value window. A well-timed burst of canvassing outperforms the same actions spread over earlier turns.
- **Canvassing vs. ads.** Canvassing raises turnout for a demographic; ads raise your favorability with that demographic. Turnout boosts help you only if the boosted group leans toward you. On demographics that lean away from you, ads to improve favorability may be more efficient than canvassing.
- **Stack with party GOTV.** If your party is already running GOTV budget on aligned demographics, the state modifier may already be elevated. Diminishing returns apply - check the current modifier before canvassing to gauge how much headroom remains before hitting the cap.
- **Decay planning.** A +5 modifier halves to +2.5 after six turns and is about +3.5 after three under current rules (on the legacy path 2% decay leaves about +4.7 after three). For an election 4 turns out, start canvassing 2-3 turns ahead rather than immediately.

## Related Documentation

- [Demographics](./demographics.md) - Turnout system, modifier decay, GOTV mechanics, `deriveGroupTurnout`
- [Campaign Strategy](./campaign-strategy.md) - Overall campaign planning
- [Fundraising & Ads](./fundraising-ads.md) - Alternative fund expenditures
- [Stats & Actions](./stats-actions.md) - Action point costs and refresh

Last checked: 2026-10-29, version 1.18.0
