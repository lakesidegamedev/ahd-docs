# Live Election Results

## Overview

Election-night results page and polling facade: `/elections/[id]/results` and its polling endpoint `GET /api/elections/[id]/results`. Feature-flagged, default off. Source: `src/lib/elections/liveResults/` (`featureFlag.ts`, `types.ts`, `computeResults.ts`, `electionNight.ts`).

Everything in `computeResults.ts` is display-only and deterministic on its inputs (including `now`), so every viewer sees the same drip-fed reveal and tests can pin exact behavior. A unit being "called" here is a UI projection; the turn engine remains the sole authority on the actual election outcome.

## Feature Flag

`isLiveElectionResultsEnabled(gameState)` reads `gameState.liveElectionResultsEnabled === true`. Lives on the `gameState` singleton, flipped via the admin Feature Gates panel (`/api/admin/feature-gates`, key `liveElectionResultsEnabled`). Default off.

## Election-Type Classification

| Set | Purpose | Members |
| --- | --- | --- |
| `WESTMINSTER_STYLE_TYPES` | Gets majority/hung-parliament call copy | `commons`, `snap_commons`, `holyrood`, `senedd`, `dail`, `shugiin`, `snap_shugiin`, `sangiin`, `bundestag`, `landtag`, plus beta-country lower chambers: `assembleeNationale`, `cameraDeputati`, `congresoDiputados`, `riksdag`, `milletMeclisi` |
| `NATIONAL_AGGREGATION_TYPES` | Sibling region elections summed into one national seat board | `house`, `commons`, `snap_commons`, `shugiin`, `snap_shugiin`, `sangiin`, `npcDelegate`, `peoplesCongress`, `bundestag`, `dail`, plus the same beta-country lower chambers |

`CHAMBER_LABELS` maps each election type to a display name (House of Representatives, House of Commons, Bundestag, Shūgiin, Dáil Éireann, National People's Congress, Riksdag, etc.).

`isElectionNightType(electionType)`, true iff in `NATIONAL_AGGREGATION_TYPES`. `electionNightStyle(electionType)`, `"westminster"` or `"generic"`. `electionNightTitle(electionType)`, `"Election Night · {chamber}"` or a bare fallback.

## Final-Hour Drip Window

`computeFinalHour(input, windowMs = 3600000)`, the wall-clock interval between the second-to-last and final turn of an active election. Returns `null` unless `status === "active"`, `endTurn`/`nextScheduledTurn` are set, `pausedAt` is unset (a frozen clock must not drip), and 0-1 turns remain. `progress` is the 0..1 fraction of the final hour elapsed; `endsAt` is `nextScheduledTurn`.

`unitRevealOffset(electionId, unitId)`, deterministic `0.06..0.94` position in the final hour where a given unit (state, region) reveals, via `hashFraction` (FNV-1a hash to `[0,1)`). Same key always yields the same offset, so every viewer watches the same units declare in the same order, and the first/last minutes of the hour always have something happening.

## Reporting Percentage

`computeBaselineReportingPct(input)`, turn-based mid-campaign estimate, capped at `PRE_FINAL_REPORTING_CAP = 88`. There is no stored expected-turnout figure, so elapsed general-phase turns (`currentTurn - generalStart`, over `endTurn - generalStart`) stand in for it.

`computeUnitResult(input)` ramps a unit's `reportingPct`:

- `0` if the unit has zero votes.
- `100` once ended or revealed.
- During the final hour before reveal: ramps from the baseline toward (not past) 98 as `finalHourProgress` approaches the unit's `revealOffset`.
- Mid-campaign: baseline with a small deterministic per-unit jitter (`0.9..1.1`, from `hashFraction`) capped at `PRE_FINAL_REPORTING_CAP`, so the board doesn't read as one uniform number.

## Call Rules

These rules cover the generic path in `computeResults.ts`. US presidential races use `presidentialNight.ts` instead: states close their polls in real-world order during the final hour, and a state is only called once the remaining final turn provably cannot flip it, not by a fixed margin. Primary nights use `primaryNight.ts`.

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

The endpoint is read-only and polled every 30 seconds during active elections.
