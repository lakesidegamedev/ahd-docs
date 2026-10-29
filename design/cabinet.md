# Cabinet System

## Summary

The President nominates principal officers to cabinet positions. The Senate confirms or rejects each nomination. Confirmed members serve at the pleasure of the President and can be fired at any time.

Player guide: [Cabinet](https://www.ahousedividedgame.com/wiki/cabinet) and [Cabinet Guide](https://www.ahousedividedgame.com/wiki/cabinet-guide)

Only the US runs Senate confirmation (`cabinetNominations`). The UK, Japan, Germany, Ireland, China, Nigeria, Scotland and Wales appoint ministers directly. The UK version is in [UK Cabinet](./uk-cabinet.md).

## Rules

### Cabinet positions

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

The White House Chief of Staff is appointed by the President alone with no Senate vote (`appointedWithoutConfirmation`) and is not in the line of succession (`outsideSuccession`). The nominee is seated at the next turn.

There is no EPA Administrator, OMB Director, UN Ambassador, or USTR position in the cabinet; those are not implemented.

### UK cabinet positions

20 seats, defined in `UK_CABINET_POSITIONS` (`src/lib/countries/uk/cabinet/positions.ts`), in file order. `agriculture_secretary` and `environment_secretary` share order 12; agriculture retires in 2001 (`yearRetired: 2001`) and hands off to environment (`yearEnabled: 2001`) via `succeededBy` since their eras never overlap. Seat names change by year (`namesByYear`); the table shows the base name. Seats not available from 1775: `first_secretary_of_state` 1962, `wales` 1964, `northern_ireland` 1972, `director_of_intelligence` 1909.

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

### Lifecycle

#### US path

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

#### UK path

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

### Nomination rules

- Only the **President** (character holding the `president` office, player character only) may nominate (`POST /api/whitehouse/cabinet/nominations`).
- One active nomination per cabinet position at a time, backed by a partial unique index (`unique_active_cabinet_nomination_per_position` on `countryId` and `positionId` where `status` is `active`, in `src/lib/admin/seed/indexes/writeGuardSpecs.ts`). A duplicate insert returns 409.
- The nominee is either a player character of the same country or an NPP of that country (`nomineeCharacterId` or `nomineeNppId`, exactly one). Characters without a user account cannot be nominated.
- A player nominee who holds an incompatible cabinet or central bank role is refused until they leave it (`getIncompatibleOfficeHolders()` in `src/lib/cabinet/officeCompatibility.ts`).
- The seat must exist in the current era (`isSeatActive()` in `src/lib/cabinet/rosterEra.ts`: `yearEnabled <= year < yearRetired`, or a seat forced on by `gameState.manuallyEnabledSeats`), counting seats enabled by a department-creation bill.
- Nominating for a seat that already has an `active` or `proposed` nomination withdraws that earlier nomination and opens a new one, so there is only ever one live nomination per seat.
- No party restriction, the President may nominate anyone eligible.
- Vice President nominations use the same machinery but need a majority in both the House and the Senate.

### Senate confirmation

- **Who votes**: Any character holding a `senate` office. NPP senators vote automatically each turn along party lines (`nppCabinetVote()` in `src/lib/cabinetNominationLifecycle.ts`), evaluated in this order: no party abstains; same party as the nominee votes For; Democrat against Republican (or the reverse) votes Against; otherwise a senator of the President's party votes For 70% of the time and abstains 30%; any other senator votes For 55% of the time and Against 45%. Each NPP vote carries `seatsHeld` weight.
- **Window**: `VOTING_DURATION_HOURS = 24` in `src/app/api/whitehouse/cabinet/nominations/route.ts`. It is stored both as `votingEndsAt` (24 hours out on the game clock) and as `votingEndsOnTurn` (nomination turn plus 24); the lifecycle closes on the turn field when it exists.
- **Threshold**: Simple majority of votes cast, `didPass(votesFor, votesAgainst)` is `votesFor > votesAgainst` (`src/lib/billLifecycleHelpers.ts`). Abstentions and absent senators do not count, and a tie fails. The tally is recomputed at close, seat-weighted and scoped to the country's current Senate seats, so votes from de-seated or other-country NPPs are dropped.
- **Votes**: For, Against, Abstain. A player senator votes through `POST /api/whitehouse/cabinet/nominations/[id]/vote`; House members may vote only on VP nominations.
- **My vote tracking**: Each senator's vote is stored and displayed on the ballot UI.

### Firing

- **Who can fire**: Only the current President (`POST /api/whitehouse/cabinet/fire`).
- **When**: Any time; no Senate vote required to remove.
- **Effect**: Member immediately removed from `cabinetMembers`; position becomes vacant. A player holder gets a "Removed from Cabinet" notification.

### Government transition (automatic dismissal)

When a government changes hands, the entire cabinet is automatically cleared:

**Triggers:**

- A new US President is elected and takes office
- A new UK Prime Minister is appointed
- A UK no-confidence vote passes (government falls)

**What happens:**

1. All confirmed cabinet members for the affected country are deleted from `cabinetMembers`
2. All pending nominations with status `proposed` or `active` are set to `withdrawn`
3. Player characters who held cabinet seats receive an in-app notification, title: **"Cabinet Resigned"**, message: _"Your cabinet appointment has ended due to a change in government."_ Their `currentOffice` is restored to their legislative seat, or unset if they have none, but only if it is still the cabinet office type.
4. NPP cabinet members are dismissed silently (no notification sent)
5. For non-US countries, `cabinetSettings` for the country are deleted and active `ministerialOrders` are deactivated. The US branch does neither.

**Implementation:** `src/lib/cabinetTransition.ts` → `clearCabinetOnTransition(db, countryId)`, called from `src/lib/turn/election/presidentExecutiveSeating.ts` and `src/lib/turn/parliamentaryGovernment.ts`.

The function accepts a `CountryId` and resolves the correct set of position IDs (`CABINET_POSITIONS` for US, `UK_CABINET_POSITIONS` for UK, plus per-country tables for JP, DE, IE, CN, NG, SCO, WAL) before performing the cleanup. A country with no table is a no-op. Notification failures are non-fatal (best-effort).

### Acting appointments

A President can seat an acting secretary in a vacant seat without a Senate vote (`POST /api/whitehouse/cabinet/acting`, `appointActingCabinetMember()` in `src/lib/cabinet/appointActing.ts`). It is enabled only for the US (`actingAppointmentsEnabled()` in `src/lib/cabinet/actingEligibility.ts`, `CONFIRMS_CABINET = {US}`). It lasts 24 turns (`ACTING_TENURE_TURNS`), only one acting appointment is allowed per seat per presidency (`ACTING_CHARGES_PER_SEAT`, a ledger row that is never refunded), and each acting secretary costs half a point of national approval. A pending nomination is not cancelled by an acting appointment; whoever the Senate confirms replaces the acting secretary at once. An acting secretary cannot displace a sitting confirmed member (409), cannot be a nominee the Senate already rejected for that seat, must be a player character of the country, and cannot fill a seat absent from the current era. The charge is spent before the seat is filled, so a double submit cannot yield two appointments. Expiry is handled by `expireLapsedActingAppointments()` in `src/lib/cabinet/actingExpiry.ts`, called from the nomination lifecycle; the seat then stays open to confirmation only.

### Constants

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
| `ACTING_CHARGES_PER_SEAT` | 1 acting appointment per office per presidency | `src/lib/cabinet/rules.ts` |
| `ACTING_APPOINTMENT_PENALTY` | 0.5 national approval points per acting secretary | `src/lib/country/rules/approvalHoneymoon.ts` (applied in `src/lib/utils/governmentApproval.ts`) |
| `NO_CABINET_PENALTY` | 7.5 approval points when no seat is filled; with a known roster the penalty is `round(7.5 * empty / total, 1 decimal)` | `src/lib/country/rules/approvalHoneymoon.ts` |
| `PERPETUAL_YEAR` | 1775, the "always existed" seat year | `src/lib/cabinet/rosterEra.ts` |

Orders cost 1 cabinet action each and are covered in [Ministerial Orders](./ministerial-orders.md). Position tables above list `yearEnabled` for the US; the UK roster is era-gated the same way through `isSeatActive()`.

### API routes

| Route                                           | Method | Access    | Purpose                                            |
| ----------------------------------------------- | ------ | --------- | -------------------------------------------------- |
| `/api/whitehouse/cabinet`                       | GET    | Any       | All positions with member + active nomination data |
| `/api/whitehouse/cabinet/characters`            | GET    | President | Eligible nominees for nomination modal             |
| `/api/whitehouse/cabinet/nominations`           | POST   | President | Create a nomination                                |
| `/api/whitehouse/cabinet/nominations/[id]/vote` | POST   | Senator   | Cast vote on a nomination                          |
| `/api/whitehouse/cabinet/fire`                  | POST   | President | Remove a confirmed cabinet member                  |
| `/api/whitehouse/cabinet/nominations/[id]/withdraw` | POST | President | Withdraw a pending nomination                  |
| `/api/whitehouse/cabinet/acting`                | POST   | President | Seat an acting secretary in a vacant seat          |

### User interface

`/whitehouse/cabinet` is a legacy route that redirects to `/country/<code>/executive/cabinet` (`src/app/whitehouse/cabinet/page.tsx`). The presidential cabinet client (`src/app/country/[code]/executive/cabinet/PresidentialCabinetClient.tsx`) shows a stats strip with **Positions** and **Pending votes**, a "Principal officers" table of the era's seats (filled seats show the member, vacant seats show "Vacant", open nominations show the nominee), and an "Appoint an acting secretary" action. The nomination modal (`CabinetNominateModal.tsx`) lets the President pick a vacant position and a nominee, a player character or an NPP. Active cabinet nominations also appear in the Congress page Senate tab so senators see pending votes without navigating to the White House. The earlier description of a "Vote in Senate" banner and a per-seat "Fire" button was not re-verified against current components.

## Data

| Collection | Role | Player-visible |
| --- | --- | --- |
| `cabinetNominations` | All nominations. Fields: `countryId`, `positionId`, `nomineeCharacterId`, `nomineeNppId`, `nomineeMode`, `nomineeCharacterName`, `nomineeParty`, `proposedByPresidentId`, `status` (`proposed`, `active`, `confirmed`, `rejected`, `withdrawn`), `votesFor`, `votesAgainst`, `votesAbstain`, `votes` (per senator), `houseVotes*` (VP only), `votingStartedAt`, `votingEndsAt`, `votingEndsOnTurn`, `confirmedAt`, `rejectedAt` | Yes: nominee, status and tallies |
| `cabinetMembers` | Seat holders. Fields: `countryId`, `positionId`, `characterId`, `isNPP`, `nppId`, `characterName`, `party`, `appointedByPresidentId`, `appointedByCharacterId`, `appointedAt`, `confirmedAt`, `acting`, `actingSinceTurn`, `actingExpiresOnTurn`, `ministerialActions`, `lastMinisterialActionResetDay` | Yes |
| `actingAppointmentCharges` | One row per president, seat and presidency; its unique index is the lock on the one-acting-appointment rule | No |
| `cabinetSettings` | Per-seat settings and cooldowns, keyed by position (cooldowns reset when a new member is confirmed) | Yes, in the office controls |
| `characters` | `currentOffice` and `careerHistory` updated on confirmation (US) and on clearing | Yes |
| `electedOfficials` | Read for the President, senators and NPP senators | Yes |
| `notifications` | "Cabinet Nomination", "Cabinet Confirmed", "Cabinet Nomination Rejected", "Cabinet Appointment", "Removed from Cabinet", "Cabinet Resigned", "Acting Appointment Ended" | Yes |

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| Roster per country, with `yearEnabled`, `yearRetired`, `namesByYear`, `succeededBy` | Authored tables | `src/lib/countries/{us,uk,jp}/cabinet/positions.ts` and `src/lib/constants/<country>Cabinet.ts` for the others, aggregated in `src/lib/constants/cabinetMechanics.ts` |
| `appointedWithoutConfirmation` | True only for the US `chief_of_staff` | `src/lib/countries/us/cabinet/positions.ts`, read by `isDirectAppointmentSeat()` |
| `gameState.manuallyEnabledSeats` | Empty; gains `secretary_of_education` when the Department of Education Act passes, and other seats via department-creation bills | `gameState`, written by legislation effects (`src/lib/legislationEffects.ts`) |
| `CONFIRMS_CABINET` | `{US}`: the only country with Senate confirmation and acting appointments | `src/lib/cabinet/actingEligibility.ts` |
| `gameConfig.officeActionBonus` | Per-office action-point bonus map; cabinet bonus stacks on the legislative seat bonus | `gameConfig`, resolved in `src/lib/actions/officeActionBonus.ts` |
| Rate limits | Nominate and vote share `CONGRESS_LIMITS`; fire is 10 requests per 60 seconds per user | `src/lib/api/rateLimit.ts`, route files |

Era variants: seat presence and names depend on the live game year; Education only exists after the legislation-gated split; the UK names change by year. No feature flag gates the cabinet itself.

## Timing

- Nominating (`POST /api/whitehouse/cabinet/nominations`) is immediate and writes a `cabinetNominations` row with `status: active`.
- `processCabinetNominationLifecycle()` (`src/lib/cabinetNominationLifecycle.ts`) runs every turn as the `cabinetNominations` phase in the same parallel group as `billLifecycle`, `stateBillTimers`, `scotusTurn` and `fomcNominations` (`src/simulation/phases/turnPhaseRegistry.ts`).
- Within one run: first NPP senators cast their party-line votes on active nominations that are still open (`votingEndsOnTurn > currentTurn`), then expired votes (`votingEndsOnTurn <= currentTurn + 1`) are closed and resolved, then `expireLapsedActingAppointments()` runs. A nomination therefore closes in the run one turn before its stored end turn, after the NPPs have voted on it in that same run.
- Seats flagged `appointedWithoutConfirmation` (US Chief of Staff) get a zero-length window (`votingEndsOnTurn` equals the current turn), so they resolve in the next lifecycle run through the same install path as a confirmation.
- `clearCabinetOnTransition()` runs when government changes hands, outside the turn phase, and wipes the cabinet before the new government nominates.

```
nominate (turn T)          NPP + player votes accumulate          lifecycle run at T+23
     |                                                                  |
 status: active, ends T+24 ----------------------------------------> recompute tally -> confirmed | rejected
```

## Worked trace

Turn 1,000, 1953 world. A Republican President nominates a Republican player for Secretary of the Treasury (`secretary_of_treasury`, enabled 1775, so the seat is active).

1. The route withdraws any earlier active nomination for that seat, then inserts `status: active` with `votingEndsOnTurn = 1,000 + 24 = 1,024`.
2. Illustrative Senate of 100 seats: 52 Republican NPP, 40 Democratic NPP, 8 Democratic players. On the first lifecycle run each NPP votes: the 52 Republican NPPs match the nominee's party, so For (+52); the 40 Democratic NPPs are the opposite major party, so Against (+40). Three Democratic players vote For, four vote Against, one does not vote.
3. Stored counters: For 55, Against 44, Abstain 0.
4. At the run where `currentTurn + 1 >= 1,024` (turn 1,023) `computeCabinetNominationTally()` recomputes from the stored votes against current seats: For 55, Against 44. `didPass(55, 44)` is `55 > 44`, true. The nominee holds no central bank role, so the bank check does not flip it.
5. The old Treasury row and any other seat the nominee holds are deleted, then a `cabinetMembers` row is inserted with `ministerialActions = 4`, `confirmedAt` set; the seat's setting cooldowns are reset; a career event is pushed; the nomination becomes `confirmed` with the recomputed counters; the President and nominee get "Cabinet Confirmed" notifications.
6. Per-turn consequences: the member earns `CABINET_NI_BONUS` 1.5 national influence (the higher of seat and cabinet tier, not the sum) and starts with 4 ministerial actions, regaining one every 6 turns after spending. If the era roster has 11 appointable seats and the cabinet was empty, the approval penalty falls from 7.5 to `round(7.5 * 10 / 11, 1 decimal)`, which is 6.8.

Had it been 38 to 38 the nomination would be rejected and the seat stays vacant. Had nobody voted (0 to 0) it would also be rejected, since `0 > 0` is false. If the President had instead named the White House Chief of Staff, `votingEndsOnTurn` equals the current turn and the nominee is seated on the next lifecycle run with no vote.

## Edge cases and limits

- A tie or an all-abstain vote fails: `votesFor` must exceed `votesAgainst`. A nomination with no recorded votes is rejected.
- Abstentions and non-voters are excluded from the threshold, so a handful of votes can confirm if the rest abstain.
- The Chief of Staff needs no vote and is not in the line of succession.
- At close, a non-VP nominee who has since taken a central bank role is rejected even if the vote passed.
- A Senate rejection leaves the seat vacant and re-nomination is allowed. Acting appointment cannot install a rejected nominee.
- Firing needs no Senate vote and takes effect immediately.
- NPP-held seats and NPP senators work through the same tables, so an all-NPP Senate still resolves nominations by party lines.
- The Education seat uses `yearEnabled: 9999` and only appears after the Department of Education Act; `secretary_of_health` is named HEW until then.
- No EPA, OMB, UN Ambassador or USTR seats exist.
- The tally cannot exceed the country's current Senate seats even if cached counters drifted.
- Confirming a sitting secretary into a new seat vacates the old seat first; otherwise the one-seat-per-character unique index would make the insert fail every turn and keep the nomination active forever.
- Acting appointments are US only. A confirmed member replaces an acting one at once and carries no acting fields.
- If the year is unknown (`year === null`) the full roster with canonical names is used.

## Invariants

- One live (`active`) nomination per country and seat: unique partial index, tested by "treats a duplicate active-position insert as an existing nomination" in `src/app/api/whitehouse/cabinet/nominations/route.test.ts`.
- One seat per character in a cabinet: enforced by the `cabinetMembers_countryId_characterId_roleSlot` unique index outside the UK and by the delete-before-insert in the lifecycle; tested by "vacates the nominee's existing seat before seating them in the new one".
- One acting appointment per seat per presidency: unique charge ledger (`actingAppointmentCharges`), with the lifecycle test "replaces an acting holder on confirmation, carrying no acting fields, and never refunds the charge". The acting route test only checks delegation to the shared handler, so the charge check itself has no direct test.
- Confirmation is `votesFor > votesAgainst` on the recomputed, seat-weighted tally: tested in `src/lib/cabinetNominationLifecycle.test.ts` (`didPass` cases).
- A transition removes every seat and withdraws every live nomination for the country: tested in `src/lib/cabinetTransition.test.ts`.
- Acting appointments cannot displace a confirmed member: checked in `appointActingCabinetMember()` (409). No direct test.
- Not enforced: that `votesFor`, `votesAgainst` and `votesAbstain` counters equal the sum over `votes`; they are cached counters and the close step recomputes them instead.

## Failure and recovery

- **Stuck nomination.** A confirmed nominee who already holds another seat used to make the insert throw a duplicate-key error on every turn, so the nomination stayed `active` and failed the whole phase. The lifecycle now vacates the old seat first. If a similar stall appears, a data heal sets the nomination to a terminal status and re-seats the member.
- **Cached tally drift.** Counters can exceed the real chamber (de-seated or cross-country NPP votes). The close step recomputes from the stored votes, so repair is a rerun of the phase.
- **Leftover acting appointment.** `expireLapsedActingAppointments()` removes any lapsed row with no country filter, so a country that stops using acting appointments cannot strand an immortal caretaker.
- **Orphaned office state.** If a cleared or expired holder's `currentOffice` still shows a cabinet office, the restore helper resets it from their legislative seat; it skips holders who have since moved on.
- **Missed transition clear.** If a government change did not clear the cabinet, a heal that runs `clearCabinetOnTransition()` for the country repairs it.
- **Failed notifications** are best-effort and never block the confirmation.

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

Related documentation:

- [Congress Leadership](./congress-leadership.md), Senate role in nominations
- [Core Systems](./core-systems.md), Cabinet system overview
- [Technical Architecture](./technical-architecture.md), Collections and API routes

## Tests

- `src/lib/cabinetNominationLifecycle.test.ts`: majority rule, due-turn closing, bank-role rejection, cooldown reset, vacating the old seat, Chief of Staff, country-scoped NPP votes (#2889), acting replacement.
- `src/lib/cabinetTransition.test.ts`: US, UK and IE clearing, nomination withdrawal, notifications, office restore.
- `src/app/api/whitehouse/cabinet/nominations/route.test.ts`: duplicate seat, NPP nominee, batched notification, Chief of Staff, body validation, cross-country NPP.
- `src/app/api/whitehouse/cabinet/acting/route.test.ts` (delegation only), `src/app/api/whitehouse/cabinet/route.test.ts`, `src/app/country/[code]/executive/cabinet/PresidentialCabinetClient.acting.test.tsx`.
- `src/lib/cabinet/actingEligibility.test.ts`, `actingExpiry.test.ts`, `rosterEra.test.ts`, `officeCompatibility.test.ts`, `ministerialActionPool.test.ts`, `settingCooldowns.test.ts`.

Gaps: the vote route (`nominations/[id]/vote`), the fire route, and the withdraw route have no route-level test file; `nppCabinetVote()` randomness (70/30 and 55/45 branches) is not asserted statistically; the NI-bonus non-stacking rule is tested only through the position NI rules, not through a cabinet confirmation.

## Known issues and history

- `clearCabinetOnTransition()` filters US cabinet members and nominations by `positionId` only, with no `countryId`. Position ids overlap across countries (the UK also uses `director_of_intelligence`), so a US government change can remove another country's rows with a matching id. The non-US branch is country-scoped. Unverified in production; a fix is to add `countryId` to the US filter.
- The nomination route's "withdraw any earlier nomination" update also filters on `positionId` and status only, without `countryId`, with the same cross-country overlap risk.
- The earlier version of this page said the Cabinet page showed "all 17 positions"; the client shows the seats active in the live era.
- The earlier version of this page said the Cabinet page had a "Vote in Senate" banner and a per-seat "Fire" button; those labels were not found in the current components.
- History recorded in code comments: Education was auto-enabled in 1980 and is now legislation-gated (operator decision 2026-08-13); the US roster moved from `constants/cabinet.ts` to `src/lib/countries/us/cabinet/positions.ts`; acting appointments gained a one-per-seat-per-presidency ledger so they cannot become unlimited.

Last checked: 2026-10-29, version 1.18.0
