# Vacancy Handling

## Overview

When elected officials resign, die, or are removed from office, their seats may be filled temporarily by appointment (Senate only), filled by a by-election (Governor, UK Commons), or remain vacant until the next regular election cycle (other offices).

## Vacancy Types by Office

| Office              | Vacancy Handling              | Duration                                               |
| ------------------- | ----------------------------- | ------------------------------------------------------ |
| **US Senate**       | Governor appoints replacement | Until next regular Class election                      |
| **US House**        | Seat remains vacant           | Until next regular House election (2 years max)        |
| **US Governor**     | Special election (`special_governor`) | Filing window then general election (see below)  |
| **US State Senate** | Seat remains vacant           | Until next regular State Senate election (4 years max) |
| **UK MP (Commons)** | By-election for the vacated seat | Contested on a scaled-down regional electorate       |

## Senate Vacancies (US Only)

### Triggering a Vacancy

A Senate seat becomes vacant when:

- Senator resigns (via `/api/officials/[id]/resign`)
- Senator is removed by admin
- Senator dies (future: mortality system)

### Appointment Process

When a Senate seat becomes vacant:

1. **Vacancy created:** `ElectedOfficial` document for that senator is deleted
2. **Notification sent to Governor:** "A Senate seat in your state has become vacant. You may appoint a replacement."
3. **Governor eligibility window:** Governor has 48 hours (48 turns) to make an appointment
4. **If no appointment made:** Seat remains vacant until next regular election

### Governor Appoints Replacement

**Eligibility for appointment:**

- Must be a character (not NPP)
- Must have `homeState` matching the vacancy's state
- Must not already hold an elected office
- Traditionally same party as vacating senator (but governor's discretion - no hard requirement)

**Appointment steps:**

1. Governor navigates to `/officials` page or receives direct link in notification
2. Clicks "Appoint Senate Replacement" button
3. Selects eligible character from dropdown (filtered by state and availability)
4. Confirms appointment
5. New `ElectedOfficial` document created with:
   - `officeType: "senate"`
   - `state: [vacancy state]`
   - `senateClass: [Class 1/2/3]` (same class as vacancy)
   - `isAppointment: true`
   - `appointedBy: [governor characterId]`
   - `termStart: [now]`
   - `termEnd: [next Class election endTime]`
6. Notifications sent:
   - To appointee: "You have been appointed as US Senator for [State]"
   - To governor: "You have appointed [Name] as US Senator"
   - To state residents (optional future enhancement)

### Appointment Duration

**Appointed senator serves until the next regular election for that Senate class.**

**Example:**

- **Jan 2020 (Turn 0):** Class 1 election completes; Senator John Smith (D-CA) elected
- **Term end:** Jan 2026 (Turn 288 = 6 years)
- **May 2022 (Turn 110):** Senator Smith resigns
- **May 2022 (Turn 110):** Governor Newsom appoints Sarah Johnson (D-CA) as replacement
- **Appointment duration:** Until Jan 2026 (Turn 288) - when next Class 1 election completes
- **Sarah Johnson serves:** 178 turns (3.7 years)

### No Special Elections for Senate

There are **no special elections** for Senate vacancies. The appointed senator serves the full remainder of the term. Voters do not get to choose the replacement until the next regular Class election.

This simplifies the system and avoids mid-cycle election spam.

## House Vacancies

When a House member resigns or is removed:

- Seat remains **vacant**
- No appointment mechanism
- No special election
- Seat is filled only when the next regular House election completes (every 2 years)

**Impact:**

- House total seat count may drop below 435
- Party seat counts decrease
- State delegation size decreases temporarily

**Example:**

- **Nov 2020:** CA-12 elects Nancy Pelosi (D)
- **Term end:** Nov 2022
- **June 2021:** Pelosi resigns
- **Vacancy:** CA-12 seat vacant for 16 months until Nov 2022 House election

## Governor Vacancies

When a Governor resigns, retires, dies or is removed mid-term, the seat is filled by an off-calendar special election of type `special_governor` (`src/lib/turn/byElections.ts`). This applies to the countries listed in `BY_ELECTION_COUNTRIES`: the US and Russia.

- Filing/primary window of 24 turns (`SPECIAL_GOVERNOR_FILING_TURNS`), then a general election of 24 turns (`SPECIAL_GOVERNOR_GENERAL_TURNS`)
- The winner is seated as a plain governor, and the next regular Governor election spawns on its normal calendar
- If nobody contests the by-election, another is not spawned for the same seat until `BY_ELECTION_RETRY_COOLDOWN_TURNS = 48` turns have passed
- No Lt. Governor succession (Lt. Governor is not implemented in the game)
- No appointment mechanism

**Impact:**

- State has no governor until the special election resolves
- Executive powers unavailable in the meantime (cannot appoint senators, cannot sign/veto bills if state-level legislation implemented)

## State Senate Vacancies

When a State Senator resigns or is removed:

- Seat remains **vacant**
- No appointment mechanism
- No special election
- Seat is filled only when the next regular State Senate election completes (every 4 years)

**Impact:**

- State Senate total seat count decreases
- Party seat counts decrease
- Legislative quorum may be affected (future: quorum requirements)

## UK MP (Commons) Vacancies

When an MP resigns or is removed, the seat is recorded as a durable vacancy (`src/lib/countries/uk/elections/commonsVacancyShell.ts`) and a by-election is held for it:

- The by-election contests only the vacated seat(s). AHD models regions with a seat count rather than individual constituencies, so it runs over the regional electorate scaled down to the vacated seats' share of the region, `carveFraction = vacatedSeats / totalRegionSeats` (`byElectionCarve.ts`). The regional mix of groups and leans is preserved.
- The reduced electorate runs through the normal vote engine.

**Impact:**

- Commons total seat count can drop below 650 while a seat awaits its by-election
- Party seat counts decrease until it resolves
- May affect confidence votes (fewer MPs voting)

## Resignation Mechanics

### Player Resignation

Any player holding elected office can resign at any time (except during active election they're running in).

**API:** `POST /api/officials/[id]/resign`

**Auth:** Must be the character who holds that office OR an admin

**Validation:**

- Official must be currently in office (`ElectedOfficial` exists)
- Character must not be actively running in an election (prevents abuse)

**Effect:**

1. `ElectedOfficial` document deleted
2. If Senate: Governor notification sent (appoint replacement)
3. If House/State Senate: No action (seat vacant); Governor and UK MP seats go to a by-election
4. Character's `currentOffice` field cleared
5. Notification sent to character: "You have resigned from [office]"

### Admin Removal

Admins can remove any official via Admin → Officials panel.

**API:** Same as resignation (`POST /api/officials/[id]/resign` with admin auth)

**Effect:** Identical to player resignation

## Database Schema

### ElectedOfficial (Updated)

Add fields to track appointments:

```ts
interface ElectedOfficial {
  _id: ObjectId;
  characterId: ObjectId;
  officeType: OfficeType;
  state: string;
  senateClass?: SenateClass;
  termStart: Date;
  termEnd: Date;

  // New fields for appointments
  isAppointment: boolean; // true if appointed, false if elected
  appointedBy?: ObjectId; // characterId of appointing governor (if isAppointment true)

  createdAt: Date;
  updatedAt: Date;
}
```

### Migration

Update all existing `ElectedOfficial` documents:

```ts
db.electedOfficials.updateMany(
  { isAppointment: { $exists: false } },
  { $set: { isAppointment: false } }
);
```

## API Routes

### POST /api/officials/[id]/resign

Resign from elected office.

**Auth:** Must be the character who holds that office OR admin

**Body:** None

**Response:**

```json
{
  "success": true,
  "message": "You have resigned from US Senator for California"
}
```

**Side effects:**

- `ElectedOfficial` document deleted
- If Senate: Governor receives appointment notification
- Character profile updated

### POST /api/governors/appoint-senator

Governor appoints replacement senator.

**Auth:** Must be an active Governor

**Body:**

```json
{
  "characterId": "507f1f77bcf86cd799439011",
  "senateClass": 1
}
```

**Validation:**

- User is a governor
- Senate vacancy exists in user's state for specified class
- Candidate is eligible (see eligibility above)

**Response:**

```json
{
  "success": true,
  "appointee": {
    "characterId": "507f1f77bcf86cd799439011",
    "name": "Sarah Johnson",
    "party": "democrat"
  },
  "termEnd": "2026-01-15T00:00:00Z"
}
```

### GET /api/governors/eligible-appointees

Get list of characters eligible for Senate appointment.

**Auth:** Must be an active Governor

**Query params:**

- `senateClass`: 1 | 2 | 3 (which class vacancy to fill)

**Response:**

```json
{
  "candidates": [
    {
      "characterId": "507f1f77bcf86cd799439011",
      "name": "Sarah Johnson",
      "party": "democrat",
      "homeState": "CA"
    }
    // ... more candidates
  ]
}
```

**Filtering:**

- `homeState` matches governor's state
- Not currently holding office
- Is a player character (not NPP)

## UI Components

### Officials Page (`/officials`)

Add **Vacancies** section:

```
┌──────────────────────────────────────┐
│ 📋 Current Vacancies                  │
│                                        │
│ US Senate:                             │
│ • California, Class 1                  │
│   [Appoint Replacement] ← If governor │
│                                        │
│ US House:                              │
│ • CA-12 (vacant since June 2021)      │
│ • NY-14 (vacant since Aug 2021)       │
└──────────────────────────────────────┘
```

### Appoint Senator Modal

Modal triggered by "Appoint Replacement" button:

```
┌──────────────────────────────────────────┐
│ Appoint US Senator for California         │
│                                            │
│ Vacancy: Class 1 Senate seat              │
│ Term End: January 2026 (178 turns)        │
│                                            │
│ Select Appointee:                          │
│ [Dropdown: Sarah Johnson (Democrat)]       │
│                                            │
│ ℹ️ Note: Appointed senator serves until   │
│ the next Class 1 election in Jan 2026.    │
│                                            │
│           [Cancel]  [Confirm Appointment]  │
└──────────────────────────────────────────┘
```

### Character Profile (If Appointed)

Show appointment badge on appointed officials:

```
┌──────────────────────────────────────┐
│ Sarah Johnson                         │
│ US Senator for California (Class 1)   │
│ 📌 Appointed by Gov. Gavin Newsom     │ ← Badge
│ Term: May 2022 - Jan 2026             │
└──────────────────────────────────────┘
```

## Resign Button

Add to character's own profile page (when holding office):

```
┌──────────────────────────────────────┐
│ Your Office: US Senator for California│
│                                        │
│ ⚠️ [Resign from Office]                │
└──────────────────────────────────────┘
```

Clicking triggers confirmation modal:

```
⚠️ Are you sure you want to resign as US Senator for California?

This action cannot be undone. Your seat will become vacant immediately.

[Cancel]  [Confirm Resignation]
```

## Future Enhancements

1. **Special elections** - Allow states to opt-in to special elections for House/State Senate
2. **Lt. Governor succession** - Implement Lt. Governor office; auto-succession on Governor vacancy
4. **Death/mortality** - Characters die of natural causes or events; triggers vacancies
5. **Expulsion** - Congress can expel members via 2/3 vote; triggers vacancy

## Related pages

- [Election Mechanics](./elections.md) - Election cycles and perpetual races
- [United Kingdom](./united-kingdom.md) - Commons vacancies and by-elections
- [State-Level Power](./state-level-power.md) - Governors and appointments
