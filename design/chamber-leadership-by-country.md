# Chamber Leadership by Country

## Summary

Design doc for the shared presiding-officer election framework and its four country variants: US Speaker of the House, DE Bundestagspräsident, NG National Assembly presiding officers, and CN CPPCC Chairman / NPCSC Chairman. All four resolve top-vote-getter-wins on a fixed-duration ballot; they differ in electorate, eligibility policy, and which collection the winner is written to.

Player guide: [Chamber Leadership](https://www.ahousedividedgame.com/wiki/chamber-leadership)

**Shared eligibility engine:** `src/lib/congress/leadership/rolePolicy.ts`

## Rules

### Eligibility policies

Every `LeadershipRole` maps to one `RoleEligibilityPolicy` in `POLICY_BY_ROLE`. The orchestrator, action handlers, and API routes all evaluate the same policy instead of computing party-slug sets inline.

| Policy kind             | Who may declare / vote                                  |
| ------------------------ | -------------------------------------------------------- |
| `any-seated`              | Every party with at least one seat in the chamber         |
| `largest-single-party`    | Only the chamber's largest single party                   |
| `non-coalition`           | Every chamber party not in the majority bloc               |
| `majority-coalition`      | Every party in the majority bloc (defined, currently unused) |

Role to policy assignment (`POLICY_BY_ROLE`):

| Role                        | Policy               |
| ---------------------------- | --------------------- |
| `speaker_of_the_house`        | `any-seated`           |
| `president_pro_tempore`       | `largest-single-party` |
| `speaker_of_the_bundestag`     | `any-seated`           |
| `chair_npcsc`                 | `any-seated`           |
| `chair_cppcc`                 | `largest-single-party` |
| `speaker_ng_reps`             | `any-seated`           |
| `president_ng_senate`         | `any-seated`           |
| `majority_leader_house/senate` | `largest-single-party` |
| `majority_whip_house/senate`   | `largest-single-party` |
| `minority_leader_house/senate` | `non-coalition`        |
| `minority_whip_house/senate`   | `non-coalition`        |

`buildChamberLeadershipContext()` turns a chamber composition (party, seats, majority party, majority bloc) into a `ChamberLeadershipContext` (the set of seated party slugs, the largest single party, and the majority bloc). `isPartyEligible()` and `eligiblePartySlugsFor()` evaluate a policy against that context; `describeEligibility()` renders the human-readable electorate string used in API error messages and UI hints. `qualifiesAfterPartySwitch()` answers the narrower question of whether a sitting holder keeps the office after changing party: `any-seated` offices are held on the strength of a seat, so a switch never costs them the office, while party-gated offices are re-checked against the new party.

### Shared election shape

All four variants share one election lifecycle, distinct only in the chamber they draw from and where the winner lands:

1. **Open:** a fixed-duration ballot opens after the chamber's general-election seats reconcile (DE and CN, automatically) or when an admin starts it (NG, see below). Any prior stale nominations (`open`/`voting` status) are marked `failed`. The incumbent is auto-nominated if they still hold a seat in the relevant chamber AND remain eligible under the role's policy (re-checked every open, since a party losing majority status can knock its own incumbent off the ballot).
2. **Vote:** eligible members declare and vote per the role's policy. Plurality wins; no majority requirement.
3. **Resolve:** on `isLeadershipElectionClosed()` (deadline hit) or a forced admin end, nominations are sorted by `votesFor` descending. The top nomination is marked `confirmed`, all other open/voting nominations are marked `failed`, and the election singleton transitions to `closed` via `claimStatusTransition()` (atomic, prevents a concurrent resolver from double-announcing). Empty candidate lists close the election with the seat left vacant (`vacateCongressLeadershipRole` for DE/CN; NG simply doesn't write an officer).

Election duration is `24 * 60 * 60 * 1000` ms (24h) in every variant (`ELECTION_DURATION_MS` in each module's `openElection.ts` or `actions.ts`; `LEADERSHIP_ELECTION_DURATION_MS` in `src/lib/congress/leadership/openElection.ts` for the majority-gated House and Senate offices). The end is stored as `endsOnTurn = currentTurn + 24`, so it is 24 turns and freezes when the game is paused. `isLeadershipElectionClosed` prefers `endsOnTurn` and falls back to the wall-clock `endsAt` only for documents with no stored turn. The US Speaker ballot itself runs 24h (see `congress-speaker.md`).

### US: Speaker of the House

Full mechanics documented in `congress-speaker.md`. 24h ballot, `any-seated` eligibility (any seated House member may declare and vote, whatever their party; the majority party usually wins on numbers, not by rule), plurality wins, writes to `congressLeaders` under role `speaker_of_the_house`.

### DE: Bundestagspräsident

**Location:** `src/lib/congress/bundestagspraesident/`

- `triggerBundestagspraesidentElectionAfterReconcile(db, now)` (`openElection.ts`), called from the Bundestag election resolution path once the AMS (Additional-Member-System) reconciliation completes, i.e. the cycle has filled all 630 seats via direct mandates + list seats. Idempotent: a no-op if an election is already `voting` and not expired. Electorate is `getBundestagComposition()`, policy is `POLICY_BY_ROLE.speaker_of_the_bundestag` (`any-seated`). The incumbent seat check reads `electedOfficials` with `officeType: "bundestag"`.
- `resolveBundestagspraesidentElection(db, partyMap, force)` (`resolveElection.ts`), mirrors `resolveSpeakerElection` exactly: top-vote-getter wins, writes to `congressLeaders` under role `speaker_of_the_bundestag`, marks the winner as having held congress leadership (`markCongressLeadershipHeld`), and sends a `DISCORD_COLORS.leadership` Discord announcement on a successfully claimed close.

Collections: `bundestagspraesidentElections` (`_id: "current"`), `bundestagspraesidentNominations`.

### NG: National Assembly presiding officers

**Location:** `src/lib/congress/ngChamberLeadership/`

Two independent roles, one per chamber, each running its own election cycle:

| Role                   | Member chamber (`memberOfficeType`) | Officer written (`officerOfficeType`) |
| ------------------------ | ------------------------------------- | ---------------------------------------- |
| `speaker_ng_reps`        | `house`                                | `speaker`                                 |
| `president_ng_senate`    | `senate`                               | `senatePresident`                         |

Unlike DE and CN, an NG ballot is not opened by a post-election reconcile hook: an admin starts it through the `start_election` action in `ngChamberLeadership/actions.ts` (admin only; refused while an election is already `voting` or a previous one is still resolving). Candidates are House or Senate members who nominate themselves.

Config lives in `NG_ROLE_CONFIG` (`config.ts`), which also defines the collection names: `ngChamberLeadershipElections` (`_id: role`) and `ngChamberLeadershipNominations`.

`getNgChamberComposition(db, partyMap, memberOfficeType)` (`composition.ts`) mirrors `getBundestagComposition` but is scoped per-chamber: it tallies seats from `electedOfficials` filtered to `officeType: memberOfficeType, countryId: "NG"`, then runs `computeBlocsForCountry` to get the majority bloc. This scoping matters for `any-seated` eligibility, the House ballot's electorate is House parties only, the Senate ballot's is Senate parties only.

`resolveNgChamberLeadershipElection(db, role, force)` (`resolveElection.ts`) differs from DE/CN in destination: **NG does not write to `congressLeaders`.** It writes the winner directly into `electedOfficials` under `officeType: cfg.officerOfficeType, countryId: "NG"` (upserting the presiding-officer record), because that's what the read-only presiding-officers route already reads. This keeps the NG Leadership tab a single source of truth instead of joining two collections. Resolution is two-step: the first claim closes the election and stores a `resolution` object (with its own id and winner), the idempotent officer writes follow, and a second claim stamps `resolution.completedAt` and gates publication.

An empty candidate list simply closes the election with no officer write, no explicit vacate call, since there's nothing in `congressLeaders` to clear.

### CN: CPPCC Chairman and NPCSC Chairman

Two independent chair elections, both drawn from seated NPC (National People's Congress) delegates via `getNpcComposition()`, but with different eligibility:

| Role          | Location                              | Policy                 | Electorate rationale                                                                 |
| -------------- | --------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `chair_npcsc`   | `src/lib/congress/npcscChair/`           | `any-seated`              | NPC Standing Committee Chairman, any seated NPC party can run.                            |
| `chair_cppcc`   | `src/lib/congress/cppccChair/`           | `largest-single-party`     | The CPPCC advisory body is appointed, not electable, so the game models its chair election as restricted to the largest NPC party (the CCP), reusing the US Majority Leader eligibility shape. |

Both openers (`triggerNpcscChairElectionAfterReconcile`, `triggerCppccChairElectionAfterReconcile`) and resolvers (`resolveNpcscChairElection`, `resolveCppccChairElection`) are structurally identical to the DE Bundestagspräsident pair: 24h ballot, auto-nominate eligible incumbent, top-vote-getter wins, write to `congressLeaders` under the respective role, atomic close via `claimStatusTransition`, Discord announcement to country `"CN"`.

Collections: `npcscChairElections` / `npcscChairNominations`, `cppccChairElections` / `cppccChairNominations`.

Incumbent seat check for both CN roles queries `electedOfficials` with `officeType: "npcDelegate", countryId: "CN"`, losing an NPC delegate seat drops the incumbent from re-nomination the same way losing a House seat drops the US Speaker.

## Data

| Collection | Key fields | Written by | Shown to players |
| --- | --- | --- | --- |
| `congressLeaders` | `role`, `characterId`, `characterName`, `party`, `nominatedBy`, `electedAt` | DE, CN and US resolvers; `vacateCongressLeadershipRole` | Yes (leadership tabs, legislature routes) |
| `electedOfficials` | `officeType` (`speaker`, `senatePresident` for NG), `countryId`, `characterId` | NG resolver (upsert); seat records are read for incumbent checks | Yes |
| `bundestagspraesidentElections` | `_id: "current"`, `status` (`voting`, `closed`), `startedAt`, `endsAt`, `endsOnTurn` | opener, resolver | Yes |
| `bundestagspraesidentNominations` | `nomineeId`, `nomineeName`, `nomineeParty`, `nominatedById`, `status` (`open`, `voting`, `confirmed`, `failed`), `votesFor`, `votesAgainst`, `votes`, `createdAt` | declare, vote, resolver | Yes |
| `npcscChairElections`, `npcscChairNominations`, `cppccChairElections`, `cppccChairNominations` | same shape as the DE pair | CN openers, actions, resolvers | Yes |
| `ngChamberLeadershipElections` | `_id: role`, `status`, `startedAt`, `endsAt`, `endsOnTurn`, `resolution` (`id`, `resolvedAt`, `winner`, `completedAt`) | NG actions, resolver | Yes |
| `ngChamberLeadershipNominations` | per-role nominations, same status set | NG actions, resolver | Yes |
| `houseLeadershipElections`, `senateLeadershipElections` and nominations | majority-gated House and Senate offices | `src/lib/congress/leadership/openElection.ts`, `leadershipElections.ts` | Yes |

Reads: `electedOfficials` for chamber composition and incumbent seats, party documents for names, game time for the current turn.

## Configuration

- **Eligibility:** `POLICY_BY_ROLE` in `src/lib/congress/leadership/rolePolicy.ts` is the only place a role's electorate is set; there is no `gameConfig` field or per-era override.
- **Duration:** 24 turns in every variant, set by the constants named in "Shared election shape". No config field changes it.
- **NG roles:** `NG_ROLE_CONFIG`, `NG_ROLES`, `NG_ELECTION_COLLECTION` and `NG_NOMINATION_COLLECTION` in `src/lib/congress/ngChamberLeadership/config.ts`.
- **Country and era gating:** DE and CN ballots open from the general-election resolution path for those countries only, so a world or preset without those elections never opens them. The Bundestag seat count depends on the era (630 in modern presets).
- **Flags:** none specific to this system.

## Timing

- **Open (DE):** inside general-election resolution, `reconcileGermanElection` in `src/lib/turn/election/generalResolution.ts` calls `triggerBundestagspraesidentElectionAfterReconcile` once `maybeReconcileBundestag` reports the AMS reconcile done.
- **Open (CN):** the same file calls `triggerNpcscChairElectionAfterReconcile` and `triggerCppccChairElectionAfterReconcile` once no CN `npcDelegate` election for that cycle remains unresolved.
- **Open (NG):** admin action, any time.
- **Close (DE, CN, US):** the `leadershipElections` phase runs `resolveExpiredLeadershipElections` in `src/lib/congress/leadershipElections.ts`, in the batch with the election phases and after `leadershipPartyEligibility`, which vacates majority-gated offices whose holder left the majority party and opens a 24-turn race for them. A ballot is closed when `isLeadershipElectionClosed` is true (current turn at or past `endsOnTurn`, or the wall-clock `endsAt` when no turn is stored).
- **Close (NG):** resolved when the NG leadership route is read after expiry, or by the admin end action, not by the turn phase.
- Each DE, CN and NG route also resolves an expired ballot when read; `claimStatusTransition` makes concurrent resolution safe.

```
general election resolves
  -> DE: AMS reconcile done -> open Bundestagspräsident ballot (24 turns)
  -> CN: no unresolved npcDelegate election -> open NPCSC and CPPCC ballots
admin start_election -> NG ballot (per chamber)
every turn:
  leadershipPartyEligibility  (vacate and reopen majority-gated offices)
  leadershipElections          (resolve any ballot with currentTurn >= endsOnTurn)
route read after expiry -> resolve (DE, CN, NG), guarded by claimStatusTransition
```

## Worked trace

DE after a general election: the reconcile fills 630 seats. The opener sets the ballot to `voting` for 24 turns, marks old open nominations `failed`, and auto-nominates the incumbent if they hold a seat and their party has one. Suppose it opens at turn 1,000, so `endsOnTurn = 1,000 + 24 = 1,024`. Three parties each declare a candidate and members vote 220, 180 and 90 (`votesFor` on each nomination). At turn 1,024 the `leadershipElections` phase finds `isLeadershipElectionClosed` true (1,024 >= 1,024), sorts nominations by `votesFor` descending, confirms the 220 candidate, fails the other two, upserts `speaker_of_the_bundestag` in `congressLeaders` with `electedAt` set, and posts the Discord announcement once the atomic close succeeds. The `bundestagspraesidentElections` document ends as `status: "closed"`. If no one had declared, the seat would be vacated instead and the election closed with nothing written.

For NG the same votes would end with the winner upserted into `electedOfficials` (`officeType: "speaker"` for the House race) and nothing written to `congressLeaders`.

## Edge cases and limits

- **No candidates:** the election closes with the seat vacant (DE and CN call `vacateCongressLeadershipRole`; NG just writes no officer).
- **Ties:** DE, CN and NG resolvers sort by `votesFor` descending only, so equal counts follow stored nomination order; the majority-gated House and Senate offices break ties by earliest nomination (`createdAt`).
- **Incumbent:** auto-nominated only if still seated in the right chamber AND still eligible under the role policy, re-checked every open. CN checks `officeType: "npcDelegate"`.
- **Concurrent resolvers:** `claimStatusTransition` guarantees only one announces. In DE and CN the `congressLeaders` write happens before the claim, so two racing resolvers may both write the same winner (an idempotent upsert) but only the claim winner announces. NG claims the close first, then writes, then claims completion.
- **NG scoping:** House and Senate compositions are tallied separately, so a party seated only in the Senate cannot run for House Speaker.
- **`majority-coalition`:** defined in the policy union and implemented by `isPartyEligible`, but no role uses it today.
- **CPPCC:** restricted to the largest NPC party because the real body is appointed, not electable.
- **Seat count:** the Bundestag opener assumes the AMS reconcile has filled all seats (630 in the modern calibration).
- **Idempotent open:** DE opens are a no-op while a ballot is `voting` and unexpired.
- **Party switch:** an `any-seated` holder keeps the office after changing party; party-gated holders are vacated if the new party is not eligible.

## Invariants

- At most one ballot per role is `voting` at a time: DE and CN openers are no-ops when one is live, and the NG start action is refused during a live or still-resolving ballot. Covered by opener tests; no database-level constraint.
- A ballot closes exactly once: `claimStatusTransition` is an atomic compare-and-set on `status`. Covered by `src/lib/turn/atomicClaim.test.ts` and `src/lib/congress/leadershipElections.resolveIdempotency.test.ts`.
- Exactly one nomination ends `confirmed` and all others `failed` on a resolved ballot: enforced in the resolvers, tested in each `resolveElection.test.ts`.
- `any-seated`, `largest-single-party` and `non-coalition` eligibility match the table above: tested in `src/lib/congress/leadership/rolePolicy.test.ts`.
- A holder who loses the required seat is vacated: `vacateLeadershipForLostSeats` in `leadershipElections.ts`, tested in `leadershipElections.lostSeats.test.ts`.
- Not enforced: that the tie-break for DE, CN and NG matches the player wiki's "earliest declaration wins" claim (see Known issues).

## Failure and recovery

- **Stuck or unresolved ballot:** every DE, CN and NG route resolves an expired ballot when read, and the turn phase resolves DE, CN, US and the majority-gated offices, so a missed turn resolution is picked up on the next turn or the next read. An admin can force-end a ballot.
- **Half-finished NG resolution:** the close stores the `resolution` on the election first; the officer writes are idempotent; a second claim marks completion. If the process stops in between, the start action is refused ("still resolving") until the end action is retried, which finishes the writes and publication.
- **Double announcement:** prevented by the atomic claim; a lost race returns without announcing.
- **Wrong or missing officer record:** repaired by rerunning the resolution or by a targeted data heal of `congressLeaders` (or `electedOfficials` for NG). A vacant role is also self-healing: the next opened ballot or the lost-seat sweep restores consistency.
- **Failed side effects:** the Discord announcement and the congress-leadership marker are best-effort (their errors are logged and swallowed), so the office is held even if the announcement fails.

## Connections

Driven by:
- Chamber seat composition after general elections (`getBundestagComposition`, `getNpcComposition`, `getNgChamberComposition`, the US House composition) and majority bloc (`computeBlocsForCountry`).
- Party membership of candidates (`isPartyEligible` in `rolePolicy.ts`).
- Admin start actions (NG) and force-end actions.

Affects:
- `congressLeaders` (US, DE, CN) and `electedOfficials` (NG presiding officers), which power the leadership tabs and the legislature routes.
- Action bonuses and party-strength weight attached to the office (see the player guide and [congress-speaker.md](./congress-speaker.md)).
- Discord announcements through `DISCORD_COLORS.leadership` and `leadershipRoleLabel`.
- Majority-gated offices vacated by `reconcileLeadershipPartyEligibility`.

Related systems:
- [`congress-speaker.md`](congress-speaker.md), US Speaker mechanics in full, the template all four other roles were built to match.
- `src/lib/congress/leadershipElections.ts`, `isLeadershipElectionClosed()`, `vacateCongressLeadershipRole()`, shared across all `congressLeaders`-backed roles.
- `src/lib/congress/leadership/electionRoleMap.ts`, `leadershipRoleLabel()`, the human-readable label used in Discord announcements.
- `src/lib/turn/atomicClaim.ts`, `claimStatusTransition()`, the atomic close guard shared by every resolver in this doc.

## Tests

- Policy: `src/lib/congress/leadership/rolePolicy.test.ts`, `reconcilePartyEligibility.test.ts`, `openElection.test.ts`, `electionRoleMap.test.ts`.
- Phase and resolution: `src/lib/congress/leadershipElections.test.ts`, `leadershipElections.resolveIdempotency.test.ts`, `leadershipElections.lostSeats.test.ts`, `leadershipRaceGuard.test.ts`.
- DE: `src/lib/congress/bundestagspraesident/resolveElection.test.ts`.
- CN: `src/lib/congress/npcscChair/actions.test.ts`, `resolveElection.test.ts`; `src/lib/congress/cppccChair/actions.test.ts`, `resolveElection.test.ts`.
- NG: `src/lib/congress/ngChamberLeadership/actions.resolution.test.ts`, `resolveElection.test.ts`.
- Atomic close: `src/lib/turn/atomicClaim.test.ts`.
- Gaps: no test file for the DE actions or openers, none for NG `composition.ts`, and none that asserts tie-breaking order for DE, CN or NG.

## Known issues and history

- **Tie-break mismatch:** the player wiki says ties go to the earlier declaration in every country. In code only the majority-gated House and Senate offices sort by `createdAt`; DE, CN and NG sort by `votesFor` descending alone, so a tie falls back to the database's return order, which is usually insertion order but not guaranteed.
- **NG opening:** the player wiki says each ballot opens once seats are finalised after a general election. NG ballots are opened only by an admin `start_election` action.
- No dated change history is recorded in this document.

Last checked: 2026-10-29, version 1.18.0
