# Party Slate

Technical design for the Party Slate: the national and state party board where leadership assigns players or same-party NPPs to the races in each state or region, and the turn pass that turns those assignments into candidacies.

Player guide: no dedicated wiki page covers the Slate yet. The nearest player page is [Primaries](https://www.ahousedividedgame.com/wiki/primaries), which mentions slate fill for NPPs only.

## Overview

The Party Slate gives party leadership a central board for planning who should run in each state or regional race.

It is a national-party planning and assignment surface, not a separate election system. Slate helps party leadership:

- view every eligible race by state or region
- assign players or same-party NPPs to those races
- persist those assignments across cycles until manually changed
- coordinate candidate movement between same-state races

The player-facing surfaces live under the national party `Slate` tab and each scoped state or regional party `Slate` tab.

## Scope

Slate is designed around subnational and legislative races. Presidential races do not use the Slate board: the assignment route refuses them with "Presidential races do not use the slate assignment board." (`src/app/api/country/[code]/parties/[id]/slate/[electionId]/invitations/route.ts`), and the persistence sync skips them (`syncPersistentSlateAssignments` in `src/lib/turn/npp/slateResponses.ts`).

The board renders as a country map for countries with map support, with a selected-state or selected-region race list beneath it. Scoped state or regional party views render the same race list without the national map. Hover summaries on the map show party presence and race counts.

Each race card shows the race name, cycle, timing and phase context, assigned candidates, the assignment state, the election phase strip, and embedded primary or general results when available. That embedded status data comes from the same shared election display pipeline used on the state and election pages, so Slate does not keep its own election-summary model.

## Rules

| Rule | Value | Source |
| --- | --- | --- |
| NPP loyalty needed to be Slate-compliant | 40 or more | `SLATE_NPP_LOYALTY_THRESHOLD` in `src/lib/slateAssignments.ts` |
| NPP stubbornness allowed to be Slate-compliant | 70 or less | `SLATE_NPP_STUBBORNNESS_THRESHOLD` in `src/lib/slateAssignments.ts` |
| Missing loyalty or stubbornness | treated as 50 | `src/lib/slateAssignments.ts` |
| State or regional leadership bonus | loyalty requirement minus 5, stubbornness ceiling plus 5 | `STATE_SLATE_ASSIGNMENT_BONUS` in `src/lib/slateAuthority.ts` |
| Candidates one party may hold on one race | 3, players and NPPs sharing the same pool | `SLATE_ASSIGNMENT_CAP` in `src/lib/slateAssignmentCap.ts` |
| Statuses that hold a slot | `invited`, `considering`, `accepted`, `filed` | `src/lib/slateAssignmentCap.ts` |
| Fit score shown to the chair | `round((loyalty * 0.65 + (100 - stubbornness) * 0.35) * 10) / 10` | `computeSlateAssignmentScore` in `src/lib/slateAssignments.ts` |
| Incumbent fit score floor | 80 | `decideNPPSlateResponse` in `src/lib/turn/npp/slateResponse.ts` |
| Player assignment fit score | 100 | `buildCharacterSlateCandidate` in the invitations route |

### Compliance formula

An NPP is Slate-compliant when, with the assigner's bonus applied:

```
loyalty >= 40 - loyaltyRequirementReduction
stubbornness <= 70 + stubbornnessAllowanceBonus
```

The bonus is 5 and 5 when the assigner is a `State / Regional Party Chair` or `State / Regional Party Vice Chair` for the race's own state. National chairs and vice chairs, and admins, get 0 and 0 (`getSlateAcceptanceStatBonus` in `src/lib/slateAuthority.ts`). The same thresholds match the discipline-watch mental model.

Worked example. An NPP has loyalty 37 and stubbornness 72.
- National chair assigns: needs loyalty 40 or more and stubbornness 70 or less. Fails both. The chip shows `Likely to Decline`.
- State chair assigns: needs loyalty 35 or more and stubbornness 75 or less. Passes both. The chip shows `Likely to Accept`, and the NPP files next turn.
- An NPP with loyalty 34 fails even under the state bonus.

### Assignment authority

`resolveSlateAuthority` (`src/lib/slateAuthority.ts`) lets these roles manage Slate rows:

- `National Party Chair` and `National Party Vice Chair`, read from `party.chairId` and `party.viceChairId`
- `State / Regional Party Chair` and `State / Regional Party Vice Chair` for races in their own state, read from the `statePartyOrg` document for that state
- admin override (no bonus, no role label)

Everyone else can view but not modify. The national page and the scoped page write the same underlying Slate rows, so assignments and notes stay in sync. Authority checks the seat holder directly, so the acting-chair inheritance in [party-leadership-authority.md](./party-leadership-authority.md) does not apply here. A party whose chair seat is vacant has no national Slate manager unless the vice-chair seat is filled, because the vice-chair is a named role in its own right.

For NPP assignments the route also requires party NPP control (`getPartyNppControlStatus`), and returns 403 with the control error otherwise.

### Player assignments

When a player is assigned, the row is written as `accepted` immediately with fit score 100, the assignment appears on the board, and the player gets an in-game notification naming the assigner and, when applicable, their role label. A player must live in the race's state, belong to the party and not already be filed in another race this cycle; otherwise the route returns 400 or 409.

Slate does not auto-file players. The turn filing pass only handles `candidateType: "npp"` rows (`fileAcceptedSlateRows`), so the player still has to enter the race through the election flow. If they never do, the row simply stays `accepted` and keeps holding one of the three slots.

### NPP assignments

NPP behaviour is relationship-free and fully deterministic (`decideNPPSlateResponse`, `src/lib/turn/npp/slateResponse.ts`). Order of checks:

1. Retired NPP: declined, reason `retired`.
2. Election cooldown still running for this NPP: declined, reason `cooldown`.
3. Incumbent holding the seat: accepted, fit score at least 80.
4. Not Slate-compliant: declined, reason `low_compliance`.
5. Otherwise accepted.

There is no randomness, so the pre-turn chip is exactly what the turn produces.

Before turn resolution Slate shows `Likely to Accept` or `Likely to Decline`, a forward-looking signal. After the turn, an NPP that enters the race shows `Accepted` (and later `Filed`), and one that fails shows `Declined`.

### Statuses

`invited`, `accepted`, `declined`, `withdrawn`, `filed` (type in `src/lib/db/types/recruitmentSlate.ts`). `considering` is deprecated legacy: the resolver no longer produces it, but `processSlateResponses` still reads any pre-existing `considering` row and resolves it to `accepted` or `declined`. Declined and withdrawn rows release their slot. Refusal reasons include `low_compliance`, `retired`, `cooldown`, `in_other_race`, `ineligible_region` and `slate_full`; `low_relationship`, `low_ambition` and `race_priority_mismatch` remain in the type for old rows.

### Persistence

Assignments stay on the board across turns, after election processing and into the next race cycle. `syncPersistentSlateAssignments` hydrates an empty race from the latest slate for the same country, party, state and election type, skipping pairs that cannot have a template. They change only when leadership updates or withdraws them, or when a candidate files.

### Same-state movement

Assigning a candidate to a new same-state race tombstones their other same-state rows as `withdrawn` (ticket #906). For a compliant NPP, `reconcileSlateMoves` and the filing pass can withdraw them from the old race and file them into the target. A compliant slated NPP is not auto-picked into other races or auto-defended into an incumbent seat the chair has moved them off (`slateSuppressesAutoPick`, `slateSuppressesIncumbentDefense` in `src/lib/turn/npp/slateOverride.ts`). Non-compliant NPPs keep their autonomous behaviour. If another same-party candidate is already in the target race, the Slate NPP still joins and creates a contested primary rather than replacing the existing entrant.

### Withdrawing

Withdrawing removes the candidate from the slot rather than leaving a placeholder. A candidate withdrawn from one same-state race is free to be assigned to another.

## Timing

The Slate runs inside the NPP behaviour phase (`src/lib/turn/nppBehavior.ts`), in this order each turn:

1. NPP mortality.
2. Load NPP context.
3. `syncPersistentSlateAssignments`: carry prior-cycle assignments into empty races.
4. `processSlateResponses`: resolve every `invited` or `considering` NPP row to `accepted` or `declined`.
5. `processElectionEntry` (`src/lib/turn/npp/electionEntry.ts`): incumbent defenders re-file first, then `trimOverCapSlates`, then `fileAcceptedSlateRows` (Phase 1a), then the generic party-pool fallback.
6. Endorsements and bill voting.

Responses run before entry so accepted rows are ready to file in the same turn. Slate challengers file after incumbents, so they can still create a same-party primary against the sitting NPP. Both passes are idempotent. Assignments by a chair resolve on the next turn, never immediately.

## Edge cases and limits

- **Cap of 3 per party per race.** The route rejects a fourth with a 409 ("This race already has 3 assigned candidates"). A player who filed their own candidacy does not spend a slot; an active NPP candidacy without a slate row does. If a race is already over the cap, `trimOverCapSlates` withdraws the extras, keeping defending incumbents first, then ballot position by how long they have stood, then oldest invitation. Overflow at filing is marked `slate_full`.
- **Slate locks** when the race is not `upcoming` or `active`, or when the primary has closed. Assigning after the primary would otherwise file straight into the general (409).
- **Already filed.** A `filed` row cannot be reassigned; an existing live row returns "already on the slate".
- **Incumbents always accept** to defend their seat.
- **Retired and cooldown NPPs** always decline regardless of stats.
- **Presidential races** are excluded; they use the regular election flow.
- **Losing the chair seat** does not delete existing rows, because assignments persist until someone with authority changes them. The new holder inherits the board.
- **Worlds without player chairs** behave as if the Slate did not exist: no chair-managed slate means no override, and the sync short-circuits.

## Connections

**Driven by**
- [Parties](./parties.md) and [party-building.md](./party-building.md): chair and vice-chair seats, and state party org leadership, decide who can assign (`resolveSlateAuthority`).
- [NPP system](./npp-system.md): loyalty and stubbornness personality traits decide acceptance (`isNppSlateCompliant`).
- [Elections](./elections.md): open primaries and their phase decide which races appear and when the board locks (`isPrimaryClosed`).

**Affects**
- [Elections](./elections.md): accepted NPP rows become `ElectionCandidate` entries during `processElectionEntry`, creating or contesting primaries.
- Player notifications: assigning a player writes a notification (`notifyAssignedPlayer`).
- [Party influence](./party-influence.md): none directly. Slate is a coordination layer and does not spend influence.

## Design intent

Slate is the party's campaign bench-management board. It answers which races need a candidate, who leadership wants in each, whether an NPP is likely to cooperate, and what the race already looks like. It does not replace candidate filing, election pages or direct player campaign choices.

Last checked: 2026-10-29, version 1.18.0
