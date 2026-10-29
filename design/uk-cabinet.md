# UK Cabinet System

## Summary

The Prime Minister appoints and dismisses cabinet ministers directly, with no confirmation vote. Ministers must be player-controlled MPs holding a Commons seat; the governing party or coalition is not a requirement. Each appointment locks the seat for 24 turns, a PM can reshuffle the whole cabinet once per parliament per government, and firing or resignations damage the government's confidence gauge.

Player guide: [Cabinet Guide](https://www.ahousedividedgame.com/wiki/cabinet-guide). The general mechanic is also covered in [Cabinet](https://www.ahousedividedgame.com/wiki/cabinet), and the country page is [United Kingdom](https://www.ahousedividedgame.com/wiki/uk-overview). The wider cabinet design is [Cabinet](./cabinet.md).

**Location:** `src/lib/countries/uk/` (`src/lib/uk/` holds forwarders to it)

**Key files:**

- `src/lib/countries/uk/cabinetApi.ts` - API route handlers for appointments, firing, resignation and reshuffle
- `src/lib/countries/uk/cabinetWhipApi.ts` - whip withdrawal and restoration
- `src/lib/countries/uk/cabinetEligibility.ts` - eligibility rules and queries (`requireCurrentPrimeMinister`)
- `src/lib/countries/uk/dualMinistry/rules.ts` - one-department-plus-one-central-title rule
- `src/lib/countries/uk/cabinet/reshuffleLimit.ts` - once-per-parliament reshuffle limiter
- `src/lib/countries/uk/confidence/confidenceGauge.ts` and `confidenceGaugeStore.ts` - confidence hits from firing and resignations
- `src/lib/countries/uk/cabinet/positions.ts` - cabinet position definitions (`src/lib/constants/ukCabinet.ts` forwards to it)
- `src/lib/turn/parliamentaryGovernment.ts` - shared government formation and PM appointment

## Rules

### Cabinet positions

Cabinet positions are defined in `UK_CABINET_POSITIONS` (`src/lib/countries/uk/cabinet/positions.ts`), 20 entries in file order (`agriculture_secretary` and `environment_secretary` share `order: 12` because their eras are disjoint: agriculture retires in 2001 and hands off to environment via `succeededBy`):

| Order | Position ID                | Name (base)                                                                                      | Year Enabled |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------------ | ------------ |
| 0     | `deputy_prime_minister`    | Deputy Prime Minister                                                                            | 1775         |
| 1     | `first_secretary_of_state` | First Secretary of State                                                                         | 1962         |
| 2     | `chancellor`               | Chancellor of the Exchequer                                                                      | 1775         |
| 3     | `foreign_secretary`        | Foreign Secretary                                                                                | 1775         |
| 4     | `home_secretary`           | Home Secretary                                                                                   | 1775         |
| 5     | `defence_secretary`        | Secretary of State for Defence                                                                   | 1775         |
| 6     | `justice_secretary`        | Lord Chancellor & Secretary of State for Justice                                                 | 1775         |
| 7     | `health_secretary`         | Secretary of State for Health and Social Care                                                    | 1775         |
| 8     | `education_secretary`      | Secretary of State for Education                                                                 | 1775         |
| 9     | `business_secretary`       | Secretary of State for Business, Energy and Industrial Strategy                                  | 1775         |
| 10    | `levelling_secretary`      | Secretary of State for Housing, Communities and Local Government                                 | 1775         |
| 11    | `transport_secretary`      | Secretary of State for Transport                                                                 | 1775         |
| 12    | `agriculture_secretary`    | Minister of Agriculture, Fisheries and Food (retires 2001, succeeded by `environment_secretary`) | 1775         |
| 12    | `environment_secretary`    | Secretary of State for Environment, Food and Rural Affairs                                       | 2001         |
| 13    | `work_secretary`           | Secretary of State for Work and Pensions                                                         | 1775         |
| 14    | `northern_ireland`         | Secretary of State for Northern Ireland                                                          | 1972         |
| 15    | `scotland`                 | Secretary of State for Scotland                                                                  | 1775         |
| 16    | `wales`                    | Secretary of State for Wales                                                                     | 1964         |
| 17    | `director_of_intelligence` | Chief of the Secret Intelligence Service                                                         | 1909         |
| 18    | `chief_whip`               | Parliamentary Secretary to the Treasury (Chief Whip; "Government Chief Whip" before 1830)        | 1775         |

Each seat's display name can also change over time within its era (`namesByYear`, resolved against the live game year, e.g. `defence_secretary` reads "Secretary of State for War" before 1964). The base names above are the seat's identity, not necessarily the label shown at every year.

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| Seat lock after appointment (`COOLDOWN_TURNS`) | 24 turns | `src/lib/countries/uk/cabinetApi.ts` |
| Confidence hit, minister fired (`CONFIDENCE_HITS.ministerFired`) | 8 | `src/lib/countries/uk/confidence/confidenceGauge.ts` |
| Confidence hit, minister resigned (`CONFIDENCE_HITS.ministerResigned`) | 12 | same |
| Great Office multiplier (`GREAT_OFFICE_MULTIPLIER`) | 2 | same |
| Great Offices (`GREAT_OFFICE_POSITION_IDS`) | `chancellor`, `foreign_secretary`, `home_secretary` | same |
| Confidence range and start | 0 to 100, start 100 | `CONFIDENCE_MIN`, `CONFIDENCE_MAX`, `CONFIDENCE_START` in the same file |
| Central titles (`UK_CENTRAL_POSITION_IDS`) | `deputy_prime_minister`, `first_secretary_of_state` | `src/lib/countries/uk/dualMinistry/rules.ts` |
| Reshuffles allowed | 1 per parliament per government | `src/lib/countries/uk/cabinet/reshuffleLimit.ts` |

### Eligibility rules

#### Prime Minister authorization

Only the current Prime Minister can appoint or dismiss cabinet ministers. This check is enforced by `requireCurrentPrimeMinister` in `src/lib/countries/uk/cabinetEligibility.ts`, which reads the canonical `governmentFormations` document (the legacy `parliamentaryGovernments` document is consulted only when the canonical one is missing entirely). Despite its location, the guard is country-agnostic and is used by other parliamentary cabinets as well.

#### Minister eligibility

To be eligible for cabinet appointment:

1. **Must be a player-controlled character holding a Commons seat**. Lords and NPPs are not eligible through this flow.
2. **At most two seats, one of each kind** (`canHoldAdditionalAppointment`, `src/lib/countries/uk/dualMinistry/rules.ts`). A minister may hold one departmental portfolio plus one central title (`deputy_prime_minister` or `first_secretary_of_state`). Two departments, both central titles, or a third seat are rejected. The unique index on `(countryId, characterId, roleSlot)` backs this up. Both seats draw on one shared action pool, so a second title does not add actions (`reconcileUkSharedPool`).
3. **Cannot be the Prime Minister**. The PM cannot appoint themselves to an additional position.
4. **Party is not a gate**. The PM may appoint any otherwise eligible Commons player, including an opposition MP.
5. **Whip must not be withdrawn.** An MP serving a whip withdrawal sits as an independent and cannot be appointed until the whip is restored (`whipWithdrawn` on `electedOfficials`).
6. **Cannot hold an incompatible office.** A central bank role must be left before joining cabinet.
7. **Era gate.** The seat must be active in the live game year (`isSeatActive`: `yearEnabled` to `yearRetired`, `src/lib/cabinet/rosterEra.ts`).

### Appointment flow

#### 1. View eligible characters

```typescript
GET /api/country/uk/executive/cabinet/characters

Response:
{
  success: true,
  characters: Character[]  // Eligible for appointment
}
```

#### 2. Appoint minister

```typescript
POST /api/country/uk/executive/cabinet/appoint
Body: { positionId: string, characterId: string }

Authorization: requireAuth() + requireCurrentPrimeMinister(db, countryId, userId)

Checks:
1. Position exists in UK_CABINET_POSITIONS and is active in the live game year
2. Position is not the head-of-government seat
3. Character exists, is a player character, and is not holding a central bank role
4. Character holds a Commons seat and does not have the whip withdrawn
5. Character is not PM
6. Position is not already filled
7. Position is not on cooldown
8. Character passes the dual-ministry slot rule (see above)

Effects:
1. Insert record into `cabinetMembers` (shared collection, `countryId: "UK"`)
2. Add career history entry and set the character's `currentOffice` to the cabinet seat
3. Write the 24-turn seat lock to `ukCabinetCooldowns`
4. Clear the predecessor's per-seat setting cooldowns
5. Reset advocacy toggle for territorial secretaries (NI, Scotland, Wales)
6. Reconcile the shared action pool for a holder with two seats
```

#### 3. Dismiss minister

```typescript
POST /api/country/uk/executive/cabinet/fire
Body: { positionId: string }

Authorization: requireAuth() + requireCurrentPrimeMinister(db, countryId, userId)

Checks:
1. Position exists
2. Position is currently filled

Effects:
1. Delete record from `cabinetMembers` (shared collection)
2. The appointment-time seat lock remains in `ukCabinetCooldowns`
3. The minister's `currentOffice` is restored to their Commons seat (or kept on their surviving second cabinet seat)
4. The confidence gauge takes a `ministerFired` hit
```

#### Other cabinet routes

Under `/api/country/[code]/executive/cabinet/` (`src/app/api/country/[code]/executive/cabinet/`), parliamentary countries also expose `reshuffle` and `resign` (POST, handled in `cabinetApi.ts`), `acting` (POST, a President installs an acting member without confirmation), and `whip`, `whip/withdraw` and `whip/restore` (PM-only party whip withdrawal and restoration, `cabinetWhipApi.ts`). Per-seat office actions live under `[positionId]/...`.

### Cooldown

Each appointment starts a 24-turn seat lock (`COOLDOWN_TURNS` in `cabinetApi.ts`). The lock survives a firing, so the PM cannot immediately refill a seat by cycling ministers. Firing itself is unrestricted.

```typescript
const COOLDOWN_TURNS = 24;
// Locked for COOLDOWN_TURNS turns from this appointment, keyed to the turn
// number so it tracks game time regardless of wall-clock drift. The wall-clock
// `cooldownUntil` is a display mirror only.
await getUKCabinetCooldownsCollection(db).updateOne(
  { countryId, positionId },
  {
    $set: {
      countryId,
      positionId,
      appointedCharacterId: targetChar._id,
      appointedByPmCharacterId: pmCharacter._id,
      appointedAt: now,
      cooldownUntil: new Date(now.getTime() + COOLDOWN_TURNS * turnLengthMinutes * 60_000),
      cooldownUntilTurn: appointTurn + COOLDOWN_TURNS,
    },
  },
  { upsert: true },
);
```

**Purpose:** Prevents rapid hire/fire/re-hire cycles within the same cabinet seat.

### Advocacy toggle

Territorial secretaries (Northern Ireland, Scotland, Wales) have an advocacy toggle that can be activated to advocate for their region. This toggle is **automatically reset** when a new minister is appointed:

```typescript
if (["northern_ireland", "scotland", "wales"].includes(positionId)) {
  await getCabinetSettingsCollection(db).updateOne(
    { _id: `UK_${positionId}` },
    { $set: { advocacyActive: false, updatedAt: new Date() } },
  );
}
```

### Reshuffle

The PM can replace the entire cabinet in one action (`reshuffleCabinetHandler`, body `appointments` with at least one entry, no duplicate positions). The limiter keys on `(governmentId, parliamentId)` from `getReshuffleIdentity`: `parliamentId` follows `cycle` (increments after every lower-chamber election) and `governmentId` follows the seated PM plus when they were seated. The spent token is stored as `reshuffleLog` on the `governmentFormations` document and written with a guard so two concurrent reshuffles cannot both succeed. Per-seat locks are not checked, but incoming ministers get fresh locks, and a reshuffle emits no confidence hit. A caretaker-held seat must be dismissed first.

## Data

| Collection | Role | Player-visible |
| --- | --- | --- |
| `cabinetMembers` | Current cabinet ministers (shared across countries, filtered by `countryId: "UK"`). Written on appoint, fire, resign, reshuffle and transition | Yes |
| `ukCabinetCooldowns` | Seat locks: `countryId`, `positionId`, `appointedCharacterId`, `appointedByPmCharacterId`, `appointedAt`, `cooldownUntil` (display mirror), `cooldownUntilTurn` (authoritative). Written on appoint and reshuffle | Yes, as the "can be reappointed in N turns" message |
| `cabinetSettings` | Per-position settings; `_id` is `UK_{positionId}`, field `advocacyActive` | Yes |
| `governmentFormations` | Read for the PM; `reshuffleLog`, `cycle`, `formedTurn` used by the reshuffle limit; confidence gauge and history | Partly |
| `characters` | `currentOffice` and `careerHistory` updated on appointment and on clearing | Yes |
| `electedOfficials` | Commons seat verification and `whipWithdrawn` | Yes |

```typescript
// Shared cabinetMembers doc shape, filtered by countryId: "UK" for this system.
interface CabinetMember {
  _id: ObjectId;
  countryId: string;
  positionId: string;
  characterId: ObjectId;
  roleSlot?: "departmental" | "central"; // UK only
  characterName: string;
  party: string;
  appointedByCharacterId: ObjectId;
  appointedAt: Date;
  confirmedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

Cabinet appointments add a `careerHistory` entry of type `appointed` with office `{ type: "ukCabinet", positionId }` (other parliamentary countries use `parliamentaryCabinet`).

Error responses:

| Status | Condition                                                            |
| ------ | -------------------------------------------------------------------- |
| 401    | Not authenticated                                                    |
| 403    | Not PM, ineligible character, already holds position, not in Commons |
| 404    | Character or position not found                                      |
| 409    | Position already filled, on cooldown                                 |

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| Roster, `yearEnabled`, `yearRetired`, `namesByYear`, `succeededBy` | Authored table above | `src/lib/countries/uk/cabinet/positions.ts` |
| Seat lock length | 24 turns | `COOLDOWN_TURNS` in `cabinetApi.ts` (a code constant, not in `gameConfig`) |
| Wall-clock lock mirror | `COOLDOWN_TURNS` x turn length in minutes | `loadTurnLengthMinutes(db)` in `cabinetApi.ts` |
| Confidence hits and multiplier | 8, 12, x2 for Great Offices | `confidenceGauge.ts` |
| Gauge-driven dissolution | Off; on only when the environment variable `UK_CONFIDENCE_GAUGE_DISSOLUTION` is `"1"` | `isConfidenceDissolutionEnabled` in `confidenceGaugeStore.ts` |
| `gameState.manuallyEnabledSeats` | Empty | read by `getManuallyEnabledSeats`; can enable department seats created by legislation |
| Era | Seat presence follows the live game year | `isSeatActive` in `src/lib/cabinet/rosterEra.ts` |

No feature flag gates the UK cabinet itself.

## Timing

Cabinet changes are player actions through the API, not a turn phase, so appointments and firings take effect immediately. The turn pipeline only touches the cabinet in these places:

1. **Government transition.** Whenever `unformGovernmentAndVacatePM` runs (no-confidence passed, snap election, post-election reset, PM lost their seat), `clearCabinetOnTransition` (`src/lib/cabinetTransition.ts`) deletes the country's `cabinetMembers`, withdraws live nominations, deletes `cabinetSettings` and deactivates active `ministerialOrders`, restoring each player holder's Commons office. The paired `ukCabinetCooldowns` delete happens in `src/lib/turn/parliamentaryGovernment.ts` at the same transitions. This happens in the `parliamentaryGovernmentPhases` phase or inside the snap-election trigger, before the vacancy watcher runs.
2. **Seat lock expiry.** The lock is compared against the current turn on the next appointment attempt. No phase clears it.
3. **Era change.** A seat is available only while `yearEnabled <= live year < yearRetired`, and its display name follows `namesByYear`.

## Worked trace

Turn 100, modern era, PM is a player, the Chancellor seat is empty and the turn length is 60 minutes.

1. The PM posts `positionId: chancellor`, `characterId` of an opposition MP who holds a Commons seat, is not the PM, has no whip withdrawal, and holds no other cabinet seat. `requireCurrentPrimeMinister` passes; `chancellor` is departmental (`roleSlotForPosition`), so the dual-ministry rule passes.
2. A `cabinetMembers` row is inserted with `roleSlot: departmental`. `ukCabinetCooldowns` gets `cooldownUntilTurn = 100 + 24 = 124` and `cooldownUntil = now + 24 x 60 x 60,000 ms`, which is 24 hours. The minister's `careerHistory` gains an `appointed` event.
3. Turn 110: the PM fires the Chancellor. The row in `cabinetMembers` is deleted; the lock stays at 124. `chancellor` is in `GREAT_OFFICE_POSITION_IDS`, so the hit is `8 x 2 = 16`. From a gauge of 100 that leaves 84 (before any turn-by-turn drift). Had the minister resigned instead, the hit would be `12 x 2 = 24`, leaving 76.
4. Turn 112: the PM tries to name a new Chancellor. The check is `cooldownUntilTurn > currentTurn` (124 > 112), so the call fails with 409, "can be reappointed in 12 turns". Appointing the same person to a different seat works immediately, because the lock is per seat.
5. Turn 124: the lock no longer blocks (124 > 124 is false); the appointment goes through.
6. A passed no-confidence vote at turn 150 runs `unformGovernmentAndVacatePM`: the cabinet and every lock are deleted, and the new PM starts with an empty cabinet.

## Edge cases and limits

- **PM change clears everything.** A new government starts with an empty cabinet and no seat locks. Both the cabinet rows and the 24-turn locks are deleted, so the first appointments of a new PM are never blocked by the old government's locks.
- **Fired or resigned minister.** Their `currentOffice` returns to their Commons seat. If they hold a second cabinet seat it stays, and `currentOffice` repoints to it. If they hold no seat they become private citizens.
- **Seat lock outlives the minister.** Firing never removes the lock. It is set at appointment and only a government transition clears it.
- **Reshuffle.** A bulk reshuffle skips the per-seat locks, is limited to one use per parliament per government (`canReshuffle`, `src/lib/countries/uk/cabinet/reshuffleLimit.ts`), still sets fresh locks on incoming ministers, and emits no confidence hit.
- **Confidence cost.** Firing applies `ministerFired = 8` to the confidence gauge, and a resignation applies `ministerResigned = 12`. A Great Office of State (chancellor, foreign_secretary, home_secretary) doubles the hit (`GREAT_OFFICE_MULTIPLIER = 2`). The gauge is recorded, but reaching 0 does not dissolve the government unless `UK_CONFIDENCE_GAUGE_DISSOLUTION` is `"1"`, which is not the default.
- **NPP-held seats.** An NPP-held seat has a null `characterId`. It is skipped by office restoration and by reshuffles; NPP resignations are decided by the turn runner (`src/lib/countries/uk/cabinet/nppResignation.ts`).
- **Lords and NPPs** cannot be appointed through this flow.
- **Head of government.** Seats flagged `isHeadOfGovernment` cannot be appointed or fired through cabinet routes. The PM leaves only through no-confidence, a snap election, or resignation.
- **Retired seats.** `agriculture_secretary` stops being fillable in 2001 and `environment_secretary` takes over. Both share `order: 12`.
- **Territorial secretaries.** The advocacy toggle resets on every new appointment to Northern Ireland, Scotland or Wales.
- **Regular election with a sitting PM.** The cabinet stays and the incumbent faces a confidence motion; only a vacated PM clears it.

## Invariants

- Only the current PM acts: `requireCurrentPrimeMinister`. Not covered by a dedicated test in `cabinetEligibility.test.ts`; exercised indirectly through the handler tests.
- One departmental seat plus at most one central title per minister: `src/lib/uk/dualMinistry/rules.test.ts` and the "rejects a second departmental portfolio" and "rejects both central titles" cases in `cabinetApi.test.ts`; backed at runtime by the unique `(countryId, characterId, roleSlot)` index.
- One holder per seat: the 409 "already filled" check plus the unique index; the "lost fire/resignation race reports 404" case covers the race.
- The seat lock persists through firing and is not set by firing: `cabinetApi.test.ts` ("sets a 24-turn appointment cooldown ... lock persists through firing", "does NOT set an appointment cooldown when firing").
- One reshuffle per parliament per government: `src/lib/countries/uk/cabinet/reshuffleLimit.test.ts` and `src/lib/uk/cabinetApi.reshuffle.test.ts`; the write is guarded against concurrent reshuffles.
- Confidence stays inside 0 to 100: `confidenceGauge.test.ts` ("never exceeds the ceiling or floor").
- Not enforced: that `ukCabinetCooldowns` rows never outlive a government in every path (they are cleared at the transitions listed under Timing, with no periodic check).

## Failure and recovery

- **Stale or missing office on a former minister.** If a cleared or fired holder's `currentOffice` still points at a cabinet seat, the restore helper (`restoreCharacterOfficeAfterCabinet`) puts them back on their Commons seat; a data heal can re-run it for stragglers.
- **Cabinet survived a government change.** A heal that runs `clearCabinetOnTransition` for the country, then clears `ukCabinetCooldowns`, repairs it.
- **Lost fire or resign race.** The loser gets a 404 and nothing is written, so no repair is needed.
- **Reshuffle conflict.** A conflicting reshuffle is refused with a refresh-and-retry message; the token is only spent by the write that wins.
- **Stuck seat lock.** The lock is turn-keyed, so it expires by itself; a data edit to `cooldownUntilTurn` can clear it early if a lock was written wrongly.

## Connections

**Driven by:**

- [UK PM No Confidence](./uk-pm-no-confidence.md): a passed motion reaches the cabinet through `unformGovernmentAndVacatePM` and `clearCabinetOnTransition` in `src/lib/turn/parliamentaryGovernment.ts`.
- [UK Elections](./uk-elections.md): the Commons result decides who is an eligible MP (`electedOfficials`) and which party forms the government.
- [Parliamentary Government](./parliamentary-government.md): `requireCurrentPrimeMinister` reads `governmentFormations` to authorize every cabinet action.

**Affects:**

- [Cabinet](./cabinet.md): `cabinetMembers` is the shared roster that ministerial orders, office pages and action regeneration read.
- [UK Elections](./uk-elections.md): ministers keep their Commons seat, and appointment requires one. A snap election clears the cabinet because it vacates the PM; a regular election leaves it standing while the incumbent faces a confidence motion.
- Character career history and `currentOffice`: appointment writes `careerHistory` and the `ukCabinet` office that grants the NPI bonus in action refresh (`src/lib/countries/uk/cabinetApi.ts`).
- Government confidence: firing and resignation hit the UK confidence gauge (`applyConfidenceEventToGov`).

Related code: `src/lib/turn/parliamentaryGovernment.ts` (how the PM and government are formed), `src/lib/db/types/character.ts` (office type definitions), `src/lib/constants/countries.ts` (UK country configuration).

## Tests

- `src/lib/countries/uk/cabinetApi.test.ts`: seat lock set on appointment and kept through firing, lock blocks reappointment, no lock on firing, head-of-government refusal, era gate, dual-ministry cases, fire/resign race, Commons seat restoration with constituency.
- `src/lib/countries/uk/cabinetEligibility.test.ts`: eligibility scoped to the lower chamber and variants for other countries.
- `src/lib/countries/uk/cabinet/reshuffleLimit.test.ts` and `src/lib/uk/cabinetApi.reshuffle.test.ts`: reshuffle limiter and handler.
- `src/lib/uk/cabinetApi.resignWhip.test.ts`: resignation and whip behaviour.
- `src/lib/uk/dualMinistry/rules.test.ts`: dual-ministry rule.
- `src/lib/countries/uk/confidence/confidenceGauge.test.ts`: hits, Great Office multiplier, clamping, drift.
- `src/lib/cabinetTransition.test.ts`: clearing on transition.

Gaps: `requireCurrentPrimeMinister` has no dedicated test; the advocacy-toggle reset on appointment has no named test; the seat-lock clearing in `parliamentaryGovernment.ts` is not asserted from the cabinet side.

## Known issues and history

- `clearCabinetOnTransition` does not itself delete `ukCabinetCooldowns`; the lock deletion lives in `parliamentaryGovernment.ts` (and in country succession helpers). A transition path that calls only `clearCabinetOnTransition` would leave stale locks. No such path is known.
- The confidence gauge is recorded but dissolution is off by default (`UK_CONFIDENCE_GAUGE_DISSOLUTION`); its magnitudes are described in code comments as first-pass values to calibrate.
- The reshuffle limit and the confidence gauge come from the 2026-08 UK rework (epic #856), per code comments.

Last checked: 2026-10-29, version 1.18.0
