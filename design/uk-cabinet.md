# UK Cabinet System

## Overview

The UK Cabinet System manages cabinet appointments for the United Kingdom government. The Prime Minister appoints and dismisses eligible player-controlled MPs. Cabinet eligibility is not restricted to the governing party or coalition.

**Location:** `src/lib/countries/uk/` (`src/lib/uk/` holds forwarders to it)

**Key files:**

- `src/lib/countries/uk/cabinetApi.ts` - API route handlers for appointments
- `src/lib/countries/uk/cabinetEligibility.ts` - Eligibility rules and queries
- `src/lib/countries/uk/cabinet/positions.ts` - Cabinet position definitions (`src/lib/constants/ukCabinet.ts` forwards to it)
- `src/lib/turn/parliamentaryGovernment.ts` - shared government formation and PM appointment

## Cabinet Positions

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

## Eligibility Rules

### Prime Minister Authorization

Only the current Prime Minister can appoint or dismiss cabinet ministers. This check is enforced by `requireCurrentPrimeMinister` in `src/lib/countries/uk/cabinetEligibility.ts`. Despite its location, the guard is country-agnostic and is used by other parliamentary cabinets as well.

### Minister Eligibility

To be eligible for cabinet appointment:

1. **Must be a player-controlled character holding a Commons seat**. Lords and NPPs are not eligible through this flow.
2. **Cannot already hold a cabinet position**. A character holds at most one cabinet seat.
3. **Cannot be the Prime Minister**. The PM cannot appoint themselves to an additional position.
4. **Party is not a gate**. The PM may appoint any otherwise eligible Commons player, including an opposition MP.

## Appointment Flow

### 1. View Eligible Characters

```typescript
GET /api/country/uk/executive/cabinet/characters

Response:
{
  success: true,
  characters: Character[]  // Eligible for appointment
}
```

### 2. Appoint Minister

```typescript
POST /api/country/uk/executive/cabinet/appoint
Body: { positionId: string, characterId: string }

Authorization: requireAuth() + requireCurrentPrimeMinister(db, countryId, userId)

Checks:
1. Position exists in UK_CABINET_POSITIONS
2. Character exists and is player character
3. Character holds Commons seat
4. Character is not PM
5. Position is not already filled
6. Position is not on cooldown
7. Character doesn't already hold cabinet position

Effects:
1. Insert record into `cabinetMembers` (shared collection, `countryId: "UK"`)
2. Add career history entry to character
3. Reset advocacy toggle for territorial secretaries (NI, Scotland, Wales)
```

### 3. Dismiss Minister

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
```

### Other cabinet routes

Under `/api/country/[code]/executive/cabinet/` (`src/app/api/country/[code]/executive/cabinet/`), parliamentary countries also expose `reshuffle` and `resign` (POST, handled in `cabinetApi.ts`), `acting` (POST, a President installs an acting member without confirmation), and `whip`, `whip/withdraw` and `whip/restore` (PM-only party whip withdrawal and restoration, `cabinetWhipApi.ts`). Per-seat office actions live under `[positionId]/...`.

## Cooldown System

Each appointment starts a 24-turn seat lock (`COOLDOWN_TURNS` in `cabinetApi.ts`). The lock survives a firing, so the PM cannot immediately refill a seat by cycling ministers. Firing itself is unrestricted.

```typescript
const COOLDOWN_TURNS = 24;
// Locked for COOLDOWN_TURNS turns from this appointment/firing, keyed to turn
// length so it tracks game time regardless of wall-clock drift.
const cooldownUntilTurn = appointTurn + COOLDOWN_TURNS;
const cooldownUntil = new Date(
  now.getTime() + COOLDOWN_TURNS * turnLengthMinutes * 60_000,
);

await getUKCabinetCooldownsCollection(db).updateOne(
  { countryId: "UK", positionId },
  {
    $set: {
      countryId: "UK",
      positionId,
      appointedCharacterId: character._id,
      appointedByPmCharacterId: pmCharacter._id,
      appointedAt: now,
      cooldownUntil,
    },
  },
  { upsert: true },
);
```

**Purpose:** Prevents rapid hire/fire/re-hire cycles within the same cabinet seat.

## Advocacy Toggle

Territorial secretaries (Northern Ireland, Scotland, Wales) have an advocacy toggle that can be activated to advocate for their region. This toggle is **automatically reset** when a new minister is appointed:

```typescript
if (["northern_ireland", "scotland", "wales"].includes(positionId)) {
  await getCabinetSettingsCollection(db).updateOne(
    { _id: `UK_${positionId}` },
    { $set: { advocacyActive: false, updatedAt: new Date() } },
  );
}
```

## Data Model

### Collections

| Collection           | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `cabinetMembers`     | Current cabinet ministers (shared across all countries, keyed by `countryId`) |
| `ukCabinetCooldowns` | Appointment-time seat locks                                                   |
| `cabinetSettings`    | Per-position settings (advocacy toggle)                                       |
| `characters`         | Career history updates                                                        |
| `electedOfficials`   | Commons seat verification                                                     |

### Document Types

```typescript
// Shared cabinetMembers doc shape, filtered by countryId: "UK" for this system.
interface CabinetMember {
  _id: ObjectId;
  countryId: string;
  positionId: string;
  characterId: ObjectId;
  characterName: string;
  party: string;
  appointedByPmCharacterId: ObjectId;
  appointedAt: Date;
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
  cooldownUntil: Date;
  cooldownUntilTurn: number;
  createdAt: Date;
  updatedAt: Date;
}

interface CabinetSettings {
  _id: string; // "UK_{positionId}"
  advocacyActive: boolean;
  updatedAt: Date;
}
```

## Career History

Cabinet appointments add entries to character career history:

```typescript
const cabinetOffice: OfficeType = { type: "ukCabinet", positionId };
const careerEvent: CareerEvent = {
  type: "appointed",
  office: cabinetOffice,
  officeLabel: getOfficeLabel(cabinetOffice, "UK"),
  party: commonsOfficial.party ?? targetChar.party,
  date: now,
};
await db
  .collection<Character>("characters")
  .updateOne(
    { _id: targetChar._id },
    { $push: { careerHistory: careerEvent } },
  );
```

## Error Responses

| Status | Condition                                                            |
| ------ | -------------------------------------------------------------------- |
| 401    | Not authenticated                                                    |
| 403    | Not PM, ineligible character, already holds position, not in Commons |
| 404    | Character or position not found                                      |
| 409    | Position already filled, on cooldown                                 |

## Related Systems

- **UK Government Formation:** `src/lib/turn/parliamentaryGovernment.ts` - How PM/government is formed
- **Coalitions:** `src/app/api/coalitions/` - Coalition management
- **Career History:** `src/lib/db/types/character.ts` - Office type definitions
- **Countries Config:** `src/lib/constants/countries.ts` - UK country configuration
