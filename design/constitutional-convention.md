# Constitutional Convention

## Overview

The constitutional convention is the **voluntary** exit path from one-party rule, a player-initiated alternative to the forced Stage-4 collapse conversion described in [one-party-states-as-shipped.md](./one-party-states-as-shipped.md#constitutional-convention-the-voluntary-exit). A sitting leader announces a convention, negotiates a draft (target system, legacy-party seat reservation, election delay), and, if the draft is submitted in time, the regime converts to a parliamentary or presidential republic on a schedule the player chose rather than one collapse imposed.

Player guide: [One-Party States](https://www.ahousedividedgame.com/wiki/one-party-states) (the "Voluntary constitutional convention" section; there is no standalone convention page yet).

**Location:** `src/lib/onePartyState/constitutionalConvention.ts`. Shared limits live in `src/lib/onePartyState/conventionRules.ts`.

## Rules and constants

| Constant | Value | Source |
| --- | --- | --- |
| `CONVENTION_DRAFT_PHASE_TURNS` | 48 turns from announcement to draft deadline | `src/lib/onePartyState/conventionRules.ts` |
| `CONVENTION_ELECTION_DELAYS` | 12, 24 or 48 turns after the draft deadline | `src/lib/onePartyState/conventionRules.ts` |
| `CONVENTION_LEGACY_RESERVATION_MAX` | 35 (percent, minimum 0) | `src/lib/onePartyState/conventionRules.ts` |
| Default legacy reservation | 20 (`legacyReservationDefault ?? 20`; DD, RU, CN set 20) | `src/lib/onePartyState/conventionRules.ts`, `src/lib/countries/<id>/institutionsFacts.ts` |
| Default election delay | 24 (`electionDelayDefault ?? 24`; DD, RU, CN set 24) | same |
| `ANNOUNCE_POPULAR_BUMP` | +15 popular legitimacy | `src/lib/onePartyState/constitutionalConvention.ts` |
| `ANNOUNCE_INTRA_COST` | -10 ruling-party confidence | `src/lib/onePartyState/constitutionalConvention.ts` |
| `FORCED_LEGACY_RESERVATION` (forced path, for contrast) | 5 (3 when halved by a Stage-4 delay) | `src/lib/onePartyState/systemConversion.ts` |
| `FORCED_ELECTION_DELAY_TURNS` (forced path, for contrast) | 12 | `src/lib/onePartyState/systemConversion.ts` |

Who can act: only the sitting leader, through `POST /api/country/[code]/convention/announce` and `.../convention/draft` (both return 403 for anyone else, 409 for an invalid phase).

Both the convention path and the forced Stage-4 path share the same conversion implementation (`triggerSystemConversion` in `systemConversion.ts`), differing only in `path: "voluntary"` vs `"forced"` and in how the terms (legacy reservation, election delay) are set.

## Three Phases

The convention is a small state machine stored on the country's regime-escalation document (`getRegimeEscalationCollection`), under a `convention` field.

### 1. `announced`

`announceConvention(db, countryId, leaderCharacterId, currentTurn)`, player-initiated.

Pre-conditions (throws otherwise):

- The country must have a regime-escalation state row (self-healed via `ensureInitialEscalationState` if missing, a fresh game with no per-turn driver run yet still allows the announce).
- `currentStage` must not be `"collapse"`. Once collapsing, the only paths out are Stage-4's `acceptPeacefully`/`resist` decisions or a forced conversion, layering a voluntary convention on top would race `checkForcedConversion` and produce an undefined outcome.
- No convention already in progress.

Effects:

- Sets `convention.phase = "announced"`, `announcedAtTurn = currentTurn`, `draftDeadlineTurn = currentTurn + DRAFT_PHASE_TURNS` (48 turns).
- Defaults `legacyReservation` to `cfg.legacyReservationDefault ?? 20` and `electionDelayTurns` to `cfg.electionDelayDefault ?? 24` (overridable in the next phase).
- Sets `conventionInProgress: true`, which **freezes the Stage-4 dwell counter** for the country's whole regime-escalation state.
- Applies `+15` popular legitimacy (`ANNOUNCE_POPULAR_BUMP`) and `-10` ruling-party confidence (`ANNOUNCE_INTRA_COST`), announcing a convention plays well with the public and badly with the party apparatus.
- Records a `regime_escalation` country-history event.

### 2. `draft`

`submitConventionDraft(db, countryId, draft, currentTurn)` locks the convention's terms and advances `announced` -> `draft`.

Input (`ConventionDraftInput`):

- `targetSystem: GovernmentType`, must be in the country's `collapseTargetAllowlist` (falling back to a single-value `collapseTargetSystem` if the allowlist is omitted on that country's config). Throws otherwise.
- `legacyReservation: number`, must be `0..35` (the design's negotiated range for guaranteed legacy-party seats after conversion).
- `electionDelayTurns`, must be one of `12`, `24`, or `48` (`VALID_ELECTION_DELAYS`), matching the UI-exposed picker values.

Also requires an in-progress convention already in the `"announced"` phase; throws if there is no convention or if it's already past that phase.

### 3. `ratification`

Not player-triggered, reached automatically by the per-turn tick once the draft phase deadline passes (see below). At `draftDeadlineTurn + electionDelayTurns`, the tick driver fires `triggerSystemConversion(db, countryId, currentTurn, {targetSystem, legacyReservation, path: "voluntary", electionAtTurn: currentTurn})`, which flips `governmentType` and parks the snap-election marker for the election engine. The convention field is then cleared and `conventionInProgress` reset to `false`.

## Per-Turn Auto-Transitions (`tickConventionPhase`)

Called from `processRegimeEscalationTurn`, before the dwell update (so `conventionInProgress` is correct for that tick):

- **`announced` + deadline passed without a draft** -> the convention is **abandoned**: `convention` field is unset, `conventionInProgress` reset to `false`, and a `"dissolves without a draft"` history event is recorded. Nothing else happens, the regime stays one-party and Stage-4 dwell resumes accumulating.
- **`draft` + `draftDeadlineTurn` reached** -> advances to `ratification`. No conversion yet.
- **`ratification` + `draftDeadlineTurn + electionDelayTurns` reached** -> fires the conversion (see phase 3 above). Defensive guard: if somehow `targetSystem` is missing at this point (should be impossible since draft submission requires it), the convention is dropped without converting rather than risking a bad cast.

## Timing

- `tickConventionPhase` runs once per turn per country inside `processRegimeEscalationTurn` (`src/lib/turn/regimeEscalationTurn.ts`), called from the one-party country lifecycle (`processOnePartyBillLifecycleForCountry` in `src/lib/turn/onePartyBillLifecycle.ts`) right after leader legitimacy and confidence have drifted for the turn.
- Inside the tick, the convention transition runs first (step 0), then decision expiry, then the Stage-4 dwell update. That ordering makes `conventionInProgress` correct when the dwell counter reads it.
- The tick does nothing for a country with no installed leader.
- The forced Stage-4 path (`checkForcedConversion`) is a separate check; it does not fire while a convention is in progress.

## Edge cases and limits

- **Draft is one-shot.** `submitConventionDraft` only works in the `announced` phase, so a submitted draft cannot be edited or resubmitted. The error is a 409.
- **No cancel action.** A convention ends only by abandonment (no draft by the deadline), by conversion, or by the defensive drop when `targetSystem` is missing. After abandonment the leader may announce again, since the convention field is cleared.
- **Collapse blocks announcing.** Once `currentStage` is `collapse`, announcing throws (409).
- **Only the dwell counter freezes.** `conventionInProgress` holds the Stage-4 dwell counter (`stage4`) in place, it does not reset it or pause legitimacy and confidence drift.
- **Draft ranges.** Reservation outside 0..35, a delay outside {12, 24, 48}, or a target system outside the allowlist is rejected.
- **Election timing.** Conversion calls `triggerSystemConversion` with `electionAtTurn: currentTurn`, so the snap-election marker is set for the conversion turn itself; the 12/24/48 delay is the wait before the conversion, not after it.
- **A reservation cannot seat someone who never ran.** The floor applies per region and only where the former ruling party fielded a candidate.
- **The announce trade is permanent.** The +15 and -10 are applied once on announce and are not reversed if the convention is later abandoned.

## Worked example

A leader announces on turn 1000. The draft deadline is turn 1048. The leader submits a draft on turn 1020: parliamentary republic, 25 percent legacy reservation, 24-turn delay. On announce, popular legitimacy rises by 15 and ruling-party confidence falls by 10. At turn 1048 the phase moves to `ratification`. At turn 1072 (1048 + 24) the conversion fires: `governmentType` flips, the snap-election marker is set for turn 1072; in that election the former ruling party keeps at least 25 percent of each region's seats provided it stood a candidate there (`applyLegacySeatFloor` in `src/lib/turn/election/conversionTerms.ts`, multi-seat allocations only). Had no draft been submitted by turn 1048, the convention would have dissolved with no conversion and the Stage-4 dwell counter would have resumed.

```
turn 1000: announce            (+15 legitimacy, -10 confidence, dwell frozen)
turn 1020: draft submitted     (phase: draft)
turn 1048: draft deadline      (phase: ratification)
turn 1072: conversion + snap-election marker (deadline + 24)
```

## Design Notes

- The 48-turn draft window and the 12/24/48-turn election-delay choices give the player genuine room to negotiate before committing, but an abandoned announce costs nothing extra beyond the initial legitimacy/confidence trade, there's no penalty for announcing and then not following through.
- Freezing the Stage-4 dwell counter while a convention is in progress means a player can't be simultaneously racing toward a voluntary exit and getting overtaken by a forced Stage-4 collapse from the same underlying stress.
- Country config drives which target systems are reachable (`collapseTargetAllowlist`) and the negotiated defaults (`legacyReservationDefault`, `electionDelayDefault`), this is shared with the forced-conversion path so the two exits can't offer wildly different terms for the same country.

## Connections

**Driven by:**

- [One-party states](./one-party-states-as-shipped.md): the regime-escalation stage decides whether announcing is allowed (not in `collapse`), and legitimacy and confidence scores set the starting position (`src/lib/turn/regimeEscalationTurn.ts`).
- Country config (`collapseTargetAllowlist`, `legacyReservationDefault`, `electionDelayDefault`) sets reachable targets and defaults (`src/lib/onePartyState/conventionRules.ts`).

**Affects:**

- Popular legitimacy and ruling-party confidence, once on announce (`adjustPopularLegitimacy`, `adjustLeaderConfidence`).
- The Stage-4 dwell counter, frozen while `conventionInProgress` (`updateDwellCounters` in `src/lib/turn/regimeEscalation.ts`).
- The country's government type, party regime status and snap-election marker at conversion (`triggerSystemConversion` in `src/lib/onePartyState/systemConversion.ts`).
- Country history feed (`regime_escalation` events).

## Related Systems

- [one-party-states-as-shipped.md](./one-party-states-as-shipped.md) - Full one-party-state mechanics, including the forced Stage-4 collapse path and regime-escalation stages
- `src/lib/onePartyState/systemConversion.ts` - Shared conversion implementation (`triggerSystemConversion`)
- `src/lib/turn/regimeEscalationTurn.ts` - Per-turn regime-escalation driver

Last checked: 2026-10-29, version 1.18.0
