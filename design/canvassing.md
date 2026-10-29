# Canvassing

Canvassing is a player action that directly boosts voter turnout for a specific demographic group in the character's active campaign state - typically the home state, but `travelState` or `primaryCampaignState` for active presidential candidates. Unlike ads (which raise favorability) or party GOTV spending (which is passive and automatic), canvassing is an active, targeted intervention that modifies how many voters from a chosen group show up on election day.

## Mechanic

### Cost

- **100 funds** and **1 action point** per use.
- Deducted immediately when the action is submitted.

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
| Active presidential candidate, primary phase, primary state set | `primaryCampaignState`      |
| Active presidential candidate, primary phase, no primary state  | none - UI disabled, API 403 |
| Active presidential candidate, general phase, travel state set  | `travelState`               |
| Active presidential candidate, general phase, no travel state   | none - UI disabled, API 403 |
| Any other character                                             | `homeState`                 |

An active presidential candidacy "captures" the canvass target - even at home, a presidential candidate must `travelState` home to canvass there. This keeps canvassing aligned with the rest of the presidential travel system. Attempting to canvass in any other state returns a 403 error.

### Effectiveness Formula

Elections created under the current campaign rules (`src/lib/campaignTargeting/rules.ts`) use this formula. A legacy path (`calculateCanvassingBoost`) is still computed and stored alongside it for older races.

```
CANVASS_BASE_BOOST = 2 (turnout points)
distance²          = ((charEcon − demoEcon)² + (charSocial − demoSocial)²) / 2
campaignFit        = 0.2 + 0.8 × exp(−distance² / 18)
closingMult        = isActiveCampaignSeason ? 2 : 1
boost              = CANVASS_BASE_BOOST × campaignFit² × closingMult
```

`addTurnoutBoost` then applies the boost to the current modifier, clamped to ±20 (`TURNOUT_CAP`).

**Fit** is based on the distance between the character's `policies.economic` / `policies.social` positions and the target audience's average lean. Fit runs from 1.0 at the same position down toward a floor of 0.2, and the boost scales with its square, so a distant audience gets as little as 0.04 of the base.

**Campaign season multiplier**: When an election in the state has status `active` and its `endTime` falls within the next 4 turns (4 real hours), the boost doubles. Outside campaign season the multiplier is 1.

**Diminishing returns**: Resistance applies only in the direction of the boost. A positive boost on a modifier at +10 lands at half strength, and reaches zero at +20. A positive boost on a suppressed (negative) modifier is not reduced, so canvassing can recover a bucket that has been pushed down.

### Timing

Canvassing takes effect **immediately** upon the API call - the modifier is written to the database in the same request, not queued for turn processing. The `lastUpdated` timestamp on the `StateDemographicTurnout` document is updated at the same time.

## Integration with Demographics

### Modifier Decay

All turnout modifiers, including those set by canvassing, decay toward zero with a half-life of 6 turns (about 11% lost per turn, `TURNOUT_HALF_LIFE` in `src/lib/campaignTargeting/rules.ts`). Legacy turnout modifiers still decay 2% per turn. This means a single canvass action does not persist indefinitely; sustained canvassing is required to maintain a boost into election day.

### How Modifiers Affect Election Turnout

Canvassing modifies `stateDemographicTurnout.modifiers[category][group]` for the target state. During election resolution, `deriveGroupTurnout` (in `src/lib/seeds/stateDemographics.ts`) applies these Layer 1 modifiers to the 12 voter archetypes:

1. Each voter archetype is composed of Layer 1 demographics with weighted contributions.
2. For each Layer 1 demographic in the archetype's composition, the state modifier is fetched and multiplied by that weight.
3. The sum of weighted modifiers is added to the archetype's baseline turnout.

**Example**: Young Renters (baseline 38% turnout) are heavily composed of the `young` age group. If a player has canvassed young voters in their state and raised the `age.young` modifier to +5, Young Renters' effective turnout in that state rises toward 43%.

### Interaction with Party GOTV

Party GOTV spending and player canvassing both write to the same `modifiers` fields in `stateDemographicTurnout`. They stack additively (both are subject to the ±20 cap independently). Turn processing order:

1. **Decay** applied to all modifiers.
2. **Party GOTV** boosts applied (passive, budget-driven).
3. Canvassing effects are applied at request time (immediate), not during turn processing.

## Database

### Collection: `stateDemographicTurnout`

One document per state/region. Canvassing reads and writes this document.

| Field                        | Type     | Notes                                         |
| ---------------------------- | -------- | --------------------------------------------- |
| `_id`                        | `string` | State ID (e.g. `"PA"`)                        |
| `modifiers[category][group]` | `number` | −20 to +20; the field canvassing updates      |
| `lastUpdated`                | `Date`   | Set to `new Date()` on every canvassing write |
| `lastDecayApplied`           | `Date`   | Set by turn decay, not by canvassing          |

The update is a targeted `$set` on `modifiers.${category}.${group}` - only the chosen group's modifier is touched.

### Collection: `characters`

Canvassing deducts cost from the acting character via `$inc`:

| Field     | Change |
| --------- | ------ |
| `funds`   | −100   |
| `actions` | −1     |

### Collection: `elections`

Two read-only queries at request time:

1. **Eligibility resolution** - for active presidential candidates, joins `electionCandidates` to `elections` filtered by `electionType: "president"`, `status: "active"` to determine the candidate's canvass target state (travel or primary campaign).
2. **Campaign season check** - queries for an election where `state` matches the canvass target, `status === "active"`, and `endTime` is within the next 4 hours, to apply the 2× campaign-season multiplier.

### Collection: `electionCandidates`

Read-only at request time. Eligibility resolution looks up the authenticated character's active candidacies (`status: "active"`) to detect presidential candidacy and read `travelState` / `primaryCampaignState`.

## Strategy Notes

- **Canvass demographics you're aligned with.** A distant audience gets as little as 0.04 of the base boost (fit squared, floor 0.2), making it nearly wasted spend. At perfect alignment you get the full 2 points (or 4 in campaign season).
- **Time it for campaign season.** The 2× closing multiplier makes the 4 turns before an election the highest-value window. A well-timed burst of canvassing outperforms the same actions spread over earlier turns.
- **Canvassing vs. ads.** Canvassing raises turnout for a demographic; ads raise your favorability with that demographic. Turnout boosts help you only if the boosted group leans toward you. On demographics that lean away from you, ads to improve favorability may be more efficient than canvassing.
- **Stack with party GOTV.** If your party is already running GOTV budget on aligned demographics, the state modifier may already be elevated. Diminishing returns apply - check the current modifier before canvassing to gauge how much headroom remains before hitting the cap.
- **Decay planning.** A +5 modifier halves to +2.5 after six turns and is about +3.5 after three. For an election 4 turns out, start canvassing 2-3 turns ahead rather than immediately.

## Related Documentation

- [Demographics](./demographics.md) - Turnout system, modifier decay, GOTV mechanics, `deriveGroupTurnout`
- [Campaign Strategy](./campaign-strategy.md) - Overall campaign planning
- [Fundraising & Ads](./fundraising-ads.md) - Alternative fund expenditures
- [Stats & Actions](./stats-actions.md) - Action point costs and refresh
