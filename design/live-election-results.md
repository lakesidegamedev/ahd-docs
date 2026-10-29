# Live Election Results

Election night turns a finished count into a public evening: regions report in over the last hour of a race and are called one at a time, while the turn engine stays the only authority on who actually won.

Player guide: [Live Election Results](https://www.ahousedividedgame.com/wiki/live-election-results)

## Overview

Election-night results page and polling facade: `/elections/[id]/results` and its polling endpoint `GET /api/elections/[id]/results`. Feature-flagged. Source: `src/lib/elections/liveResults/` (`featureFlag.ts`, `types.ts`, `computeResults.ts`, `electionNight.ts`).

Everything in `computeResults.ts` is display-only and deterministic on its inputs (including `now`), so every viewer sees the same drip-fed reveal and tests can pin exact behavior. A unit being "called" here is a UI projection; the turn engine remains the sole authority on the actual election outcome.

## Feature Flag

`isLiveElectionResultsEnabled(gameState)` reads `gameState.liveElectionResultsEnabled === true` (`featureFlag.ts`). The check is strict, so an unset flag is off. The world-defaults seed (`src/lib/seeds/reference/featureFlagDefaults.ts`) sets it to `true`, so new worlds start with election night on and an operator can switch it off per world.

## Election-Type Classification

| Set | Purpose | Members |
| --- | --- | --- |
| `WESTMINSTER_STYLE_TYPES` | Gets majority/hung-parliament call copy | `commons`, `snap_commons`, `holyrood`, `senedd`, `dail`, `shugiin`, `snap_shugiin`, `sangiin`, `bundestag`, `landtag`, plus beta-country lower chambers: `assembleeNationale`, `cameraDeputati`, `congresoDiputados`, `riksdag`, `milletMeclisi` |
| `NATIONAL_AGGREGATION_TYPES` | Sibling region elections summed into one national seat board | `house`, `commons`, `snap_commons`, `shugiin`, `snap_shugiin`, `sangiin`, `npcDelegate`, `peoplesCongress`, `bundestag`, `dail`, plus the same beta-country lower chambers |

`CHAMBER_LABELS` maps each election type to a display name (House of Representatives, House of Commons, Bundestag, Shūgiin, Dáil Éireann, National People's Congress, Riksdag, etc.).

`isElectionNightType(electionType)`, true iff in `NATIONAL_AGGREGATION_TYPES`. `electionNightStyle(electionType)`, `"westminster"` or `"generic"`. `electionNightTitle(electionType)`, `"Election Night · {chamber}"` or a bare fallback.

## Final-Hour Drip Window

`computeFinalHour(input, windowMs = 3600000)`, the wall-clock interval between the second-to-last and final turn of an active election. Returns `null` unless `status === "active"`, `endTurn`/`nextScheduledTurn` are set, `pausedAt` is unset (a frozen clock must not drip), and 0-1 turns remain. `progress` is the 0..1 fraction of the final hour elapsed; `endsAt` is `nextScheduledTurn`.

The route passes `windowMs` as one turn: 60 minutes, or 30 minutes when the world runs in fast mode (`buildResultsPayload.ts`).

`unitRevealOffset(electionId, unitId)`, deterministic `0.06..0.94` position in the final hour where a given unit (state, region) reveals, via `hashFraction` (FNV-1a hash to `[0,1)`). Same key always yields the same offset, so every viewer watches the same units declare in the same order, and the first/last minutes of the hour always have something happening.

## Reporting Percentage

`computeBaselineReportingPct(input)`, turn-based mid-campaign estimate, capped at `PRE_FINAL_REPORTING_CAP = 88`. There is no stored expected-turnout figure, so elapsed general-phase turns (`currentTurn - generalStart`, over `endTurn - generalStart`) stand in for it.

`computeUnitResult(input)` ramps a unit's `reportingPct`:

- `0` if the unit has zero votes.
- `100` once ended or revealed.
- During the final hour before reveal: ramps from the baseline toward (not past) 98 as `finalHourProgress` approaches the unit's `revealOffset`.
- Mid-campaign: baseline with a small deterministic per-unit jitter (`0.9..1.1`, from `hashFraction`) capped at `PRE_FINAL_REPORTING_CAP`, so the board doesn't read as one uniform number.

## Call Rules

These rules cover the generic path in `computeResults.ts`. US presidential races use `presidentialNight.ts` and primaries use `primaryNight.ts`, both described below.

`CALL_MARGIN_PCT = 5`, margin (percentage points) a leader needs before a unit is called.

A unit is `called` when: not tied, has votes, has a leader, and either the election has ended or (the unit has been revealed by the drip AND `leaderMarginPct >= CALL_MARGIN_PCT`). Mid-campaign, nothing is called, only leads are shown; calls wait for the final-hour reveal or election end. Ties are never called.

`computeElectoralTotals(units)` sums `weight` (EV for President, region seat count for multi-seat races) into `calledEv` (from called units) and `leadingEv` (from uncalled leading units).

## National Projection

`computeNationalProjection(parties, majorityThreshold, style)`:

| Condition | `kind` |
| --- | --- |
| No seats projected anywhere yet | `"tooEarly"` |
| Top party's projected seats ≥ threshold | `"majority"` (`margin` = seats past threshold) |
| Below threshold, `style === "westminster"` | `"hung"` |
| Below threshold, `style === "generic"` | `"largest"` (`margin` = lead over runner-up) |

`majorityThreshold(totalSeats) = floor(totalSeats / 2) + 1`.

## National Aggregation

`buildNationalElectionNight(db, election, partyMap, finalHourProgress, isEnded, majoritarianBonus?, orgRankingByState?)` (`electionNight.ts`) builds the country-wide seat board across sibling elections of the same `countryId`, `electionType` and `cycle` (plus the same `chamberClass` for Sangiin half-elections):

1. Returns `null` if `electionType` is not in `NATIONAL_AGGREGATION_TYPES`, or fewer than 2 sibling elections exist.
2. Loads each sibling's `ElectionVoteTally`, using the stored `seatsEstimate` if present or computing one via `computeSeatEstimates` (falls back to majoritarian-bonus org ranking per region, ticket #1032 note: the FPTP boost keys on each region's own party-organization ranking, so per-region rankings must be passed rather than one shared config).
3. Each region "declares" (`declared: true`) once ended, its own election status is in `ENDED_STATUSES` (`completed`, `resolved`, `cancelled`), or the drip's `finalHourProgress` passes that region's `unitRevealOffset`.
4. Sums seats by party across all regions (`projectedSeats`) and across declared regions only (`declaredSeats`).
5. Returns a `NationalResults` object: `style`, `chamberLabel`, `totalSeats`, `majorityThreshold`, `regionsDeclared`, `totalRegions`, `parties[]`, `regions[]`, `projection`.

`pickElectionNightAnchor(elections)`, for country-page embeds, prefers an active national multi-seat race, falling back to a completed/resolved one.

## Result Shape

`ElectionResultsResponse` (`types.ts`): `election` (meta including `evNeeded`/`totalEv` for President, `finalHour` drip state), `candidates[]` (with `electoralVotes`/`leadingElectoralVotes` for President, `seatsProjected` for multi-seat), `units[]` (per-region call/reporting detail), `national` (the aggregation above, or `null` for single-seat races), `summary` (`totalVotes`, `unitsReporting`, `unitsCalled`, `projectedWinner`), `isAdmin` (unlocks simulation controls client-side), `lastUpdated`, and an optional `simulated` flag set only on client-generated simulated frames, never by the API.

The endpoint is read-only. The client (`src/app/elections/[id]/night/useNightBroadcast.ts`) polls every 10 seconds (`NIGHT_POLL_MS`) while election night is on or the result is resolving, and every 30 seconds (`IDLE_POLL_MS`) while it waits for the night to open.

## US Presidential Night

`presidentialNight.ts` is a pure function of (election id, tally, schedule, now), so every viewer and a late joiner see the same board. It models the final-hour window as an evening with real poll-closing order (`src/lib/countries/us/data/usPollClosing.ts`).

- Each state closes at a window fraction between `NIGHT_FIRST_CLOSE_FRACTION = 0.06` and `NIGHT_LAST_CLOSE_FRACTION = 0.7`, by its real closing hour, with a jitter of up to +/-0.008.
- After closing, reporting climbs along a concave curve (`REPORTING_CURVE_EXPONENT = 2.2`) over `NIGHT_RAMP_FRACTION = 0.24` of the window, scaled by a per-state speed of 0.85 to 1.15. Each state has its own reporting cap between `NIGHT_REPORTING_CAP_MIN = 90` and `NIGHT_REPORTING_CAP_MAX = 97`, so reporting never reads 100 inside the window.
- Status ladder: polls open, counting (below `NIGHT_COUNTING_FLOOR = 1`), too early (below `NIGHT_LEADER_FLOOR = 8`), then leaning, too close or called.
- Displayed shares carry seeded noise up to `NIGHT_NOISE_MAX = 0.08` that shrinks to zero at the cap, and a called state's noise is bounded so the shown leader never contradicts the call.
- A state is **called** only when its counted margin survives the worst-case final turn. The worst case is every remaining vote going to the runner-up, priced as `finalTurnVoteRatio` from the real turn weights, times `NIGHT_CALL_SAFETY = 1.05`. A state that clears this is called once reporting reaches between `NIGHT_CALL_REPORTING_MIN = 25` and `NIGHT_CALL_REPORTING_MAX = 75` percent: blowouts early, narrow clears late. A state is "too close" when the margin is under `NIGHT_TOO_CLOSE_BAND = 0.03` with at least `NIGHT_TOO_CLOSE_REPORTING = 50` percent in.
- The tally used is the real cumulative tally as of the penultimate turn. The final turn is not counted inside the window. Once the race resolves, the route serves the real final result exactly, with every state called at 100%.

For a window of 12 or more turns the worst-case final turn is `(0.3 / 4) / (1 - 0.3 / 4)`, about 8.1% of the counted vote, so a state needs a counted margin above roughly 8.5% (8.1% times 1.05) to be called at all.

## Primary Night

`primaryNight.ts` gives each presidential primary wave an evening. A wave's states vote at once when the turn runs, so their final numbers already sit in the tally. Primary night spreads the reveal over `PRIMARY_NIGHT_HOURS = 8` real hours after the wave.

- States close between `PRIMARY_NIGHT_FIRST_CLOSE = 0.04` and `PRIMARY_NIGHT_LAST_CLOSE = 0.6` of the night in real poll-closing order, spread within a shared hour by `PRIMARY_NIGHT_SAME_HOUR_SPREAD = 0.8`.
- A state takes `PRIMARY_NIGHT_RAMP = 0.38` of the night to reach `PRIMARY_NIGHT_REPORTING_CAP = 0.99`, with the same counting, leader and noise floors as the presidential board (`PRIMARY_NIGHT_COUNTING_FLOOR = 1`, `PRIMARY_NIGHT_LEADER_FLOOR = 8`, `PRIMARY_NIGHT_NOISE_MAX = 0.08`).
- Display only: nothing here feeds resolution, delegates or momentum. Callers serve a state's real numbers only once `isPrimaryStateSettled` is true.

## Worked example

A national board with three regions in an election whose final-hour window is 60 minutes. Reveal offsets: A 0.20, B 0.55, C 0.90. Baseline reporting is 80 (elapsed general turns over general span). Final margins: A leads by 8 points, B by 3, C by 12.

| Drip progress | A reporting, status | B reporting, status | C reporting, status |
| --- | --- | --- | --- |
| 0.10 (6 min in) | 89, lead | 83, lead | 82, lead |
| 0.20 (12 min) | 100, **called** (8 >= 5) | 87, lead | 84, lead |
| 0.55 (33 min) | 100, called | 100, lead only (3 < 5) | 91, lead |
| 0.90 (54 min) | 100, called | 100, lead only | 100, **called** (12 >= 5) |

Reporting follows `round(80 + (98 - 80) × progress / offset)` until the unit's offset, then 100. After the election ends, B is called for its leader at any margin, because every untied unit is called once the election has ended. Mid-campaign (before the final hour) reporting for each unit sits at 80 times a per-unit jitter of 0.9 to 1.1 and never above 88.

## Timing

Live results run outside the turn processor. Nothing is written during the turn phases, and the engine resolves the election in `electionResolution` of the `electionResolutionAndGovernment` phase ([Election Engine](./election-engine.md#timing)). The results route computes everything on request from the stored tally, the turn clock (`nextScheduledTurn`, `currentTurn`, `pausedAt`) and `now`. The drip window opens when exactly one turn remains and closes at resolution, at which point the real result replaces the projection.

## Edge cases and limits

- **Paused clock:** `pausedAt` set means no drip window, so nothing reveals while the clock is frozen.
- **Zero votes:** a unit with no votes reports 0% and is never called.
- **Ties:** never called, even after the election ends. The reveal changes nothing about a tie.
- **Mid-campaign:** nothing is called, only leads are shown, and reporting is capped at 88 (`PRE_FINAL_REPORTING_CAP`). Calls wait for the final hour or the end. This keeps the final hour dramatic without hiding the standing.
- **Reveal offsets are bounded** to 0.06 to 0.94 of the hour, so something is always happening in the first and last minutes.
- **Fewer than 2 sibling elections:** no national board (`null`), only unit results.
- **No stored expected turnout:** elapsed general-phase turns stand in for reporting progress.
- **Display only:** a call here is a UI projection and never feeds resolution. The route serves the real final result after resolution, so a late call never conflicts with the outcome.
- **Presidential calls** use the margin test above, not the 5 point rule, because the final turn is heavy (the last 4 turns carry 30% of the vote pool).

## Constants

| Constant | Value | Source |
| --- | --- | --- |
| `CALL_MARGIN_PCT` | 5 | `computeResults.ts` |
| `PRE_FINAL_REPORTING_CAP` | 88 | `computeResults.ts` |
| Unit reveal offset | 0.06 + hash × 0.88 (0.06 to 0.94) | `unitRevealOffset`, `computeResults.ts` |
| Final-hour reporting ceiling | 98 before reveal, 100 after | `computeUnitResult`, `computeResults.ts` |
| Mid-campaign jitter | 0.9 to 1.1 | `computeResults.ts` |
| Majority threshold | `floor(totalSeats / 2) + 1` | `majorityThreshold`, `computeResults.ts` |
| Client poll interval | 10 s on the night, 30 s idle | `useNightBroadcast.ts` |
| Presidential night constants | see US Presidential Night | `presidentialNight.ts` |
| Primary night constants | see Primary Night | `primaryNight.ts` |

## Connections

**Driven by:**

- [Election Engine](./election-engine.md): the stored `ElectionVoteTally` and `seatsEstimate` (`tallyManagement.ts`) are the only vote inputs, and the engine's turn-weight function (`turnVoteWeight`) prices the worst-case final turn for presidential calls.
- [Elections](./elections.md): election status, `endTurn`, `primaryEndTurn` and the turn clock set the drip window.
- Operator feature flag (`liveElectionResultsEnabled`) decides whether a world shows the board.
- [Contingent Election](./contingent-election.md): a presidential race with no majority moves to the contingent process after the board shows it.

**Affects:**

- The election results page and country-page embeds (`pickElectionNightAnchor`) only. Nothing flows back into resolution, offices, [Parliamentary Government](./parliamentary-government.md) or any economy system.

Last checked: 2026-10-29, version 1.18.0
