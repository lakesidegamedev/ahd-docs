# Snap Elections

Technical design for snap elections in parliamentary countries. Scope: dissolution of the lower chamber before its regular term ends, either by the sitting head of government, automatically when one cannot be seated within a bounded window, or by an imposed regime change.

Player guide: [Snap Elections](https://www.ahousedividedgame.com/wiki/snap-elections)

Presidential countries such as the US are unaffected. Germany is a parliamentary republic with both confidence and snap-election mechanisms and uses the shared path.

## Real-world grounding

**United Kingdom (post-2022).** The 2011 Fixed-term Parliaments Act, which imposed a 14-day window after a successful no-confidence vote for an alternative government to form before an election was called, was repealed by the Dissolution and Calling of Parliament Act 2022. Today a PM may request dissolution from the monarch at any time; by convention they do so either after losing the confidence of the Commons or to capitalise on a favourable political moment. A successful no-confidence vote is politically binding but does not legally trigger an election on its own.

**Japan (Article 69).** If the Shugiin passes a no-confidence resolution (or fails to pass a government-backed confidence motion), the Cabinet must within ten days either resign en masse or dissolve the Shugiin. Historically dissolution has been the more common response (Ohira 1980, Miyazawa 1993, Mori 2000 abstained, Abe 2014 preemptively dissolved).

The game captures both traditions through a single mechanic: any PM vacancy, however it arises, starts a 96-turn clock (96 real-time hours, about 2 game years). If no new PM is seated before the clock expires, the lower chamber is automatically dissolved and a fresh election is called. Sitting PMs can also trigger a snap election voluntarily, up to 2 per appointment, gated by a 336-turn cooldown.

## Rules

| Rule | Constant | Value | Source |
| --- | --- | --- | --- |
| Voluntary snaps per appointment | `SNAP_ELECTION_LIMIT` | 2 | `src/lib/turn/snapElection.ts` |
| Cooldown between snaps | `SNAP_ELECTION_COOLDOWN_TURNS` | 336 turns (2 real-time weeks) | `src/lib/turn/snapElection.ts` |
| PM vacancy deadline | `PM_VACANCY_DEADLINE_TURNS` | 96 turns (4 real-time days) | `src/lib/constants/turnTime.ts` |
| Snap election length | `DEFAULT_DURATIONS.snap_commons`, `snap_shugiin`, `snap_bundestag`, `snap_lowerChamber` | 48 turns: 24 primary plus 24 general | `src/lib/constants/electionDurations.ts` |
| UK Commons regular cycle | `UK_COMMONS_CYCLE_PERIOD_HOURS` | 240 turns (5 game years) | `src/lib/constants/turnTime.ts` |
| JP Shugiin regular cycle | `shugiin.durationHours` | 192 turns (4 game years) | `src/lib/constants/electionDurations.ts` |
| DE Bundestag regular cycle | `DE_BUNDESTAG_CYCLE_PERIOD_HOURS` | 192 turns | `src/lib/elections/canonicalCycle.ts` |

### Eligibility

A country can hold snap elections when `supportsSnapElections(config)` is true. That is the regime-type default (parliamentary systems `true`, presidential and one-party `false`), overridable by `COUNTRY_CONFIGS[countryId].snapElectionsAllowed` (`src/lib/constants/countries.ts`), and the country must have a `legislature.lowerChamber.key`. Snap type is `snap_${lowerChamberKey}`.

| Country | Snap allowed | `lowerChamber.key` | Snap election type |
| --- | --- | --- | --- |
| UK | yes | `commons` | `snap_commons` |
| JP | yes | `shugiin` | `snap_shugiin` |
| DE | yes | `bundestag` | `snap_bundestag` |
| US | no | `house` | n/a |

This table is illustrative, not exhaustive. Ireland, Scotland, Wales, and several beta parliamentary countries also opt in through country config.

Upper chambers (UK Lords, JP Sangiin) are explicitly excluded. Sangiin's `snapElectionsAllowed: false` is a hard gate, and Lords are not elected.

### Reasons

`triggerSnapElection` (`src/lib/turn/snapElection.ts`) takes one of four reasons.

| Reason | Who | Limits and cooldown | Spends the PM's allowance |
| --- | --- | --- | --- |
| `pm-trigger` | sitting PM | enforced | yes |
| `auto-snap` | the vacancy watcher | bypassed | counter still increments |
| `admin` | admin tools | bypassed | counter still increments |
| `regime-change` | a peace settlement | bypassed, and clears the parliamentary-only check | no (`snapElectionsUsed` untouched), marked `imposedSnap` so the calendar is not shifted |

### Player trigger: `POST /api/country/[code]/pm/snap-election`

Route: `src/app/api/country/[code]/pm/snap-election/route.ts`, command `triggerPrimeMinisterSnapElection` in `src/lib/government/commands/parliamentaryGovernment.ts`. Only the sitting PM (matched by `governmentFormations.pmCharacterId`) may call it.

**Gates:**

- The country supports snap elections (`assertSnapElectionsAllowed`).
- `governmentFormations.status === "formed"`.
- `snapElectionsUsed < 2` per appointment. The counter and `lastSnapElectionTurn` reset when a new PM is seated.
- `currentTurn - lastSnapElectionTurn >= 336` when a prior snap was called under the current appointment.
- No active vote of no confidence (`noConfidenceVotes` with `status: "active"`). A PM cannot preempt a pending VONC. Admin and auto-snap bypass this.
- UK only: no active post-Commons-election confidence motion. A sitting PM cannot call a snap while a `pmAppointmentVotes` document with `isConfidenceMotion: true` and `status: "active"` is pending. This check applies to the `pm-trigger` reason and is independent of the limit bypass.

**Effects (on success, in order):**

1. All active or upcoming regular lower-chamber elections for the country, plus live by-elections for that chamber, are set to `status: "cancelled"`, and their active candidacies are withdrawn so those characters can be slated into the snap races.
2. **In-progress bills whose `currentChamber` is the lower chamber** (`proposed`, `active`, `passed_origin`, `active_other`, `override_shugiin`, `veto_override`, `vetoed`) are set to `status: "failed"` (`failInProgressBills`). Bills in the upper chamber (Lords, Sangiin), in JP `cabinet_review`, or `enrolled` are preserved.
3. One `snap_${lowerChamberKey}` election is spawned per region (active status, primary opens immediately, 48-turn window: 24 primary plus 24 general). Cycle number continues from the most recent regular-or-snap election in the region.
4. Every lower-chamber mandate ends at once: electedOfficials for that office are deleted, characters and NPPs have `currentOffice` cleared (`vacateDissolvedLowerChamber`).
5. `governmentFormations.snapElectionsUsed` is incremented (except `regime-change`) and `lastSnapElectionTurn` is set to `currentTurn`.
6. **The sitting Prime Minister is vacated** via `unformGovernmentAndVacatePM`: `pmCharacterId` and `pmName` cleared, cabinet cleared, `currentOffice` cleared on the character and NPP docs, government status transitions to `pending`, and the 96-turn PM-vacancy clock is re-armed.
7. Government cycle and seat counters are updated via `resetParliamentaryGovernmentAfterElection`.
8. A Discord game event is emitted (worded differently for auto-snap and imposed snaps). For auto-snaps the stamp write is an atomic claim, so concurrent attempts announce once.

**Worked example.** A UK PM is seated at turn 1,000 with 0 snaps used. At turn 1,100 they call a snap: elections open (turns 1,100 to 1,148), the lower house is vacated, the PM is vacated, `snapElectionsUsed` becomes 1 and the vacancy deadline is turn 1,196. If a new PM is seated before turn 1,196, counters reset to 0 and the new PM may call a snap straight away, subject only to the VONC and confidence-motion gates. If nobody is seated by turn 1,196, an auto-snap fires and re-arms the clock to turn 1,292.

### Dissolution slate-clearing

When a lower-chamber general election resolves (regular or snap) in any country with a configured `lowerChamber.key`, the turn processor invokes two helpers in `runPostElectionGovernmentPhases` (`src/lib/turn/countryPhases.ts`):

- `failInProgressBills(db, countryId, now)`: fails every bill whose `currentChamber === lowerChamberKey` and whose status is one of the statuses listed above. Bills in the upper chamber, in JP `cabinet_review`, or `enrolled` are preserved.
- `cancelActiveNoConfidenceVotes(db, countryId, now)`: cancels every active VONC for the country. No-op for countries that do not use VONC (for example the US).

For parliamentary countries, the existing `resetParliamentaryGovernmentAfterElection` call still runs after these helpers. This fires for any configured lower-chamber election and its snap type, so adding a country with a configured `legislature.lowerChamber.key` unlocks the behaviour automatically.

### Auto-trigger: 96-turn PM vacancy deadline

When `governmentFormations.status` transitions into `pending`, regardless of cause (post-election reset, no-confidence pass, admin PM vacate, snap), `pmVacancyDeadlineTurn = currentTurn + 96` (`PM_VACANCY_DEADLINE_TURNS`, set in `src/lib/turn/parliamentaryGovernment.ts` and `src/lib/government/commands/appointments.ts`).

`processPMVacancyDeadlines` (`src/lib/turn/pmVacancyDeadline.ts`), called by `runParliamentaryVacancyWatcher` (`src/lib/turn/countryPhases.ts`, phase name `parliamentaryVacancyWatcher`), runs once per turn after the regular parliamentary government phases. For each registered parliamentary country with:

- `supportsSnapElections(config)`, and
- `status === "pending"`, and
- `pmVacancyDeadlineTurn != null` and `currentTurn >= pmVacancyDeadlineTurn`

the watcher invokes `triggerSnapElection(db, countryId, now, { reason: "auto-snap", bypassLimits: true })`. Because the snap calls `resetParliamentaryGovernmentAfterElection`, the deadline is re-set to `currentTurn + 96`, giving the post-snap period another full window before a second auto-snap could fire. A failure is logged and does not stop other countries.

The deadline is cleared (set to `null`) when a PM appointment vote passes (`processParliamentaryGovernmentVotes`), when an admin appoints a PM (`/api/admin/uk/government/appoint-pm`), or when `appointPrimeMinister` or NPP PM seating (`src/lib/nppAutonomy/appointNppPrimeMinister.ts`) is called with a non-null character id.

**Why this replaces a direct "no-confidence to snap" rule.** A successful no-confidence vote already transitions the government into `pending`, which is the exact trigger the deadline watches for. Folding NC into the general vacancy clock removes a special case: the game does not need to distinguish "snap because of NC" from "snap because a coalition fell apart" from "snap because no party can form a majority." The 96-turn window honours both the UK post-FTPA convention (14-day alternative-government attempt, scaled) and JP Article 69 (10-day resign-or-dissolve, scaled).

### Cycle reset after a snap

Snap elections shift the entire LARP schedule forward. The next regular lower-chamber election is anchored to the snap's end turn, not to the original bootstrap.

| Country | Cycle period | Next regular election's end turn |
| --- | --- | --- |
| UK Commons | 240 turns (5 game years) | `snap.endTurn + 240` |
| JP Shugiin | 192 turns (4 game years) | `snap.endTurn + 192` |
| DE Bundestag | 192 turns (4 game years) | `snap.endTurn + 192` |

The cycle counter continues incrementing: a snap that resolves at cycle `N` is followed by a regular cycle `N + 1` whose end turn sits one cycle period after the snap's end turn. An imposed snap (`imposedSnap: true`) is the exception and leaves the calendar on its canonical dates (`src/lib/elections/snapShift.ts`).

**Implementation.**

- `ensureUKElections` and `ensureJPElections` query both the regular and snap types when determining the most recent completed election per region. When the most recent is a snap, the cycle-gap check uses the snap's end time plus the cycle period before permitting a new regular election to spawn, and the regular election's `durationHours` is always the regular cycle duration, never inherited from the snap's 48 turns.
- `canonicalTurns` in `src/lib/elections/canonicalCycle.ts` accepts an optional `priorEndTurn`. For `commons`, `shugiin` and `bundestag`, when a prior (regular-or-snap) election exists for the same region, the anchor is `priorEndTurn + cyclePeriod` instead of the bootstrap-derived default. Snap types themselves have no canonical anchor and return `null`. The admin UI mirrors the same rule in `canonicalEndTurn`.

## Timing

- **Player trigger:** immediate, inside the request. Nothing waits for a turn; elections, bills and the PM change in one write sequence.
- **Auto-snap:** `parliamentaryVacancyWatcher` runs once per turn, after `runParliamentaryGovernmentPhases`, so a PM seated this turn has their deadline cleared before the watcher checks.
- **Slate clearing:** runs in `runPostElectionGovernmentPhases` when a lower-chamber general election resolves, before `resetParliamentaryGovernmentAfterElection`.
- **Snap resolution:** the 48-turn snap race resolves through the regular election phases, then the post-election government formation process starts (for the UK, with a confidence motion on the new PM).

For the surrounding phase ordering see [`turn-processing.md`](./turn-processing.md).

## Edge cases and limits

- **Upper chambers** (UK Lords, JP Sangiin) are never cancelled, re-spawned or dissolved. Their bills survive.
- **Regional councils and sub-national offices.** A snap cancels only the lower-chamber regular races matching the country's `lowerChamber.key` and its by-elections. UK Regional Council elections proceed on their own schedule (synchronised with Commons by `ensureUKRegionalCouncilElections`, so they realign on the next regular Commons cycle).
- **Other office types** (governor, mayor, and so on) are untouched.
- **No regions configured:** the snap throws before cancelling anything, so a country is never left without a lower chamber.
- **Limit reached or cooldown running:** the request returns an error with the turns remaining. Auto-snaps and admin snaps ignore both.
- **Auto-snap loop:** an auto-snap re-arms the clock, so a country that never seats a PM gets a snap every 96 turns.
- **Sitting PM from a previous parliament:** counters live on the appointment, and resetting on each new seat means a newly seated PM starts at 0 of 2 with no cooldown. A PM who passes a post-election confidence motion keeps their counters (the reset is skipped for confidence motions).
- **Imposed snaps** do not spend the PM's allowance and do not shift the calendar.

## Extension

Adding a new parliamentary country requires only three config changes:

1. `COUNTRY_CONFIGS[X].snapElectionsAllowed = true` (or a parliamentary regime type that defaults to it).
2. `COUNTRY_CONFIGS[X].legislature.lowerChamber.key = "<key>"`.
3. A matching `snap_<key>` entry in `DEFAULT_DURATIONS` (`src/lib/constants/electionDurations.ts`), or rely on the `snap_lowerChamber` fallback.

No new code paths are required. Labels, schemas and admin tooling display the raw `snap_<key>` string by default; add the country's snap type to `ELECTION_TYPE_LABEL_MAP`, `MULTI_SEAT_TYPES`, the admin Zod enum and `electionsAdminTypes.ts` when you want pretty display.

## Connections

**Driven by**
- [Parliamentary government](./parliamentary-government.md): a PM vacancy sets the deadline (`parliamentaryGovernment.ts`); no-confidence passes and appointment votes arm and clear it.
- Peace settlements: an imposed regime change calls `triggerSnapElection` with the `regime-change` reason.
- Country config: `snapElectionsAllowed` and the lower chamber key decide eligibility.

**Affects**
- [Elections](./elections.md): cancels regular lower-chamber races, spawns `snap_<key>` races and shifts the next regular cycle (`canonicalCycle.ts`).
- [Bills and legislation](./bills-legislation.md): lower-chamber bills fail (`failInProgressBills`).
- [Parliamentary government](./parliamentary-government.md): the PM and cabinet are vacated, active VONCs are cancelled, and the government returns to `pending`.
- [United Kingdom](./united-kingdom.md) and [Japan](./japan.md): country-specific governance, including the UK confidence-motion gate.

Last checked: 2026-10-29, version 1.18.0
