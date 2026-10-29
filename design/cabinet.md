# Cabinet System

The President nominates principal officers to cabinet positions. The Senate confirms or rejects each nomination. Confirmed members serve at the pleasure of the President and can be fired at any time.

## Cabinet Positions

17 positions, defined in `src/lib/countries/us/cabinet/positions.ts` (`CABINET_POSITIONS`, re-exported from `src/lib/constants/cabinet.ts`), ordered to match the presidential line of succession after the Vice President, followed by the two seats outside the cabinet departments (orders 16 and 17). Each position also carries a `yearEnabled` (some, like Homeland Security, don't exist in earlier eras) and an `id` used across nominations, members, and the UI.

| Order | Position                                       | ID                          | Year Enabled |
| ----- | ----------------------------------------------- | --------------------------- | ------------ |
| 1     | Secretary of State                              | `secretary_of_state`        | 1775         |
| 2     | Secretary of the Treasury                       | `secretary_of_treasury`     | 1775         |
| 3     | Secretary of Defense                            | `secretary_of_defense`      | 1775         |
| 4     | Attorney General                                | `attorney_general`          | 1775         |
| 5     | Secretary of the Interior                       | `secretary_of_interior`     | 1775         |
| 6     | Secretary of Agriculture                        | `secretary_of_agriculture`  | 1775         |
| 7     | Secretary of Commerce                           | `secretary_of_commerce`     | 1775         |
| 8     | Secretary of Labor                              | `secretary_of_labor`        | 1775         |
| 9     | Secretary of Health and Human Services          | `secretary_of_health`       | 1953         |
| 10    | Secretary of Housing and Urban Development      | `secretary_of_hud`          | 1965         |
| 11    | Secretary of Transportation                     | `secretary_of_transportation` | 1967       |
| 12    | Secretary of Energy                             | `secretary_of_energy`       | 1977         |
| 13    | Secretary of Education                          | `secretary_of_education`    | 9999         |
| 14    | Secretary of Veterans Affairs                   | `secretary_of_veterans`     | 1989         |
| 15    | Secretary of Homeland Security                  | `secretary_of_homeland`     | 2002         |
| 16    | Director of Central Intelligence                | `director_of_intelligence`  | 1946         |
| 17    | White House Chief of Staff                      | `chief_of_staff`            | 1946         |

The Secretary of Health and Human Services position is named Secretary of Health, Education, and Welfare until `secretary_of_education` is enabled via `renameOnDepartmentSplit` (`namesByYear` in the same file tracks this). Education uses `yearEnabled: 9999` and is carved out of HEW only when the Department of Education Act passes (legislation-gated, not calendar 1980).

The White House Chief of Staff is appointed by the President alone with no Senate vote (`appointedWithoutConfirmation`) and is not in the line of succession. The nominee is seated at the next turn.

There is no EPA Administrator, OMB Director, UN Ambassador, or USTR position in the cabinet; those are not implemented.

## UK Cabinet Positions

20 seats, defined in `UK_CABINET_POSITIONS` (`src/lib/countries/uk/cabinet/positions.ts`), in file order. `agriculture_secretary` and `environment_secretary` share order 12; agriculture retires in 2001 and hands off to environment via `succeededBy` since their eras never overlap.

| Order | Position (base name)                                              | ID                          |
| ----- | ------------------------------------------------------------------- | ---------------------------- |
| 0     | Deputy Prime Minister                                                | `deputy_prime_minister`     |
| 1     | First Secretary of State                                             | `first_secretary_of_state`  |
| 2     | Chancellor of the Exchequer                                          | `chancellor`                |
| 3     | Foreign Secretary                                                    | `foreign_secretary`         |
| 4     | Home Secretary                                                       | `home_secretary`            |
| 5     | Secretary of State for Defence                                       | `defence_secretary`         |
| 6     | Lord Chancellor & Secretary of State for Justice                    | `justice_secretary`         |
| 7     | Secretary of State for Health and Social Care                        | `health_secretary`          |
| 8     | Secretary of State for Education                                     | `education_secretary`       |
| 9     | Secretary of State for Business, Energy and Industrial Strategy      | `business_secretary`        |
| 10    | Secretary of State for Housing, Communities and Local Government     | `levelling_secretary`       |
| 11    | Secretary of State for Transport                                     | `transport_secretary`       |
| 12    | Minister of Agriculture, Fisheries and Food (retires 2001)           | `agriculture_secretary`     |
| 12    | Secretary of State for Environment, Food and Rural Affairs (from 2001) | `environment_secretary`   |
| 13    | Secretary of State for Work and Pensions                             | `work_secretary`            |
| 14    | Secretary of State for Northern Ireland                              | `northern_ireland`          |
| 15    | Secretary of State for Scotland                                      | `scotland`                  |
| 16    | Secretary of State for Wales                                         | `wales`                     |
| 17    | Chief of the Secret Intelligence Service                             | `director_of_intelligence`  |
| 18    | Parliamentary Secretary to the Treasury (Chief Whip)                 | `chief_whip`                |

**Key UK difference:** The Prime Minister appoints cabinet ministers directly, there is no parliamentary confirmation vote. Once the PM names a minister, they are immediately a confirmed cabinet member. This contrasts with the US system where every nomination except the Chief of Staff requires a Senate majority vote before the member is seated.

## Lifecycle

### US Path

```
President nominates character
        ↓
Nomination created (status: active)
        ↓
Senate votes within 24 hours
(For / Against / Abstain)
        ↓
Simple majority of votes cast
    ↙         ↘
Confirmed    Rejected
(cabinetMembers)  (position vacant; re-nominate)
        ↓
President fires anytime         Government transition occurs
(member removed from            (new President/PM elected)
 cabinetMembers)                        ↓
                                ALL cabinet members dismissed
                                Pending nominations withdrawn
```

### UK Path

```
PM appoints character directly
        ↓
Minister immediately confirmed
(cabinetMembers, no vote required)
        ↓
PM fires anytime                Government transition occurs
(member removed from            (new PM appointed, or
 cabinetMembers)                 no-confidence vote passes)
                                        ↓
                                ALL cabinet members dismissed
                                (ministers serve at PM's pleasure;
                                 cabinet automatically falls when PM changes)
```

## Nomination Rules

- Only the **President** (character holding the `president` office) may nominate
- One active nomination per cabinet position at a time
- The nominee must be an existing character; NPPs are not eligible
- No party restriction, President may nominate anyone

## Senate Confirmation

- **Who votes**: Any character holding a `senate` office
- **Window**: 24 hours from nomination
- **Threshold**: Simple majority of votes cast (not of all 100 senators)
- **Votes**: For, Against, Abstain
- **My vote tracking**: Each senator's vote is stored and displayed on the ballot UI

## Firing

- **Who can fire**: Only the current President
- **When**: Any time; no Senate vote required to remove
- **Effect**: Member immediately removed from `cabinetMembers`; position becomes vacant

## Government Transition (Automatic Dismissal)

When a government changes hands, the entire cabinet is automatically cleared:

**Triggers:**

- A new US President is elected and takes office
- A new UK Prime Minister is appointed
- A UK no-confidence vote passes (government falls)

**What happens:**

1. All confirmed cabinet members for the affected country are deleted from `cabinetMembers`
2. All pending nominations with status `proposed` or `active` are set to `withdrawn`
3. Player characters who held cabinet seats receive an in-app notification, title: **"Cabinet Resigned"**, message: _"Your cabinet appointment has ended due to a change in government."_
4. NPP cabinet members are dismissed silently (no notification sent)

**Implementation:** `src/lib/cabinetTransition.ts` → `clearCabinetOnTransition(db, countryId)`

The function accepts a `CountryId` and resolves the correct set of position IDs (`CABINET_POSITIONS` for US, `UK_CABINET_POSITIONS` for UK, plus per-country tables for JP, DE, IE, CN, NG, SCO, WAL) before performing the cleanup. Notification failures are non-fatal (best-effort).

## UI

### Cabinet Page (`/whitehouse/cabinet`)

- **Hero header**, Cabinet image with stats strip: Positions filled (X / Y) and Pending Votes count
- **"Vote in Senate" banner**, Shown when active nominations exist; links to Congress Senate tab
- **Vote section**, When the current player is a Senator and nominations are pending, inline vote UI appears (For / Against / Abstain buttons with current tallies)
- **Positions grid**, All 17 positions displayed as cards:
  - Filled positions show member name, party, and "Fire" button (President only)
  - Vacancies show "Nominate" button (President only)
  - Active nominations show vote status

### Nomination Modal

Accessible from the "Propose Nomination" button. President selects:

1. Cabinet position (from unfilled positions)
2. Nominee character (from all characters)

### Senate / Congress Tab

Active cabinet nominations also appear in the Congress page Senate tab so senators see pending votes without navigating to the White House.

## Database Collections

| Collection           | Purpose                                                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cabinetNominations` | All nominations; fields: `positionId`, `nomineeCharacterId`, `nominatorCharacterId`, `status` (active/confirmed/rejected), `votesFor`, `votesAgainst`, `votesAbstain`, `votingEndsAt`, per-senator vote records |
| `cabinetMembers`     | Confirmed members; fields: `positionId`, `characterId`, `characterName`, `party`, `confirmedAt`                                                                                                                 |

## API Routes

| Route                                           | Method | Access    | Purpose                                            |
| ----------------------------------------------- | ------ | --------- | -------------------------------------------------- |
| `/api/whitehouse/cabinet`                       | GET    | Any       | All positions with member + active nomination data |
| `/api/whitehouse/cabinet/characters`            | GET    | President | Eligible nominees for nomination modal             |
| `/api/whitehouse/cabinet/nominations`           | POST   | President | Create a nomination                                |
| `/api/whitehouse/cabinet/nominations/[id]/vote` | POST   | Senator   | Cast vote on a nomination                          |
| `/api/whitehouse/cabinet/fire`                  | POST   | President | Remove a confirmed cabinet member                  |

## Related Documentation

- [Congress Leadership](./congress-leadership.md), Senate role in nominations
- [Core Systems](./core-systems.md), Cabinet system overview
- [Technical Architecture](./technical-architecture.md), Collections and API routes
