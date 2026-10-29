# Caucuses

## Summary

Caucuses are opt-in sub-blocs inside a national party. They give players a way to organize around a shared line, pool caucus funds, run caucus-specific whips, and build a more disciplined internal faction without creating a separate party.

They are a **national-party-only** feature. State and regional party chapters do not own caucuses.

Player guide: [Caucuses](https://www.ahousedividedgame.com/wiki/caucuses)

Design intent. Caucuses are meant to create:

- internal party faction play
- smaller whip blocs inside a large national party
- treasury and patronage decisions at a sub-party level
- relationship-driven NPP faction building

They are not meant to replace the national party itself, and they do not create separate ballot lines or separate election parties.

## Rules

### Core structure

Each caucus has:

- a `name`
- a `description`
- an optional `motto`
- a `color`
- a `Chair`
- a `Vice Chair`
- a caucus `treasury`
- a caucus `Tax` rate from `0%` to `5%` (`taxRate`, validated `min(0).max(5)` in the caucus routes under `src/app/api/country/[code]/parties/[id]/caucuses/`)
- a roster of player and NPP members
- a set of caucus policy positions

The current player-facing surface lives inside the national party page under the `Caucuses` tab.

### Constants

| Rule | Value | Source |
| --- | --- | --- |
| Min chair-NPP relationship to recruit | 60 (`CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP`) | `src/lib/constants/partyOrg.ts` |
| Recruit cooldown, caucus-wide | 12 turns (`CAUCUS_NPP_RECRUIT_COOLDOWN_TURNS`); wall-clock fallback `CAUCUS_NPP_RECRUIT_COOLDOWN_MS` = 12 hours for memberships without a `joinedAtTurn` | `src/lib/constants/partyOrg.ts` |
| Min chair-NPP relationship to stay | 20 (`CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP`) | `src/lib/constants/partyOrg.ts` |
| Relationship decay | 0.1 per turn toward 0 (`NPP_RELATIONSHIP_DECAY_PER_TURN`), rounded to one decimal | `src/lib/constants/partyOrg.ts`, `src/lib/turn/partyOrg/caucusRelationshipMaintenance.ts` |
| Tax rate | 0 to 5 percent of each active member's per-turn campaign-fund income, rounded down (`Math.floor`) | `src/lib/turn/caucusTax.ts` |
| Health recent window | 12 (`CAUCUS_RECENT_WINDOW_TURNS`, module-private) | `src/lib/caucus/caucusHealth.ts` |
| At-risk warning buffer | 10 above the retention floor, so under 30 (`CAUCUS_WARNING_BUFFER`, module-private) | `src/lib/caucus/caucusHealth.ts` |
| Exit risk labels | Critical below 20, Elevated below 25, Watch from 25 to under 30 | `classifyExitRisk` in `src/lib/caucus/caucusHealth.ts` |
| Chair election length | Same as the national party election, `NATIONAL_ELECTION_DURATION_TURNS` = 72 turns, when no national election exists to copy | `src/lib/nationalPartyElectionConstants.ts`, `src/lib/caucusChairElections.ts` |
| Name | 2 to 80 characters | caucus routes |
| Description | up to 500 characters | caucus routes |
| Motto | up to 120 characters | caucus routes |
| Colour | `#RRGGBB` hex | caucus routes |
| Caucuses per member | 1 (one active caucus per player or NPP) | `members/route.ts` under the caucus routes |
| One-party-state divergence weight | `CAUCUS_COHESION_WEIGHT` = 0.6 | `src/lib/onePartyState/factionDivergence.ts` |

### Sub-tabs

Each caucus currently exposes five sub-tabs:

- `Overview`
- `Roster`
- `Whip`
- `Elections`
- `Chair's Office` (Chair only)

### Membership

**Player membership.** Players can join or leave caucuses through the caucus membership flow. The caucus roster shows both player and NPP members.

**NPP membership.** NPPs can be recruited into a caucus by the `Caucus Chair` through the `Chair's Office`. Current recruitment rules:

- NPP must be in the same party
- NPP must not be retired
- NPP must not already belong to another caucus
- the Chair must have at least `60` relationship with the NPP
- the caucus must not be on its 12-turn recruitment cooldown

The recruit menu intentionally hides NPPs already in another caucus and NPPs below the relationship threshold. So the picker only surfaces same-party NPPs that are actually in range to be recruited once the caucus is off cooldown.

**Caucus-wide recruit cooldown.** Successful NPP recruitment triggers a **caucus-wide** cooldown of 12 turns (12h at standard cadence, freezes if the game is paused). The UI always shows one of two recruitment states: `Recruitment Available` or `Xh Ym cooldown`. This cooldown belongs to the caucus as a whole, not to an individual NPP.

### Relationship maintenance

Caucus NPP membership is relationship-sensitive over time.

**Per-turn decay.** Every stored NPP-to-character relationship drifts `0.1` toward neutral each turn: positive scores move down toward `0`, negative scores move up toward `0`. This keeps one-off relationship gains from becoming permanent access to caucus control, Slate leverage, or other NPP systems.

**Retention threshold.** After the decay pass, caucus NPPs are checked against the current Chair. If an NPP's relationship with the Chair falls below `20`, the NPP automatically leaves the caucus during turn upkeep (membership `status` becomes `left`, and the NPP's `factionId` is cleared). This is intentionally much lower than the `60` recruit threshold, so caucus membership is harder to earn than it is to maintain.

### Caucus treasury

Caucuses maintain their own treasury and can tax caucus funds at `0-5%`. Current caucus treasury controls in `Chair's Office`:

- edit caucus `Tax`
- send caucus funds to active caucus member players
- transfer caucus funds back to the parent national party treasury

These actions create treasury audit rows so caucus spending remains visible in the broader party record.

### Caucus whip

Each caucus has its own `Whip` sub-tab. The caucus whip surface mirrors the main party `Whip Room`, but its scope is limited to caucus members only. Current behavior:

- `Players` and `NPPs` sub-tabs
- player `Soft` and `Hard` whip modes
- bill-by-bill whipping
- leadership whipping
- no standing-order-based caucus whip behavior in the current intended flow

See [party-whips.md](./party-whips.md) for the broader whip model.

### Caucus chair elections

Each caucus has an `Elections` sub-tab where active caucus members can view the active or most recent `Caucus Chair` election, declare candidacy, withdraw candidacy, and vote for the next caucus chair.

**Schedule.** Caucus chair elections run on the same cadence as the parent party's national leadership cycle. In practice, caucus elections are anchored to the active national `Chair` election window for the same party and country (same `startTurn`, `endTurn` and `durationTurns`), so caucus leadership turns over alongside party leadership.

**Participation rules.**

- only active caucus player members may run or vote
- the same new-character cooldown used for party leadership elections applies (`isInNewCharacterCooldown`)
- NPPs do not run for or vote in caucus chair elections

**Resolution.** When the election ends:

- the winning player becomes the new caucus `Chair`
- the outgoing chair's caucus membership role is demoted back to `member`
- the winner's caucus membership role is promoted to `chair`
- the caucus records `lastElectedTurn`, increments `termsServed`, and sets `nextElectionTurn` to the current turn plus 72

Ties break toward the earliest declaration timestamp, matching the broader party leadership election expectation. The Vice Chair seat is not touched by an election.

### Chair's Office

The caucus `Chair's Office` is only visible to the current caucus `Chair`. It is where caucus leadership manages:

- caucus identity fields (`name`, `motto`, `description`, `color`)
- caucus `Tax`
- caucus treasury sends and transfers
- NPP recruitment into the caucus

The NPP recruitment panel shows the NPP's current relationship with the Chair, the NPP's current office if any, and caucus-wide recruitment cooldown state.

### Caucus health dashboard

Party members get caucus-health visibility in two places:

- a high-level `Caucus Health` summary in the national party `Analytics` tab
- a richer per-caucus health view inside each caucus `Overview`

The health pass currently surfaces:

- a simple `Healthy`, `Strained`, or `Fragile` label for each caucus
- recent joins, leaves, and forced exits over the latest short window
- current caucus-whip defiance counts
- whether a caucus chair election is active
- NPP members who are drifting close to the Chair relationship exit threshold

Label precedence, first match wins: Fragile for vacant Chair, any Critical NPP, any forced exit in the last 12 turns, or 3 or more active whip defiance cases; Strained for any at-risk NPP, any voluntary leave in the window, any defiance case, or an election in progress; otherwise Healthy.

### Policy positions

Caucuses can define internal policy positions. These positions are intended to signal what the caucus stands for inside the party and help support factional identity beyond simple membership. Each position has a `topic`, `stance`, `note`, a `weight` of `core` or `secondary`, and a `sortOrder`.

## Data

| Collection | Fields that matter | Written by | Shown to players |
| --- | --- | --- | --- |
| `caucuses` | `slug`, `previousSlugs`, `countryId`, `partyId`, `name`, `description`, `motto`, `color`, `chairId`, `viceChairId`, `whipMode`, `treasury`, `taxRate`, `lastElectedTurn`, `nextElectionTurn`, `termsServed`, `discordInviteUrl`, `disbandedAt` | caucus routes, `caucusTax.ts` (treasury), `caucusChairElections.ts` (chair, term fields) | Yes |
| `caucusMemberships` | `caucusId`, `memberType` (`character` or `npp`), `memberId`, `role` (`chair`, `vice-chair`, `whip`, `member`), `status` (`invited`, `active`, `left`, `removed`), `joinedAt`, `joinedAtTurn`, `leftAt`, `complianceScore` | members routes, relationship maintenance, election resolution, cleanup | Yes (roster) |
| `caucusPolicyPositions` | `topic`, `stance`, `note`, `weight`, `sortOrder` | positions routes | Yes |
| `caucusChairElections` | `status` (`voting`, `completed`), `startTurn`, `endTurn`, `durationTurns`, `winnerId`, `founding` | `createMissingCaucusChairElections`, `processCompletedCaucusChairElections` | Yes |
| `caucusChairCandidates`, `caucusChairVotes` | candidacy and ballots per election | election enter and vote routes, cleanup | Yes (tallies) |
| `nppRelationships` | `relationshipScore` per chair and NPP pair | player relationship actions, decay in maintenance | Yes (to the Chair) |
| `npps` | `factionId` (caucus id or null), `funds` | membership changes, maintenance, tax | Partly |
| `characters` | campaign funds debited by the tax (`funds`, or `currencyBalances.campaign` under forex) | `caucusTax.ts` | Yes (own funds) |

Treasury sends and transfers also write treasury transaction rows through `emitTreasuryTransaction`, and the tax pass writes financial transaction log entries. Health labels are derived at read time and are not stored.

## Configuration

- **Constants:** all values in the Rules table are code constants in the files named there. There are no `gameConfig` fields for caucuses.
- **Per caucus, set by its Chair:** `taxRate` (0 to 5), identity fields, policy positions.
- **`forexEnabled`:** read from game state by the tax pass; selects which character field is debited (`currencyBalances.campaign` when on, `funds` when off). Default is whatever the world's game state carries.
- **Scenario presets:** the tax pass reads the world's reset preset (`getGameStatePresetOrDefault`) so historical worlds tax against their own money scale. No preset changes the caucus rules themselves.
- **One-party states:** `CAUCUS_COHESION_WEIGHT` = 0.6 in `src/lib/onePartyState/factionDivergence.ts` weights caucus cohesion in a member's divergence score.

## Timing

- **`caucusTax` phase** runs in the party-and-treasury block of the turn (`src/simulation/phases/turnPhaseRegistry.ts`) alongside `treasuryTurn`, and must not overlap NPP fund generation because both increment NPP funds. Each active caucus with a positive `taxRate` taxes every active player and NPP member once per turn.
- **`nppRelationshipMaintenance` phase** runs later in the same turn, after `emptyPartyCleanup` and `coalitionDisbandVotes` and before NPP behavior. It first decays every stored NPP-to-character relationship, then removes active NPP caucus members whose decayed score with the current Chair is under 20. Order matters: the retention check uses the already-decayed score, not last turn's.
- **Chair elections** are created and resolved inside the `nationalPartyElections` phase: `processNationalPartyElections` finishes the national work, then calls `processCaucusChairElections`, which resolves ended caucus elections first (`endTurn <= currentTurn`) and then opens missing ones. A caucus Chair race therefore opens and closes with the national Chair race for the same party and country.
- **Health labels** are not stored. They are computed when the page or analytics tab is read, from memberships, whip defiance and elections.

```
turn:
  fundGeneration ........ player and NPP funds generated
  caucusTax || treasuryTurn   (parallel; before nppFundGeneration)
  nationalPartyElections  -> national create/resolve -> caucus chair resolve, then open
  ... emptyPartyCleanup -> coalitionDisbandVotes
  nppRelationshipMaintenance   decay, then retention check
```

## Worked trace

**Tax.** A caucus has `taxRate` 3. An active player member's projected per-turn campaign income, converted to local currency, is 1,234. Tax is `floor(1,234 × 3 / 100)` = `floor(37.02)` = 37. The member's funds (`funds`, or `currencyBalances.campaign` under forex) must be at least 37 or the member is skipped. If the guarded debit lands, `caucuses.treasury` gains 37. A member who has 30 is skipped and the treasury gains nothing for them.

**Retention.** An NPP is recruited at relationship 70 and nothing tops it up. Each maintenance pass subtracts 0.1 and rounds to one decimal, so after `n` passes the score is `70 − 0.1n`.

- 30.0 at pass 400: not yet at risk (the filter is strictly under 30).
- 29.9 at pass 401: enters the at-risk list as Watch.
- 24.9 at pass 451: Elevated (under 25).
- 19.9 at pass 501: under 20. Because decay runs first and the retention check uses the decayed score, the membership is set to `left` on this same pass, so the Critical label is normally only seen for NPPs whose score was lowered by something other than decay.

Any gain from relationship-building actions pushes that clock back by 10 passes per point.

## Edge cases and limits

- A missing relationship record counts as 0, below the retention floor, so a neglected NPP link dissolves on the next maintenance pass.
- A caucus with no `chairId` is skipped by the retention check, so NPP members of a chairless caucus are not removed until a Chair is seated.
- When a member leaves, is banned, or is deleted, `cleanupCaucusParticipationForCharacters` withdraws their candidacy, deletes their votes, closes their membership and clears any Chair or Vice Chair seat they held. The caucus then reads as Fragile (vacant Chair).
- Retention follows the current Chair. A new Chair inherits the NPP members but their relationship is measured against the new Chair, so a Chair change can trigger exits.
- Members who cannot afford their tax that turn are skipped and the treasury is not credited for them, so no member is pushed into negative funds. A guarded debit that fails to modify the payer also credits nothing.
- A member with zero or negative projected income, or a tax that rounds down to 0, is skipped.
- The 12-turn cooldown is per caucus, not per NPP, and freezes when the game is paused (turn-based, with the millisecond value only a fallback).
- NPPs never run or vote in Chair elections. Ties go to the earliest declaration.
- The 60 versus 20 gap is deliberate: recruiting is hard, keeping is easy, so one big meeting does not lock in a bloc, but regular upkeep does.
- If the national Chair election window is not active when a caucus election is created, the caucus election uses the current turn plus 72 instead of copying it.

## Invariants

- No member's campaign funds go negative from the tax. Enforced by the pre-check and a guarded `$gte` debit, tested in `src/lib/turn/caucusTax.test.ts`.
- The caucus treasury is credited only by debits that actually landed. Tested in `caucusTax.test.ts`.
- Retention uses the post-decay score. Tested in `src/lib/turn/partyOrg/caucusRelationshipMaintenance.test.ts`.
- One active caucus per member: enforced in the members route (membership check), no test named for the database-level guarantee and no unique index asserted here.
- At most one `voting` chair election per caucus: enforced by `createMissingCaucusChairElections` skipping caucuses already in the active set; not enforced by a database constraint.
- Tax rate stays within 0 to 5: enforced by the route schema only, not at the database or in `caucusTax.ts`.

## Failure and recovery

- **Orphaned membership or seat after a ban or deletion:** `cleanupCaucusParticipationForCharacters` clears the seat and candidacy; a caucus left chairless is shown as Fragile and is repaired by the next Chair election.
- **Missing chair election for a caucus:** `createMissingCaucusChairElections` runs every turn and opens any that are absent, so a skipped creation heals on the next turn.
- **Election pass errors:** `processCaucusChairElections` catches and logs errors and returns zeros rather than failing the national election phase, so a caucus election problem does not block national party elections. The pass retries the next turn.
- **Tax pass partial failure:** missing characters or NPPs are skipped silently so one bad row does not stop the pass. Wrong treasury or fund totals are repaired by a targeted data correction using the treasury audit rows.
- **Stale NPP faction pointers:** the maintenance update only clears `factionId` where it still equals the caucus, so it cannot wipe a newer membership.

## Connections

Driven by:
- Party membership and the national party Chair schedule (`src/lib/caucusChairElections.ts`).
- NPP relationship scores, which are raised by player relationship actions (see `src/lib/capital/actions.ts`) and decay in `caucusRelationshipMaintenance.ts`. See [party-influence.md](./party-influence.md).
- Member campaign-fund income (`projectCharacterGeneration` and `projectNppGeneration` in `src/lib/utils/fundGeneration.ts`), the base the tax applies to.
- Whip defiance snapshots (`buildWhipDefianceSnapshots` in `src/lib/partyWhips/whipDefiance.ts`), see [party-whips.md](./party-whips.md).

Affects:
- Caucus treasury and the parent party treasury through `emitTreasuryTransaction` audit rows (sends and transfers).
- NPP `factionId`, which other NPP systems read (Slate leverage, NPP behavior).
- Party analytics `Caucus Health` summary (`src/lib/parties/queries/analytics.ts`).
- Caucus whips on bills and leadership votes for members only.
- Member divergence scoring in one-party states: a member's score takes `CAUCUS_COHESION_WEIGHT` = 0.6 from their caucus (`src/lib/onePartyState/factionDivergence.ts`).

Related docs:
- [party-building.md](./party-building.md)
- [party-whips.md](./party-whips.md)
- [party-influence.md](./party-influence.md)

## Tests

- `src/lib/turn/caucusTax.test.ts`: forex and non-forex debit fields, frozen-local income, skip on insufficient funds, no credit on failed debit, NPP per-turn generation.
- `src/lib/turn/partyOrg/caucusRelationshipMaintenance.test.ts`: decay, ejection below 20, retention above the floor.
- `src/lib/caucus/caucusHealth.test.ts`: churn summary, election status, at-risk retention, defiance loading.
- `src/lib/caucus/cleanupCaucusParticipationForCharacters.test.ts`: leave, ban and delete cleanup.
- `src/lib/caucusChairElections.test.ts`: election creation and resolution.
- Route tests under `src/app/api/country/[code]/parties/[id]/caucuses/`: `route.found.test.ts`, `[slug]/route.test.ts`, `members/route.test.ts`, `election/enter/route.test.ts`, `election/vote/route.test.ts`, `send/route.test.ts`.
- Gaps: no test file for the `transfer` route, none that pins the exact label precedence order for every branch, and none for the `CAUCUS_COHESION_WEIGHT` use inside caucus code.

## Known issues and history

- The health "recent window" is named in turns (`CAUCUS_RECENT_WINDOW_TURNS` = 12) and shown as "turns", but `buildPartyCaucusHealthSnapshot` computes its cutoff as 12 wall-clock hours (`Date.now()` minus 12 hours). At the standard cadence these match; during a pause or a changed cadence they do not, and the window does not freeze on pause the way the recruit cooldown does.
- Because decay runs before the retention check in the same pass, an NPP can drop from Watch or Elevated straight to removed without the Critical label ever being shown.
- The `Vice Chair` seat is stored (`viceChairId`) and cleared on member cleanup, but no caucus election, caucus route or maintenance code writes a new value to it.
- No dated change history is recorded in this document.

Last checked: 2026-10-29, version 1.18.0
