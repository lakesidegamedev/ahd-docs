# Snap Elections

Design doc for snap elections in parliamentary countries. Scope: dissolution
of the lower chamber before its regular term ends, either by the sitting head
of government or automatically when one cannot be seated within a bounded
window.

Presidential countries such as the US are unaffected. Germany is a
parliamentary republic with both confidence and snap-election mechanisms and
uses the shared path.

## Real-world grounding

**United Kingdom (post-2022).** The 2011 Fixed-term Parliaments Act - which imposed a 14-day window after a successful no-confidence vote for an alternative government to form before an election was called - was repealed by the Dissolution and Calling of Parliament Act 2022. Today a PM may request dissolution from the monarch at any time; by convention they do so either after losing the confidence of the Commons or to capitalise on a favourable political moment. A successful no-confidence vote is politically binding but does not legally trigger an election on its own.

**Japan (Article 69).** If the Shūgiin passes a no-confidence resolution (or fails to pass a government-backed confidence motion), the Cabinet must within ten days either resign en masse or dissolve the Shūgiin. Historically dissolution has been the more common response (Ōhira 1980, Miyazawa 1993, Mori 2000 abstained, Abe 2014 preemptively dissolved).

The game captures both traditions through a single mechanic: any PM vacancy - however it arises - starts a 96-turn (= 96 real-time-hour, ≈ 2-game-year) clock. If no new PM is seated before the clock expires, the lower chamber is automatically dissolved and a fresh election is called. Sitting PMs can also trigger a snap election voluntarily, up to 2 per appointment, gated by a 336-turn cooldown.

## Eligibility

A country is eligible for snap elections when `COUNTRY_CONFIGS[countryId].snapElectionsAllowed === true` **and** its `legislature.lowerChamber.key` is set.

Examples of configured lower chambers:

| Country | snapElectionsAllowed | lowerChamber.key | Snap election type |
| ------- | -------------------- | ---------------- | ------------------ |
| UK      | yes                  | `commons`        | `snap_commons`     |
| JP      | yes                  | `shugiin`        | `snap_shugiin`     |
| DE      | yes                  | `bundestag`      | `snap_bundestag`   |
| US      | no                   | `house`          | n/a                |

This table is illustrative, not exhaustive. Ireland, Scotland, Wales, and
several beta parliamentary countries also opt in through country config.

Upper chambers (UK Lords, JP Sangiin) are explicitly excluded - Sangiin's `snapElectionsAllowed: false` is a hard gate; Lords are not elected.

## Player trigger: `/api/country/[code]/pm/snap-election`

Only the sitting PM (matched by `governmentFormations.pmCharacterId`) may call this endpoint.

**Gates:**

- `snapElectionsAllowed` on the country config.
- `governmentFormations.status === "formed"`.
- `snapElectionsUsed < 2` per appointment (counter resets on new PM seated).
- `currentTurn - lastSnapElectionTurn >= 336` (2 real-time weeks) if prior snap was triggered this appointment.
- **No active confidence motion exists for the UK.** A sitting PM cannot call a snap while a `pmAppointmentVotes` document with `isConfidenceMotion: true` and `status: "active"` is pending (`src/lib/turn/snapElection.ts`). This check applies to PM-triggered snaps and is independent of the snap limit bypass.

**Effects (on success, in order):**

1. All active/upcoming regular lower-chamber elections for the country are set to `status: "cancelled"`.
2. **In-progress bills whose `currentChamber` is the lower chamber** (`proposed`, `active`, `passed_origin`, `active_other`, `override_shugiin`, `veto_override`, `vetoed`) are set to `status: "failed"`. Bills currently in the upper chamber (Lords, Sangiin), in JP `cabinet_review`, or `enrolled` are preserved - their chambers are not dissolved.
3. One `snap_${lowerChamberKey}` election is spawned per region (active status, primary opens immediately, 48-hour window: 24h primary + 24h general).
4. `governmentFormations.snapElectionsUsed` is incremented; `lastSnapElectionTurn` set to `currentTurn`.
5. **The sitting Prime Minister is vacated** via `unformGovernmentAndVacatePM` - `pmCharacterId` and `pmName` cleared, cabinet cleared, `currentOffice` cleared on the character and NPP docs, government status transitions to `pending`, and the 96-turn PM-vacancy clock is re-armed.
6. Government cycle/seat counters are updated via `resetParliamentaryGovernmentAfterElection`.
7. A Discord game event is emitted.

## Dissolution slate-clearing

When a lower-chamber general election resolves (regular or snap) in any country with a configured `lowerChamber.key`, the turn processor invokes two helpers in `runPostElectionGovernmentPhases`:

- `failInProgressBills(db, countryId, now)` - fails every bill whose `currentChamber === lowerChamberKey` and whose status is one of `proposed`, `active`, `passed_origin`, `active_other`, `override_shugiin`, `veto_override`, `vetoed`. Bills in the upper chamber, in JP `cabinet_review`, or `enrolled` are preserved.
- `cancelActiveNoConfidenceVotes(db, countryId, now)` - cancels every active VONC for the country. No-op for countries that don't use VONC (e.g., US).

For parliamentary countries, the existing
`resetParliamentaryGovernmentAfterElection` call still runs after these
helpers.

This fires for any configured lower-chamber election and its snap type. Adding
a new country with a configured `legislature.lowerChamber.key` unlocks the
behavior automatically.

## Auto-trigger: 96-turn PM vacancy deadline

When `governmentFormations.status` transitions into `pending` - regardless of cause (post-election reset, no-confidence pass, admin PM vacate) - the turn processor sets `pmVacancyDeadlineTurn = currentTurn + 96`.

A new turn phase (`parliamentaryVacancyWatcher`) runs once per turn after the regular parliamentary government phases. For each country with:

- `snapElectionsAllowed === true`, and
- `status === "pending"`, and
- `pmVacancyDeadlineTurn != null` and `currentTurn >= pmVacancyDeadlineTurn`

the watcher invokes `triggerSnapElection(db, countryId, now, { reason: "auto-snap", bypassLimits: true })`. Because the snap itself calls `resetParliamentaryGovernmentAfterElection`, `pmVacancyDeadlineTurn` is re-set to `currentTurn + 96` on the way out, giving the post-snap period another full window before a second auto-snap could fire.

The deadline is cleared (set to `null`) when:

- A PM appointment vote passes (`processParliamentaryGovernmentVotes`).
- An admin directly appoints a PM (`/api/admin/uk/government/appoint-pm`).
- `appointPrimeMinister` is called with a non-null character id from any other flow.

### Why this replaces a direct "no-confidence → snap" rule

A successful no-confidence vote already transitions the government into `pending`, which is the exact trigger the deadline watches for. Folding NC into the general vacancy clock removes a special case: the game doesn't need to distinguish "snap because of NC" from "snap because a coalition fell apart" from "snap because no party can form a majority." The 96-turn window honours both the UK post-FTPA convention (14-day alternative-government attempt, scaled) and JP Article 69 (10-day resign-or-dissolve, scaled).

## Cycle reset after a snap

Snap elections shift the entire LARP schedule forward. The next regular lower-chamber election is anchored to the snap's `endTime`, not to the original bootstrap.

| Country    | Cycle period          | Next regular election's end-turn |
| ---------- | --------------------- | -------------------------------- |
| UK Commons | 240 turns (5 game-yr) | `snap.endTurn + 240`             |
| JP Shūgiin | 192 turns (4 game-yr) | `snap.endTurn + 192`             |

The cycle counter continues incrementing: a snap that resolves at cycle `N` is followed by a regular cycle `N + 1` whose end-turn sits 240 (UK) or 192 (JP) turns after the snap's end-turn.

### Implementation

- **`ensureUKElections` / `ensureJPElections`** query both the regular and snap types when determining "most recent completed election" per region. When the most recent is a snap, the cycle-gap check uses the snap's `endTime + cyclePeriod` before permitting a new regular election to spawn, and the regular election's `durationHours` is always the regular cycle duration - never inherited from the snap's 48h.
- **`canonicalTurns` in `recalibrate-timers`** accepts an optional `priorEndTurn`. For `commons`, `regionalCouncil`, and `shugiin`, when a prior (regular-or-snap) election exists for the same region, the anchor is `priorEndTurn + cyclePeriodHours` instead of the bootstrap-derived default. The admin UI mirrors the same rule in `canonicalEndTurn`.

## What a snap does **not** touch

- **Upper chambers.** UK Lords are not elected; JP Sangiin has `snapElectionsAllowed: false` on its `upperElectionSystem`. A snap never cancels or re-spawns upper-chamber elections.
- **Regional councils / sub-national offices.** A snap cancels only the lower-chamber regular races matching the country's `lowerChamber.key`. UK Regional Council elections proceed on their own schedule (they are synchronised with Commons by `ensureUKRegionalCouncilElections`, so they will realign on the next regular Commons cycle).
- **Other office types** (governor, mayor, etc.). Untouched.

## Extension

Adding a new parliamentary country requires only three config changes:

1. `COUNTRY_CONFIGS[X].snapElectionsAllowed = true`.
2. `COUNTRY_CONFIGS[X].legislature.lowerChamber.key = "<key>"`.
3. A matching `snap_<key>` entry in `DEFAULT_DURATIONS` (`src/lib/turn/perpetualElections.ts`) - or rely on the `snap_lowerChamber` fallback.

No new code paths are required. Labels, schemas, and admin tooling will display the raw `snap_<key>` string by default; add the country's snap type to `ELECTION_TYPE_LABEL_MAP`, `MULTI_SEAT_TYPES`, the admin Zod enum, and `electionsAdminTypes.ts` when you want pretty display.

## Related systems

- [`parliamentary-government.md`](parliamentary-government.md) - PM appointment votes, no-confidence votes, coalition formation.
- [`elections.md`](elections.md) - election lifecycle and resolution.
- [`turn-processing.md`](turn-processing.md) - phase ordering; the vacancy watcher runs in Group 7/8 after regular government vote phases.
- [`united-kingdom.md`](united-kingdom.md), [`japan.md`](japan.md) - country-specific governance.
