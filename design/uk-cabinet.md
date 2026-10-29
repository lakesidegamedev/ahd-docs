# UK Cabinet System

## Overview

The UK Cabinet System manages cabinet appointments for the United Kingdom government. The Prime Minister appoints and dismisses eligible player-controlled MPs. Cabinet eligibility is not restricted to the governing party or coalition.

Player guide: [Cabinet Guide](https://www.ahousedividedgame.com/wiki/cabinet-guide). The general mechanic is also covered in [Cabinet](https://www.ahousedividedgame.com/wiki/cabinet), and the country page is [United Kingdom](https://www.ahousedividedgame.com/wiki/uk-overview). The wider cabinet design is [Cabinet](./cabinet.md).

**Location:** `src/lib/countries/uk/` (`src/lib/uk/` holds forwarders to it)

**Key files:**

- `src/lib/countries/uk/cabinetApi.ts` - API route handlers for appointments
- `src/lib/countries/uk/cabinetEligibility.ts` - Eligibility rules and queries
- `src/lib/countries/uk/dualMinistry/rules.ts` - one-department-plus-one-central-title rule
- `src/lib/countries/uk/confidence/confidenceGauge.ts` - confidence hits from firing and resignations
- `src/lib/countries/uk/cabinet/positions.ts` - Cabinet position definitions (`src/lib/constants/ukCabinet.ts` forwards to it)
- `src/lib/turn/parliamentaryGovernment.ts` - shared government formation and PM appointment

## Rules

### Cabinet positions

Cabinet positions are defined in `UK_CABINET_POSITIONS` (`src/lib/countries/uk/cabinet/positions.ts`), 20 entries in file order (agriculture_secretary and environment_secretary share `order: 12` because their eras are disjoint: agriculture retires in 2001 and hands off to environment via `succeededBy`):

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

### Eligibility rules

#### Prime Minister authorization

Only the current Prime Minister can appoint or dismiss cabinet ministers. This check is enforced by `requireCurrentPrimeMinister` in `src/lib/countries/uk/cabinetEligibility.ts`. Despite its location, the guard is country-agnostic and is used by other parliamentary cabinets as well.

#### Minister eligibility

To be eligible for cabinet appointment:

1. **Must be a player-controlled character holding a Commons seat**. Lords and NPPs are not eligible through this flow.
2. **At most two seats, one of each kind** (`canHoldAdditionalAppointment`, `src/lib/countries/uk/dualMinistry/rules.ts`). A minister may hold one departmental portfolio plus one central title (`deputy_prime_minister` or `first_secretary_of_state`, listed in `UK_CENTRAL_POSITION_IDS`). Two departments, both central titles, or a third seat are rejected. The unique index on `(countryId, characterId, roleSlot)` backs this up. Both seats draw on one shared action pool, so a second title does not add actions (`reconcileUkSharedPool`).
3. **Cannot be the Prime Minister**. The PM cannot appoint themselves to an additional position.
4. **Party is not a gate**. The PM may appoint any otherwise eligible Commons player, including an opposition MP.
5. **Whip must not be withdrawn.** An MP serving a whip withdrawal sits as an independent and cannot be appointed until the whip is restored.
6. **Cannot hold an incompatible office.** A central bank role must be left before joining cabinet.
7. **Era gate.** The seat must be active in the live game year (`isSeatActive`: `yearEnabled` to `yearRetired`).

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

Worked example: the PM appoints a Chancellor on turn 100, so `cooldownUntilTurn` is 124. The PM fires them on turn 110. Any appointment to the Chancellor seat is refused until the current turn reaches 124 (the check is `cooldownUntilTurn > currentTurn`), and on turn 112 the error reads "can be reappointed in 12 turns". The lock is per seat, so the PM can still appoint the fired minister to a different seat straight away.

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

## Data model

### Collections

| Collection           | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `cabinetMembers`     | Current cabinet ministers (shared across all countries, keyed by `countryId`) |
| `ukCabinetCooldowns` | Appointment-time seat locks                                                   |
| `cabinetSettings`    | Per-position settings (advocacy toggle)                                       |
| `characters`         | Career history updates                                                        |
| `electedOfficials`   | Commons seat verification                                                     |

### Document types

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

interface UKCabinetCooldown {
  _id: ObjectId;
  countryId: "UK";
  positionId: string;
  appointedCharacterId: ObjectId;
  appointedByPmCharacterId: ObjectId;
  appointedAt: Date;
  cooldownUntil: Date; // display mirror
  cooldownUntilTurn: number; // authoritative
}

interface CabinetSettings {
  _id: string; // "UK_{positionId}"
  advocacyActive: boolean;
  updatedAt: Date;
}
```

### Career history

Cabinet appointments add entries to character career history:

```typescript
const cabinetOffice: OfficeType = { type: "ukCabinet", positionId };
// Other parliamentary countries use type "parliamentaryCabinet".
const careerEvent: CareerEvent = {
  type: "appointed",
  office: cabinetOffice,
  officeLabel: getOfficeLabel(cabinetOffice, "UK"),
  party: lowerOfficial?.party ?? targetChar.party,
  partyCountryId: countryId,
  date: now,
};
await db
  .collection<Character>("characters")
  .updateOne(
    { _id: targetChar._id },
    { $push: { careerHistory: careerEvent } },
  );
```

### Error responses

| Status | Condition                                                            |
| ------ | -------------------------------------------------------------------- |
| 401    | Not authenticated                                                    |
| 403    | Not PM, ineligible character, already holds position, not in Commons |
| 404    | Character or position not found                                      |
| 409    | Position already filled, on cooldown                                 |

## Timing

Cabinet changes are player actions through the API, not a turn phase, so appointments and firings take effect immediately. The turn pipeline only touches the cabinet in these places:

1. **Government transition.** Whenever `unformGovernmentAndVacatePM` runs (no-confidence passed, snap election, post-election reset, PM lost their seat), `clearCabinetOnTransition` restores former ministers' Commons offices first, then `ukCabinetCooldowns` and `cabinetMembers` are deleted for the country (`src/lib/turn/parliamentaryGovernment.ts`). This happens in the `parliamentaryGovernmentPhases` phase or inside the snap-election trigger, before the vacancy watcher runs.
2. **Seat lock expiry.** The lock is compared against the current turn on the next appointment attempt. No phase clears it.
3. **Era change.** A seat is available only while `yearEnabled <= live year < yearRetired`, and its display name follows `namesByYear`.

## Edge cases and limits

- **PM change clears everything.** A new government starts with an empty cabinet and no seat locks. Both the cabinet rows and the 24-turn locks are deleted, so the first appointments of a new PM are never blocked by the old government's locks.
- **Fired or resigned minister.** Their `currentOffice` returns to their Commons seat. If they hold a second cabinet seat it stays, and `currentOffice` repoints to it. If they hold no seat they become private citizens.
- **Seat lock outlives the minister.** Firing never removes the lock. It is set at appointment and only a government transition clears it.
- **Reshuffle.** A bulk reshuffle skips the per-seat locks, is limited to one use per parliament per government (`canReshuffle`, `src/lib/countries/uk/cabinet/reshuffleLimit.ts`), still sets fresh locks on incoming ministers, and emits no confidence hit.
- **Confidence cost.** Firing applies `ministerFired = 8` to the confidence gauge, and a resignation applies `ministerResigned = 12`. A Great Office of State (chancellor, foreign_secretary, home_secretary) doubles the hit (`GREAT_OFFICE_MULTIPLIER = 2`). Source: `src/lib/countries/uk/confidence/confidenceGauge.ts`. The gauge is recorded, but crossing its floor does not dissolve the government unless the gauge-dissolution switch is turned on, which it is not by default.
- **NPP-held seats.** An NPP-held seat has a null `characterId`. It is skipped by office restoration and by reshuffles; NPP resignations are decided by the turn runner.
- **Lords and NPPs** cannot be appointed through this flow.
- **Head of government.** Seats flagged `isHeadOfGovernment` cannot be appointed or fired through cabinet routes. The PM leaves only through no-confidence, a snap election, or resignation.
- **Retired seats.** `agriculture_secretary` stops being fillable in 2001 and `environment_secretary` takes over. Both share `order: 12`.
- **Territorial secretaries.** The advocacy toggle resets on every new appointment to Northern Ireland, Scotland or Wales.

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

## Related systems

- **UK Government Formation:** `src/lib/turn/parliamentaryGovernment.ts` - How PM/government is formed
- **Career History:** `src/lib/db/types/character.ts` - Office type definitions
- **Countries Config:** `src/lib/constants/countries.ts` - UK country configuration

Last checked: 2026-10-29, version 1.18.0
