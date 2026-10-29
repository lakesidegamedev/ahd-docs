# Cabinet System

The President nominates principal officers to cabinet positions. The Senate confirms or rejects each nomination. Confirmed members serve at the pleasure of the President and can be fired at any time.

Player guide: [Cabinet](https://www.ahousedividedgame.com/wiki/cabinet) and [Cabinet Guide](https://www.ahousedividedgame.com/wiki/cabinet-guide)

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

- Only the **President** (character holding the `president` office, player character only) may nominate
- One active nomination per cabinet position at a time
- The nominee is either a player character of the same country or an NPP of that country (`nomineeCharacterId` or `nomineeNppId`, exactly one). Characters without a user account cannot be nominated.
- A player nominee who holds an incompatible cabinet or central bank role is refused until they leave it (`getIncompatibleOfficeHolders()` in `src/lib/cabinet/officeCompatibility.ts`).
- The seat must exist in the current era (`isSeatActive()` in `src/lib/cabinet/rosterEra.ts`), counting seats enabled by a department-creation bill.
- Nominating for a seat that already has an `active` or `proposed` nomination withdraws that earlier nomination and opens a new one, so there is only ever one live nomination per seat.
- No party restriction, the President may nominate anyone eligible.
- Vice President nominations use the same machinery but need a majority in both the House and the Senate.

## Senate Confirmation

- **Who votes**: Any character holding a `senate` office. NPP senators vote automatically each turn along party lines (`nppCabinetVote()` in `src/lib/cabinetNominationLifecycle.ts`): same party as the nominee votes For; Democrat against Republican (or the reverse) votes Against; otherwise a senator of the President's party votes For 70% of the time and abstains 30%; any other senator votes For 55% of the time and Against 45%. An NPP with no party abstains.
- **Window**: `VOTING_DURATION_HOURS = 24` in `src/app/api/whitehouse/cabinet/nominations/route.ts`. It is stored both as `votingEndsAt` (24 hours out on the game clock) and as `votingEndsOnTurn` (nomination turn plus 24); the lifecycle closes on the turn field when it exists.
- **Threshold**: Simple majority of votes cast, `didPass(votesFor, votesAgainst)` is `votesFor > votesAgainst` (`src/lib/billLifecycleHelpers.ts`). Abstentions and absent senators do not count, and a tie fails. The tally is recomputed at close, seat-weighted and scoped to the country's current Senate seats, so votes from de-seated or other-country NPPs are dropped.
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

## Rules and constants

| Constant | Value | Source |
| --- | --- | --- |
| US cabinet positions | 17 (`CABINET_POSITIONS`) | `src/lib/countries/us/cabinet/positions.ts` |
| UK cabinet positions | 20 (`UK_CABINET_POSITIONS`) | `src/lib/countries/uk/cabinet/positions.ts` |
| Senate vote window | 24 (`VOTING_DURATION_HOURS`) | `src/app/api/whitehouse/cabinet/nominations/route.ts` |
| Confirmation rule | `votesFor > votesAgainst` | `src/lib/billLifecycleHelpers.ts` |
| `MINISTERIAL_ACTION_CAP` | 4 cabinet or ministerial actions banked | `src/lib/constants/cabinetMechanicsTypes.ts` |
| `MINISTERIAL_ACTION_ACCRUAL_TURNS` | 6: one action regained every 6 turns, up to the cap | `src/lib/constants/cabinetMechanicsTypes.ts` |
| `OFFICE_POOL_TOP_UP_AP_COST` | 10 AP buys 1 extra action, up to the cap | `src/lib/actions/officePoolTopUpRules.ts` |
| `CABINET_NI_BONUS` | +1.5 national influence per turn for a confirmed member | `src/lib/actions/officeBonusRegistry.ts` |
| `ACTING_CABINET_NI_BONUS` | +0.75 national influence per turn for an acting secretary | `src/lib/actions/officeBonusRegistry.ts` |
| `ACTING_TENURE_TURNS` | 24 turns an acting appointment lasts | `src/lib/cabinet/rules.ts` |
| `ACTING_CHARGES_PER_SEAT` | 1 acting appointment per office per term | `src/lib/cabinet/rules.ts` |
| `ACTING_APPOINTMENT_PENALTY` | 0.5 national approval points per acting secretary | `src/lib/utils/governmentApproval.ts` |

Orders cost 1 cabinet action each and are covered in [Ministerial Orders](./ministerial-orders.md). The UK version of this system is in [UK Cabinet](./uk-cabinet.md). Position tables above list `yearEnabled` for the US; the UK roster is era-gated the same way through `isSeatActive()`.

## Acting appointments

A President can seat an acting secretary in a vacant seat without a Senate vote. It lasts 24 turns (`ACTING_TENURE_TURNS`), only one acting appointment is allowed per office per term (`ACTING_CHARGES_PER_SEAT`), and each acting secretary costs half a point of national approval. A pending nomination is not cancelled by an acting appointment; whoever the Senate confirms replaces the acting secretary at once. An acting secretary cannot displace a sitting confirmed member, cannot be a nominee the Senate already rejected, and cannot fill a seat absent from the current era. Expiry is handled by `expireLapsedActingAppointments()` in `src/lib/cabinet/actingExpiry.ts`, called from the nomination lifecycle.

## Worked example

On turn 1,000 the President nominates a player for Secretary of the Treasury. The window closes at turn 1,024 (`votingEndsOnTurn`). By then 41 senators have voted For, 38 Against and 6 abstained (15 absent). `41 > 38`, so the nominee is confirmed and seated as a `cabinetMembers` row at the next lifecycle run. Had it been 38 to 38 the nomination would be rejected and the seat stays vacant. The nominee also gets the +1.5 national influence tier each turn, and if they held a legislative seat the higher tier is the one that counts (tiers do not stack). If the President had instead named the White House Chief of Staff, `votingEndsOnTurn` equals the current turn and the nominee is seated on the next lifecycle run with no vote.

## Timing

- Nominating (`POST /api/whitehouse/cabinet/nominations`) is immediate and writes a `cabinetNominations` row with `status: active`.
- `processCabinetNominationLifecycle()` (`src/lib/cabinetNominationLifecycle.ts`) runs every turn as the `cabinetNominations` phase in the same parallel group as `billLifecycle`, `stateBillTimers`, `scotusTurn` and `fomcNominations` (`src/simulation/phases/turnPhaseRegistry.ts`).
- Within one run: first NPP senators cast their party-line votes on active nominations, then expired votes (`votingEndsOnTurn <= currentTurn + 1`) are closed and resolved.
- Seats flagged `appointedWithoutConfirmation` (US Chief of Staff) get a zero-length window, so they resolve in the next lifecycle run through the same install path as a confirmation.
- `clearCabinetOnTransition()` runs when government changes hands, outside the turn phase, and wipes the cabinet before the new government nominates.

## Edge cases and limits

- A tie or an all-abstain vote fails: `votesFor` must exceed `votesAgainst`.
- Abstentions and non-voters are excluded from the threshold, so a handful of votes can confirm if the rest abstain.
- The Chief of Staff needs no vote and is not in the line of succession.
- At close, a non-VP nominee who has since taken a central bank role is rejected even if the vote passed.
- A Senate rejection leaves the seat vacant and re-nomination is allowed. Acting appointment cannot install a rejected nominee.
- Firing needs no Senate vote and takes effect immediately.
- NPP-held seats and NPP senators work through the same tables, so an all-NPP Senate still resolves nominations by party lines.
- The Education seat uses `yearEnabled: 9999` and only appears after the Department of Education Act; `secretary_of_health` is named HEW until then.
- No EPA, OMB, UN Ambassador or USTR seats exist.
- The tally cannot exceed the country's current Senate seats even if cached counters drifted.

## Connections

Driven by:

- [Congress Leadership](./congress-leadership.md): Senate membership decides who votes, read by `computeCabinetNominationTally()` in `src/lib/congress/governmentVoteBreakdown.ts`.
- [NPP System](./npp-system.md): NPP senators vote by party in `nppCabinetVote()`; NPP nominees come through `nomineeNppId`.
- Elections and government change: a new President or Prime Minister, or a failed UK no-confidence vote, triggers `clearCabinetOnTransition()` in `src/lib/cabinetTransition.ts`. See [UK PM No-Confidence](./uk-pm-no-confidence.md).
- Legislation: department-creation bills enable seats and the Department of Education Act enables the Education seat.

Affects:

- [Ministerial Orders](./ministerial-orders.md): a seated member gets the action pool, orders, tier settings and projects of their department (`initialMinisterialActionFields()` in `src/lib/cabinet/ministerialActionPool.ts`).
- National influence and office action bonus: `CABINET_NI_BONUS` and `ACTING_CABINET_NI_BONUS` in `src/lib/actions/officeBonusRegistry.ts`, and `cabinetOfficeTypeForCountry()` for the office key.
- National approval: empty seats and acting secretaries lower it (`src/lib/utils/governmentApproval.ts`).
- Character career and notifications: seated, rejected and cleared members get notifications and career events.
- [Core Systems](./core-systems.md): cabinet seats are part of the executive branch listing.

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
| `/api/whitehouse/cabinet/nominations/[id]/withdraw` | POST | President | Withdraw a pending nomination                  |
| `/api/whitehouse/cabinet/acting`                | POST   | President | Seat an acting secretary in a vacant seat          |

## Related Documentation

- [Congress Leadership](./congress-leadership.md), Senate role in nominations
- [Core Systems](./core-systems.md), Cabinet system overview
- [Technical Architecture](./technical-architecture.md), Collections and API routes

Last checked: 2026-10-29, version 1.18.0
