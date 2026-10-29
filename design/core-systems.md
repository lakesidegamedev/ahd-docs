# Core Systems

The core loop is a persistent shared world. One real hour is one game turn and one turn advances the in-game calendar by roughly one week (about 7.6 days). Forty-eight turns make one game year.

## Summary

This page is the map of the engine's foundations: the hourly turn, the per-turn action and influence economy, the election accumulation curve, the government and legislation shapes, the economy feature switches and the turn processor. Each area has its own deeper page; this one records the shared constants and links onward.

Player guide: [Core Systems](https://www.ahousedividedgame.com/wiki/core-systems)

## Rules

### Time

| Constant | Value | Source |
| --- | --- | --- |
| `MS_PER_TURN` | 3,600,000 ms (one real hour) | `src/lib/constants/calendar.ts` |
| `TURNS_PER_YEAR` | 48 (365 / 48 is about 7.6 game days per turn) | `src/lib/constants/calendar.ts` |
| `STARTING_YEAR` | 2019 (turn 1 is the first week of January) | `src/lib/constants/calendar.ts` |
| `turnLengthMinutes` | 60 | `src/lib/seeds/reference/gameConfig.ts` |

### Actions and character resources

- Characters receive at least 4 base actions each turn (`MIN_BASE_ACTIONS_PER_TURN` in `src/lib/stats/statsConstants.ts`; `baseActionsPerTurn` is 4 in `src/lib/seeds/reference/gameConfig.ts`, and the engine uses the larger of the config value and 4).
- Office, cabinet, central-bank, party, and stat systems can add bonuses (`processActionRefresh` in `src/lib/turn/actionRefresh.ts`, bonuses from `src/lib/actions/officeActionBonus.ts` and `src/lib/actions/positionNiBonus/rules.ts`).
- Unused actions carry. The baseline cap is 200, with a 4-action hoarding penalty above 100; the Energy stat can adjust both thresholds.

| Constant | Energy 1 | Energy 10 | Source |
| --- | --- | --- | --- |
| `ENERGY_BASE_ACTION_CAP` / `ENERGY_MAX_ACTION_CAP` | 200 | 250 | `src/lib/stats/statsConstants.ts` |
| `ENERGY_BASE_HOARD_THRESHOLD` / `ENERGY_MAX_HOARD_THRESHOLD` | 100 | 125 | `src/lib/stats/statsConstants.ts` |
| `ACTION_HOARD_PENALTY` | 4 actions per turn above the threshold | | `src/lib/stats/statsConstants.ts` |

Both limits are linear in Energy: `t = (energy - 1) / 9`, `cap = round(200 + t * 50)`, `threshold = round(100 + t * 25)` (`energyActionLimits` in `src/lib/stats/statDrift.ts`). The per-turn update is `actions' = min(cap, max(0, actions - (actions > threshold ? 4 : 0) + refresh))`.

- Political Influence decays by 0.75% of its current value each turn (`POLITICAL_INFLUENCE_DECAY_RATE = 0.0075` in `shared/constants/formulas.ts`). Members of the party holding the national executive decay faster, by a multiplier of `2 - approval / 100` (2.0x at 0% approval, 1.0x at 100%). NPPs are floored at 10 (`NPP_POLITICAL_INFLUENCE_FLOOR`); players have a floor of 0.
- National Political Influence (NPI) decays 1% of its current value per turn (`NATIONAL_INFLUENCE_DECAY_RATE = 0.01`), then gains `calculateNationalInfluenceGain(PI)` plus the strongest applicable office or leadership bonus (`applyNationalInfluenceTurn`). The state-influence term is piecewise: `PI / 50 - 0.5` for PI up to 50 (so -0.5 at 0, 0 at 25) and `0.5 + (PI - 50) * 0.03` above 50 (so +2.0 at 100). Each role settles where gain equals decay, at `100 x gain`.
- Infamy decays by 5% of its current value each turn (multiplied by 0.95).
- Favorability has natural downward pressure only above 60: `(favorability - 60) * 0.05` per turn (`FAVORABILITY_NATURAL_DECAY_THRESHOLD = 60`). Infamy above 20 also drains it by `(infamy - 20) * 0.05` per turn, and a government accountability drain (`memberAccountabilityDrain` in `src/lib/government/accountability.ts`) can apply. The result is clamped to 0..100.
- A new character starts with 25 actions, 250,000 campaign funds, favorability 50 and infamy 0 (`src/lib/seeds/reference/gameConfig.ts`); new characters start with at least 10 political influence (`NEW_CHARACTER_STARTING_INFLUENCE`).

See [Stats & Actions](./stats-actions.md) for the dynamic campaign, advertising, donor, polling, and travel costs.

### Elections

Election cadence is country and office specific. The scheduler in `src/lib/elections/canonicalCycle.ts` is authoritative; avoid treating one US term table as a universal clock.

The general-election accumulation weights are:

| Segment          | Share | Turns |
| ---------------- | ----: | ----: |
| Early pool       |   50% | the rest of the window |
| General ramp     |   20% | 8 (`RAMP_TURNS`) |
| Final four turns |   30% | 4 (`ELECTION_DAY_TURNS`) |

Source: `turnVoteWeight` in `src/lib/electionEngine/voteCalculations.ts` (`EARLY_POOL_SHARE`, `RAMP_POOL_SHARE`, `FINAL_POOL_SHARE`). The window is the general-election window, starting at the end of the primary. Windows of 4 turns or fewer spread the pool evenly; if the early band is empty, its share folds into the ramp so the weights always sum to the pool.

Unused actions are intentionally bankable, so saving for the closing sprint is a supported strategy rather than an exploit.

### Government and legislation

- Presidential systems elect a head of state directly and can include an executive signature, veto, and override stage.
- Parliamentary systems require lower-chamber confidence to seat the head of government. A pending government freezes ordinary legislation (`isLegislationFrozen` in `src/lib/government/legislationFreeze.ts`: true for a parliamentary country whose government formation status is `pending`).
- One-party systems apply their own eligibility, leadership, and bill-lifecycle rules and can transition through the regime system.
- National bill routes are config-driven: legislatures are unicameral or bicameral (`LegislatureConfig.upperChamber` optional, `bicameral` flag in `src/lib/constants/countries.ts`) and bills carry an origin chamber such as `house` or `joint` (`src/lib/billLifecycle.ts`). The finer split of unicameral, sequential bicameral and concurrent bicameral lifecycles was not re-derived into a single table for this page; the lifecycle code is the reference.

### Economy

Fresh worlds start with the full labour system and the plants market tier, and Freight active. Command-economy handling is enabled for countries and eras configured as planned economies.

The economy includes plants and capacity, commodities, labour and unions, logistics, national budgets, sovereign and corporate debt, banking, forex, central banks, nationalization, index funds, and world trade. Each feature's own as-shipped page is more reliable than old all-in-one phase tables.

### Turn processing

The hourly processor uses an ordered adapter registry and roughly 180 named phases (123 base phases plus 57 per-country election phases). Most phase failures are isolated, recorded, and allowed to leave warnings while later phases continue. Locking and crash recovery prevent concurrent or blindly repeated turns.

See [The Turn Processor (as shipped)](../engineering/turn-processor-as-shipped.md) for the current registry and [Turn Processing Submodules](./turn-processing.md) for the stable entry points.

## Data

| Collection | Fields | Role | Player-visible |
| --- | --- | --- | --- |
| `characters` | `actions`, `politicalInfluence`, `nationalInfluence`, `infamy`, `favorability`, `stats.energy`, `actionGrantLog` | Rewritten each turn by `processActionRefresh` | Yes (profile and dashboard); the grant log is capped at the 48 most recent entries |
| `gameState` (`_id: "current"`) | `currentTurn`, `currentYear`, `lastTurnProcessed`, preset | Turn clock | Year and turn yes |
| `gameConfig` (`_id: "default"`) | `baseActionsPerTurn`, `startingActions`, `startingFunds`, `officeActionBonus`, `chairActionBonus`, `labourSystemMode`, `marketSystemMode`, `freightSettlementMode` | Tunables and feature modes | No |
| `electionVoteTallies` | accumulated votes per turn | Election accumulation | Results yes |
| `turnLog` | duration, warnings, per-phase results | Turn record | No |
| `centralBanks`, `supremeCourtSeats`, `congressLeaders`, `cabinetMembers` | role holders | Read to add action and influence bonuses | Roles yes |

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `baseActionsPerTurn` | 4 (floor 4) | `src/lib/seeds/reference/gameConfig.ts` |
| `startingActions` | 25 | same |
| `startingFunds` | 250,000 | same |
| `turnLengthMinutes` | 60 | same |
| `officeActionBonus` | per office type (for example House 1, Senate 2, President 4) | same |
| `chairActionBonus` | 3 (fallback `DEFAULT_CHAIR_ACTION_BONUS` in `src/lib/turn/actionRefresh.ts`) | gameConfig; country configs set central bank chair offices to 3 |
| `labourSystemMode` | `"full"` for fresh worlds | `FRESH_WORLD_GAME_CONFIG_FLAGS` in `src/lib/seeds/reference/featureFlagDefaults.ts` |
| `marketSystemMode` | `"plants"` for fresh worlds | same |
| `freightSettlementMode` | `"active"` for fresh worlds; the type allows `"shadow"` (routes recorded but not feeding plant throughput), which is what an absent value behaves as | same, type in `src/lib/db/types/gameConfig.ts` |
| `commandEconomyEnabled` | era-derived at bootstrap (on for 1953 and 1979 command regimes) | `src/lib/seeds/reference/featureFlagDefaults.ts` |

The standing policy is that every gameplay flag is on at the top of its ladder for a fresh world, with NPP autonomy held at v4 (`FRESH_WORLD_FLAG_EXCLUSIONS`).

## Timing

Each hourly turn runs the registry in a fixed group order. The pieces on this page sit in these groups:

```
turn N (hourly)
  actionRefresh (actions, PI, NPI, infamy, favorability)
  ... bills, campaigns, NPP activity ...
  voteAccumulation (turnVoteWeight)                      -> election window turns
  electionResolution, leadership phases                  -> strictly sequential
  state effects, economy, national aggregation, snapshots
```

The authoritative group order is the table in [The Turn Processor (as shipped)](../engineering/turn-processor-as-shipped.md); this page does not restate it. Between main turns, markets and election returns can refresh on quarter-hour marks without granting actions.

## Worked trace

A player with no office and no leadership role, Energy 5, with 130 actions, political influence 40, national influence 10, infamy 50 and favorability 80, in a country where their party does not hold the executive and with no accountability drain:

- Energy limits: `t = (5 - 1) / 9 = 0.4444`; `cap = round(200 + 0.4444 * 50) = round(222.2) = 222`; `threshold = round(100 + 0.4444 * 25) = round(111.1) = 111`.
- Actions: 130 is above 111, so the penalty is 4. Refresh is the base 4 (no bonuses). New actions = `min(222, max(0, 130 - 4 + 4)) = 130`.
- Political influence: `40 - 40 * 0.0075 = 39.7`.
- National influence: gain = `40 / 50 - 0.5 = 0.3`; decay = `10 * 0.01 = 0.1`; new = `10 - 0.1 + 0.3 = 10.2`.
- Infamy: `50 * 0.95 = 47.5`. Infamy drain on favorability uses the pre-decay value: `(50 - 20) * 0.05 = 1.5`.
- Favorability: above-60 penalty `(80 - 60) * 0.05 = 1.0`; new = `80 - 1.0 - 1.5 = 77.5`.

Election curve: a 24-turn general window with a pool P of 1.0 gives 12 early turns at `0.5 / 12 = 0.0417` each, 8 ramp turns at `0.2 / 8 = 0.025` each and 4 final turns at `0.3 / 4 = 0.075` each; 0.5 + 0.2 + 0.3 = 1.0.

## Edge cases and limits

- Actions never go below 0 and never above the Energy-derived cap. A character with no Energy stat falls back to the Energy 1 limits (200 and 100).
- Political influence and national influence are floored at 0 (NPP political influence at 10); player influence and favorability are clamped to 100 at most.
- Infamy never goes below 0; below 20 it does not drain favorability.
- A non-numeric action grant is skipped with an error log rather than written.
- Election windows of 4 turns or fewer, or with no early band, are handled by `turnVoteWeight` so the pool still integrates to its total.
- Elections are not on a universal clock: cadence is per country and office (`canonicalCycle.ts`), including bootstrap-skipped real-world cycles.
- A pending parliamentary government blocks ordinary legislation; presidential and one-party countries have no such freeze.
- Phase failures in the turn are isolated and recorded as warnings; the turn continues.

## Invariants

- Election vote weights across a general window sum to the pool (conservation). Enforced by the fold-forward logic in `turnVoteWeight`; tested in `src/lib/electionEngine/voteCalculations.test.ts` (the curve) .
- Actions stay between 0 and the cap after a refresh. Enforced by the `$min`/`$max` update pipeline; tested in `src/lib/turn/actionRefresh.test.ts` ("caps actions at 200").
- A turn is never processed twice concurrently or replayed after a crash. Enforced by the turn lock and crashed-turn recovery in the turn processor (see the engineering page).
- Bonuses do not stack within a family: highest leadership action bonus, highest national influence tier. Enforced in `resolveLeadershipActionBonus` and `resolvePositionNiBonus`.
- Percent-based decays use the pre-update value. Not separately enforced beyond unit tests in `shared/constants/formulas.test.ts`.

## Failure and recovery

- **A phase throws.** The turn records a warning and continues with later phases; the failed phase's work for that turn is not retried automatically. Repair is a targeted heal or a rerun of the affected phase's effect.
- **A turn crashes mid-way.** The next processor detects the stale lock and consumes the turn number instead of re-running it, to avoid double-applying income phases. The skipped phase is logged; any missed effect is repaired by a heal.
- **Stuck or slow turn.** Visible in phase timings and lock status; repaired by clearing the stale lock and letting the next turn run.
- **Wrong action balance.** The capped `actionGrantLog` (48 entries) shows each grant, penalty and cap for diagnosis; a balance is corrected by a grant or heal.

## Connections

**Driven by:**

- [Stats & Actions](./stats-actions.md): Energy sets the cap and hoard threshold.
- [Player Progression](./player-progression.md): the office held sets action and fund bonuses.
- [Congress Leadership](./congress-leadership.md), [Cabinet](./cabinet.md), central bank chair and court seats: role bonuses read in `processActionRefresh`.
- [Government Approval](./government-approval.md): executive-party influence decay uses the government's approval.

**Affects:**

- [Elections](./elections.md): turns count the ballots, and `turnVoteWeight` sets the closing-sprint weight.
- All timed systems (bills, cooldowns, crisis windows): the turn clock sets their cadence.
- The economy feature set: the fresh-world flag defaults decide which economy layers are live.

## Tests

- `src/lib/turn/actionRefresh.test.ts`: refresh, hoarding, cap, grant log.
- `shared/constants/formulas.test.ts`: decay and influence formulas.
- `src/lib/electionEngine/voteCalculations.test.ts`: accumulation curve.
- `src/simulation/phases/turnPhaseRegistry.test.ts` and the turn processor tests: registry order and locking.
- `src/lib/seeds/reference/featureFlagDefaults.test.ts`: fresh-world flag defaults.

Gaps: no single test ties the pieces on this page together, and the Energy-limit interpolation has no dedicated boundary test beyond the cap case.

## Known issues and history

- The earlier version of this page said freight starts in shadow mode and that National Political Influence gains "current PI divided by 100"; the code seeds fresh worlds with `freightSettlementMode: "active"` and uses the piecewise state-influence term above. Both are corrected here.
- Player wiki (`src/lib/seeds/wiki/content/coreSystems.ts`): no contradiction found with the constants verified above (base 4, starting 25, cap 200 to 250, hoard threshold 100 to 125, penalty 4).
- The bicameral lifecycle taxonomy (unicameral, sequential, concurrent) is stated from earlier notes and not confirmed as a named code switch.

Last checked: 2026-10-29, version 1.18.0
