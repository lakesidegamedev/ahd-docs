# Constitutional Convention

The constitutional convention is the **voluntary** exit path from one-party rule, a player-initiated alternative to the forced Stage-4 collapse conversion described in [one-party-states-as-shipped.md](./one-party-states-as-shipped.md#constitutional-convention-the-voluntary-exit). A sitting leader announces a convention, negotiates a draft (target system, legacy-party seat reservation, election delay), and, if the draft is submitted in time, the regime converts to a parliamentary or presidential republic on a schedule the player chose rather than one collapse imposed.

**Location:** `src/lib/onePartyState/constitutionalConvention.ts`. Shared limits live in `src/lib/onePartyState/conventionRules.ts`.

## Summary

A convention is a small three-phase state machine (`announced`, `draft`, `ratification`) stored on the country's regime-escalation document. Announcing costs the party apparatus and pleases the public, and freezes the Stage-4 collapse counter. The leader has 48 turns to lock a draft. With a draft, the country converts 12, 24 or 48 turns after that deadline and a snap election runs with the former ruling party's seat floor applied. Without a draft, the convention dissolves and nothing converts.

Player guide: [One-Party States](https://www.ahousedividedgame.com/wiki/one-party-states) (the "Constitutional convention and forced conversion" section; there is no standalone convention page yet).

## Rules

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| `CONVENTION_DRAFT_PHASE_TURNS` | 48 turns from announcement to draft deadline | `src/lib/onePartyState/conventionRules.ts` |
| `CONVENTION_ELECTION_DELAYS` | 12, 24 or 48 turns after the draft deadline | `src/lib/onePartyState/conventionRules.ts` |
| `CONVENTION_LEGACY_RESERVATION_MAX` | 35 (percent, minimum 0) | `src/lib/onePartyState/conventionRules.ts` |
| Default legacy reservation | 20 (`legacyReservationDefault ?? 20`; DD, RU, CN set 20) | `conventionDraftDefaults` in `src/lib/onePartyState/conventionRules.ts`, `src/lib/countries/<id>/institutionsFacts.ts` |
| Default election delay | 24 (`electionDelayDefault ?? 24`; DD, RU, CN set 24) | same |
| `ANNOUNCE_POPULAR_BUMP` | +15 popular legitimacy (clamped 0..100) | `src/lib/onePartyState/constitutionalConvention.ts`, `MAX_POPULAR_LEGITIMACY` in `src/lib/turn/popularLegitimacy.ts` |
| `ANNOUNCE_INTRA_COST` | -10 ruling-party confidence (clamped 0..95) | `src/lib/onePartyState/constitutionalConvention.ts`, `MAX_CONFIDENCE` in `src/lib/onePartyState/rulingPartyConfidence.ts` |
| `FORCED_LEGACY_RESERVATION` (forced path, for contrast) | 5 (3 when halved by a Stage-4 delay) | `src/lib/onePartyState/systemConversion.ts` |
| `FORCED_ELECTION_DELAY_TURNS` (forced path, for contrast) | 12 | `src/lib/onePartyState/systemConversion.ts` |
| `FORCED_VOTE_SHARE_PENALTY` (forced path only, for contrast) | -0.2 | `src/lib/onePartyState/systemConversion.ts` |

Who can act: only the sitting head of government (`isSittingLeader`), through `POST /api/country/[code]/convention/announce` and `.../convention/draft`. Both return 403 for anyone else. Announce returns 409 for collapse stage or a convention already running. Draft returns 409 for no convention or the wrong phase, and 400 for an invalid target, reservation or delay.

Both the convention path and the forced Stage-4 path share the same conversion implementation (`triggerSystemConversion` in `systemConversion.ts`), differing only in `path: "voluntary"` vs `"forced"` and in how the terms (legacy reservation, election delay, vote-share penalty) are set.

### Three phases

The convention is stored under a `convention` field on the country's regime-escalation document (`getRegimeEscalationCollection`).

#### 1. `announced`

`announceConvention(db, countryId, leaderCharacterId, currentTurn)`, player-initiated.

Pre-conditions (throws otherwise):

- The country must have a regime-escalation state row (self-healed via `ensureInitialEscalationState` if missing, a fresh game with no per-turn driver run yet still allows the announce).
- `currentStage` must not be `"collapse"`. Once collapsing, the only paths out are Stage-4's `acceptPeacefully`/`resist` decisions or a forced conversion, layering a voluntary convention on top would race `checkForcedConversion` and produce an undefined outcome.
- No convention already in progress.

Effects:

- Sets `convention.phase = "announced"`, `announcedAtTurn = currentTurn`, `draftDeadlineTurn = currentTurn + 48`.
- Defaults `legacyReservation` to `cfg.legacyReservationDefault ?? 20` and `electionDelayTurns` to `cfg.electionDelayDefault ?? 24` (overridable in the next phase).
- Sets `conventionInProgress: true`, which **freezes the Stage-4 dwell counter** for the country's whole regime-escalation state.
- Applies `+15` popular legitimacy and `-10` ruling-party confidence, announcing a convention plays well with the public and badly with the party apparatus.
- Records a `regime_escalation` country-history event.

#### 2. `draft`

`submitConventionDraft(db, countryId, draft, currentTurn)` locks the convention's terms and advances `announced` -> `draft`.

Input (`ConventionDraftInput`):

- `targetSystem: GovernmentType`, must be in `conventionTargetAllowlist(countryId)`: the country's `collapseTargetAllowlist`, falling back to a single-value `collapseTargetSystem` if the allowlist is omitted. The route schema additionally limits the value to `presidential`, `parliamentaryMonarchy` or `parliamentaryRepublic`, never `onePartyState`, because a convention is the exit path, not a way back in.
- `legacyReservation: number`, an integer `0..35` (percent of each region's seats guaranteed to the former ruling party after conversion).
- `electionDelayTurns`, one of `12`, `24` or `48` (`CONVENTION_ELECTION_DELAYS`), matching the UI picker values.

Requires an in-progress convention in the `"announced"` phase; throws if there is no convention or it is already past that phase.

#### 3. `ratification`

Not player-triggered, reached automatically by the per-turn tick once the draft phase deadline passes. At `draftDeadlineTurn + electionDelayTurns` the tick fires `triggerSystemConversion(db, countryId, currentTurn, {targetSystem, legacyReservation, path: "voluntary", electionAtTurn: currentTurn})`, which flips `governmentType` and writes the snap-election marker. The convention field is then cleared and `conventionInProgress` reset to `false`.

### Per-turn auto-transitions (`tickConventionPhase`)

Called from `processRegimeEscalationTurn`, before the dwell update (so `conventionInProgress` is correct for that tick):

- **`announced` + `currentTurn >= draftDeadlineTurn` without a draft** -> the convention is **abandoned**: `convention` is unset, `conventionInProgress` reset to `false`, and a "dissolves without a draft" history event is recorded. The regime stays one-party and Stage-4 dwell resumes accumulating.
- **`draft` + `currentTurn >= draftDeadlineTurn`** -> advances to `ratification`. No conversion yet, and the function returns, so the earliest conversion check is the next tick.
- **`ratification` + `currentTurn >= draftDeadlineTurn + electionDelayTurns`** -> fires the conversion. Defensive guard: if `targetSystem` is missing at this point (should be impossible since draft submission requires it), the convention is dropped without converting rather than risking a bad cast.

### What conversion does

`triggerSystemConversion` (`src/lib/onePartyState/systemConversion.ts`):

1. `updateCountryState`: `governmentType = targetSystem`, `opsVoteMultipliers = null`, `hasLeaderConfidenceModel = false` (this switches off the per-turn leader legitimacy and confidence drivers).
2. `clearAllRegimeStatusForCountry`: every party's regime status is wiped.
3. Country-history `regime_escalation` event, subtype `conversion`.
4. `bootstrapNewSystem` (`src/lib/onePartyState/conversionBootstrap.ts`) writes `countryState.pendingPostConversionElection = {atTurn, legacyReservation, formerRulingPartyId, forcedVoteSharePenalty, path}`, capturing `rulingPartyId` before it is cleared.

`processPostConversionElections` (`src/lib/turn/postConversionElections.ts`) finds every country whose marker `atTurn <= currentTurn`, calls `triggerSnapElection` with `reason: "regime-change"` and `bypassLimits: true`, passes the terms as `conversionTerms` (only when `formerRulingPartyId` is set), then clears the marker whether or not the snap succeeded.

General resolution applies the terms through `src/lib/turn/election/conversionTerms.ts`:

- `applyLegacySeatFloor`: for multi-seat allocations only, `floorSeats = min(total, round(total * legacyReservationPct / 100))`. If the former ruling party holds fewer, seats move one at a time to its best-placed candidate, each taken from the other party's winner holding the most seats (the weaker vote gives way on a tie). A reservation of 0 or a party that stood no candidate in the region changes nothing.
- `applyConversionVotePenalty` (forced path only): the former ruling party's votes scale by `max(0, 1 + penalty)`. Not used by the voluntary path.

## Data

| Collection | Field | Written by | Player-visible |
| --- | --- | --- | --- |
| `regimeEscalation` (`_id` = country id) | `convention.phase`, `announcedAtTurn`, `draftDeadlineTurn`, `targetSystem`, `legacyReservation`, `electionDelayTurns` | `announceConvention`, `submitConventionDraft`, `tickConventionPhase` | Yes, to the leader, via `GET /api/country/[code]/regime/leader` (`convention`, `conventionInProgress`, `conventionDraftOptions`) |
| `regimeEscalation` | `conventionInProgress` | same | Yes (same endpoint) |
| `countryLeaderStates` | `popularLegitimacy`, `partyConfidence` and their history entries | `adjustPopularLegitimacy`, `adjustLeaderConfidence` | Yes, in the leader panel |
| `countryState` | `governmentType`, `opsVoteMultipliers`, `hasLeaderConfidenceModel`, `pendingPostConversionElection` | `triggerSystemConversion`, `bootstrapNewSystem`, cleared by `processPostConversionElections` | Government type yes; the marker is internal |
| country history | `regime_escalation` events (subtypes `convention` with phases `announced`, `draft`, `abandoned`, and `conversion`) | `recordCountryEvent` | Yes, in the country history feed |
| party documents | `regimeStatus` cleared | `clearAllRegimeStatusForCountry` | Yes (party tier) |
| `elections` | `conversionTerms` stamped on the snap races | `triggerSnapElection` | Results only |

`ConventionState.ratifiedAtTurn` exists in `src/lib/db/types/regimeEscalation.ts` but nothing writes it.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `collapseTargetSystem` | unset (no convention possible without it or an allowlist) | `src/lib/constants/countries.ts` type; DD, RU, CN set `parliamentaryRepublic` in `src/lib/countries/<id>/institutionsFacts.ts` |
| `collapseTargetAllowlist` | `[collapseTargetSystem]` | CN and RU set `["parliamentaryRepublic", "presidential"]`; DD sets none, so DD may only draft `parliamentaryRepublic` |
| `legacyReservationDefault` | 20 | DD, RU, CN set 20; fallback in `conventionDraftDefaults` |
| `electionDelayDefault` | 24 | DD, RU, CN set 24; fallback in `conventionDraftDefaults` |
| `hasLeaderConfidenceModel` | per country | `true` for DD, RU, CN; set to `false` by conversion |

There are no gameConfig fields and no era or scenario overrides for the convention. The draft limits (48 turns, 12/24/48, 35 percent) are code constants, not configurable.

## Timing

- `tickConventionPhase` runs once per turn per country inside `processRegimeEscalationTurn` (`src/lib/turn/regimeEscalationTurn.ts`), called from the one-party country lifecycle (`processOnePartyBillLifecycleForCountry` in `src/lib/turn/onePartyBillLifecycle.ts`, registered per country in `src/lib/turn/countryPhases.ts`) right after leader legitimacy and confidence have drifted for the turn.
- Inside the tick, the convention transition runs first (step 0), then decision expiry, then the Stage-4 dwell update. That ordering makes `conventionInProgress` correct when the dwell counter reads it.
- The tick does nothing for a country with no installed leader.
- The forced Stage-4 path (`checkForcedConversion`) is a separate check; it does not fire the collapse branch while a convention is in progress.
- The snap election itself is opened by the `postConversionElections` phase in `src/simulation/phases/turnPhaseRegistry.ts`, after election resolution and parliamentary government phases, ahead of `ensurePerpetualElections`.

```
player:   announce ---------- draft (any time before deadline) ----------------------
tick:     announced --------- draft ----------- ratification ------------ conversion
turn:     T                                     T+48 (deadline)           T+48+delay
effects:  +15 / -10,                            phase -> ratification     governmentType flips,
          dwell frozen                                                    marker written
turn phases (same or next turn after conversion):
  country lifecycle (tick, conversion) -> postConversionElections (snap election opens)
  -> electionResolution later applies legacy seat floor
```

## Worked trace

A leader of CN announces on turn 1000 with popular legitimacy 75 and ruling-party confidence 75.

1. Announce: popular `clampPopular(75 + 15) = 90`; confidence `clampConfidence(75 - 10) = 65`. `draftDeadlineTurn = 1000 + 48 = 1048`. Defaults 20 percent and 24 turns are stored. `conventionInProgress = true`.
2. Turn 1020: leader submits `{targetSystem: "parliamentaryRepublic", legacyReservation: 25, electionDelayTurns: 24}`. Both are valid for CN (allowlist includes it; 25 is in 0..35; 24 is allowed). Phase becomes `draft`.
3. Turn 1048: `1048 >= 1048`, phase becomes `ratification`.
4. Turn 1072: `electionTurn = 1048 + 24 = 1072`, `1072 >= 1072`, conversion fires: `governmentType = "parliamentaryRepublic"`, marker `{atTurn: 1072, legacyReservation: 25, formerRulingPartyId, path: "voluntary"}`. Convention cleared, `conventionInProgress = false`.
5. `postConversionElections` (turn 1072): marker `atTurn 1072 <= 1072`, snap election opens with `legacyReservationPct: 25` and no vote-share penalty; marker cleared.
6. Resolution of a 12-seat region where the former ruling party stood candidates but won 1 seat: `floorSeats = min(12, round(12 * 25 / 100)) = 3`. It holds 1, so 2 seats move, one at a time, from the other party's winner with the most seats. It ends with 3.

```
turn 1000: announce            (+15 legitimacy, -10 confidence, dwell frozen)
turn 1020: draft submitted     (phase: draft)
turn 1048: draft deadline      (phase: ratification)
turn 1072: conversion + snap-election marker (deadline + 24)
```

Had no draft been submitted by turn 1048, the convention would have dissolved with no conversion, the +15 and -10 would have stayed, and the Stage-4 dwell counter would have resumed.

## Edge cases and limits

- **Draft is one-shot.** `submitConventionDraft` only works in the `announced` phase, so a submitted draft cannot be edited or resubmitted. The error is a 409.
- **No cancel action.** A convention ends only by abandonment (no draft by the deadline), by conversion, or by the defensive drop when `targetSystem` is missing. After abandonment the leader may announce again, since the convention field is cleared.
- **Collapse blocks announcing.** Once `currentStage` is `collapse`, announcing throws (409).
- **Only the dwell counter freezes.** `conventionInProgress` holds the Stage-4 dwell counter (`stage4`) in place (`updateDwellCounters` in `src/lib/turn/regimeEscalation.ts`), it does not reset it or pause legitimacy and confidence drift.
- **Draft ranges.** Reservation outside 0..35, a delay outside {12, 24, 48}, or a target system outside the allowlist is rejected with 400.
- **Election timing.** Conversion calls `triggerSystemConversion` with `electionAtTurn: currentTurn`, so the snap-election marker is set for the conversion turn itself; the 12/24/48 delay is the wait before the conversion, not after it. The forced path is the opposite: it converts first and holds the election 12 turns later.
- **A reservation cannot seat someone who never ran.** The floor applies per region, only to multi-seat allocations, and only where the former ruling party fielded a candidate. A 0 percent reservation is a no-op.
- **The announce trade is permanent.** The +15 and -10 are applied once on announce and are not reversed if the convention is later abandoned. Both are clamped, so a leader already at 100 popular legitimacy gains nothing from the +15.
- **No marker without a former ruling party.** If `formerRulingPartyId` is null when the conversion runs, the snap still fires but carries no conversion terms.
- **Announce is gated on the sitting leader only.** The route does not check that the country is a one-party state. In a country with no `collapseTargetSystem` or allowlist the allowlist is empty, so no draft can be accepted.

## Invariants

- A convention exists only in phases `announced`, `draft` or `ratification`; `conventionInProgress` is true exactly while the field exists. Enforced by the tick and the announce/draft guards, covered by `constitutionalConvention.test.ts`. No runtime consistency check compares the two fields.
- At most one convention per country. Enforced by the "already in progress" guard in `announceConvention`.
- A conversion never fires without a `targetSystem`. Enforced by the defensive guard in `tickConventionPhase`.
- Draft values always lie in the allowed ranges. Enforced in `submitConventionDraft` and the route schema, tested in both route and unit tests.
- The snap-election marker is consumed once. `processPostConversionElections` clears it whether or not the snap succeeded (`src/lib/turn/postConversionElections.test.ts`).
- Legacy seat floor never exceeds the region's seat total and the total is preserved (`Math.min(total, ...)` in `applyLegacySeatFloor`; the total-preserving case is tested in `conversionTerms.test.ts`).
- Conversion is idempotent on the same turn (same fields, same values). Not directly tested.

## Failure and recovery

- **Escalation row missing.** Announce and the tick self-heal it with `ensureInitialEscalationState`.
- **History write fails.** Logged and swallowed; the state change still stands.
- **Snap election cannot open** (for example the country has no government-formation document). The error is logged per country, the marker is cleared anyway, and the country is left converted with no snap election. Repair is an admin-started snap election.
- **Stuck convention** (phase present, tick not running for the country, for example no installed leader). The convention waits. Repair is installing a leader, or an admin clearing the `convention` field and `conventionInProgress`.
- **Conversion applied but history or marker missing** after a partial failure. The conversion call is repeatable (it sets the same values), so a rerun of the conversion repairs it.

## Connections

**Driven by:**

- [One-party states](./one-party-states-as-shipped.md): the regime-escalation stage decides whether announcing is allowed (not in `collapse`), and legitimacy and confidence scores set the starting position (`src/lib/turn/regimeEscalationTurn.ts`).
- Country config (`collapseTargetAllowlist`, `legacyReservationDefault`, `electionDelayDefault`) sets reachable targets and defaults (`src/lib/onePartyState/conventionRules.ts`).

**Affects:**

- Popular legitimacy and ruling-party confidence, once on announce (`adjustPopularLegitimacy`, `adjustLeaderConfidence`).
- The Stage-4 dwell counter, frozen while `conventionInProgress` (`updateDwellCounters` in `src/lib/turn/regimeEscalation.ts`).
- The country's government type, party regime status and snap-election marker at conversion (`triggerSystemConversion` in `src/lib/onePartyState/systemConversion.ts`).
- The first post-conversion election, through `processPostConversionElections` and `applyLegacySeatFloor` (`src/lib/turn/election/conversionTerms.ts`).
- Country history feed (`regime_escalation` events).

Related code: `src/lib/onePartyState/systemConversion.ts` (shared conversion, `triggerSystemConversion`) and `src/lib/turn/regimeEscalationTurn.ts` (per-turn driver).

## Tests

- `src/lib/onePartyState/constitutionalConvention.test.ts`: announce (self-heal, collapse rejection, duplicate rejection, defaults, +15/-10, history), draft (allowlist, reservation range, delay values, phase guard, lock), tick (no-op, abandonment, draft to ratification, conversion fires, conversion waits).
- `src/app/api/country/[code]/convention/announce/route.test.ts` and `src/app/api/country/[code]/convention/draft/route.test.ts`: auth, leader gate, status codes.
- `src/lib/turn/election/conversionTerms.test.ts`: legacy seat floor and vote penalty.
- `src/lib/turn/postConversionElections.test.ts`: marker consumption, terms carried onto the snap, marker cleared even when the snap throws.
- `src/lib/onePartyState/systemConversion.test.ts`, `src/lib/turn/regimeEscalation.test.ts`, `src/lib/turn/regimeEscalationTurn.test.ts`: conversion and the `conventionInProgress` dwell freeze.
- `src/lib/turn/__sim__/conventionRecoveryE2E.test.ts`: convention recovery flow.
- `src/lib/turn/regimeEscalationTurn.nppJourney.test.ts` mocks the convention tick.

Gaps: no single test runs announce, draft, tick, conversion, marker, snap election and seat floor together; the clamp interaction on the announce deltas is not tested.

## Known issues and history

- `ConventionState.ratifiedAtTurn` and the `convention.draft` decision kind (with its `useDefaults` fallback in `src/lib/onePartyState/decisionQueue.ts`) are defined but nothing writes or offers them; the live flow uses the announce and draft routes.
- The route does not reject an announce from a non-one-party country (see Edge cases).
- The type comment on `pendingPostConversionElection` in `src/lib/db/types/regimeEscalation.ts` suggests the field lives on regime escalation; it lives on `countryState`.
- Before the `postConversionElections` phase existed, the marker was written but nothing consumed it, so conversions flipped the government type without ever holding the promised election (recorded in the header of `src/lib/turn/postConversionElections.ts`).
- Player wiki (`src/lib/seeds/wiki/content/onePartyStates.ts`) wording differs from the code: it says the forced conversion "reserves only 5 seats" and the draft packages "reserved seats (up to 35)", but both values are percentages of each region's seats, not seat counts. It also says every conversion "dissolves the legislature", which is the snap election's behaviour, not something this module does directly.

### Design notes

- The 48-turn draft window and the 12/24/48-turn election-delay choices give the player genuine room to negotiate before committing, but an abandoned announce costs nothing extra beyond the initial legitimacy/confidence trade, there's no penalty for announcing and then not following through.
- Freezing the Stage-4 dwell counter while a convention is in progress means a player can't be simultaneously racing toward a voluntary exit and getting overtaken by a forced Stage-4 collapse from the same underlying stress.
- Country config drives which target systems are reachable (`collapseTargetAllowlist`) and the negotiated defaults (`legacyReservationDefault`, `electionDelayDefault`), this is shared with the forced-conversion path so the two exits can't offer wildly different terms for the same country.

Last checked: 2026-10-29, version 1.18.0
