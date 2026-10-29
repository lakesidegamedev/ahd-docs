# Chamber Leadership by Country

Design doc for the shared presiding-officer election framework and its four country
variants: US Speaker of the House, DE Bundestagspräsident, NG National Assembly
presiding officers, and CN CPPCC Chairman / NPCSC Chairman. All four resolve
top-vote-getter-wins on a fixed-duration ballot; they differ in electorate,
eligibility policy, and which collection the winner is written to.

Player guide: [Chamber Leadership](https://www.ahousedividedgame.com/wiki/chamber-leadership)

**Shared eligibility engine:** `src/lib/congress/leadership/rolePolicy.ts`

## Eligibility policies

Every `LeadershipRole` maps to one `RoleEligibilityPolicy` in `POLICY_BY_ROLE`. The
orchestrator, action handlers, and API routes all evaluate the same policy instead of
computing party-slug sets inline.

| Policy kind             | Who may declare / vote                                  |
| ------------------------ | -------------------------------------------------------- |
| `any-seated`              | Every party with at least one seat in the chamber         |
| `largest-single-party`    | Only the chamber's largest single party                   |
| `non-coalition`           | Every chamber party not in the majority bloc               |
| `majority-coalition`      | Every party in the majority bloc (defined, currently unused) |

Role → policy assignment (`POLICY_BY_ROLE`):

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

`buildChamberLeadershipContext()` turns a chamber composition (party, seats,
majority party, majority bloc) into a `ChamberLeadershipContext`. `isPartyEligible()`
and `eligiblePartySlugsFor()` evaluate a policy against that context;
`describeEligibility()` renders the human-readable electorate string used in API
error messages and UI hints.

## Shared election shape

All four variants share one election lifecycle, distinct only in the chamber they
draw from and where the winner lands:

1. **Open:** a fixed-duration ballot opens after the chamber's general-election seats
   reconcile (DE and CN, automatically) or when an admin starts it (NG, see below). Any prior stale nominations (`open`/`voting` status) are marked `failed`.
   The incumbent is auto-nominated if they still hold a seat in the relevant chamber
   AND remain eligible under the role's policy (re-checked every open, since a party
   losing majority status can knock its own incumbent off the ballot).
2. **Vote:** eligible members declare and vote per the role's policy. Plurality wins;
   no majority requirement.
3. **Resolve:** on `isLeadershipElectionClosed()` (deadline hit) or a forced admin
   end, nominations are sorted by `votesFor` descending. The top nomination is marked
   `confirmed`, all other open/voting nominations are marked `failed`, and the
   election singleton transitions to `closed` via `claimStatusTransition()` (atomic,    prevents a concurrent resolver from double-announcing). Empty candidate lists close
   the election with the seat left vacant (`vacateCongressLeadershipRole` for
   DE/CN; NG simply doesn't write an officer).

Election duration is `24 * 60 * 60 * 1000` ms (24h) in every variant
(`ELECTION_DURATION_MS` in each module's `openElection.ts` or `actions.ts`;
`LEADERSHIP_ELECTION_DURATION_MS` in `src/lib/congress/leadership/openElection.ts` for the
majority-gated House and Senate offices). The end is stored as `endsOnTurn = currentTurn + 24`,
so it is 24 turns and freezes when the game is paused. The US Speaker ballot itself runs 24h (see
`congress-speaker.md`).

## US: Speaker of the House

Full mechanics documented in `congress-speaker.md`. 24h ballot, `any-seated`
eligibility (any seated House member may declare and vote, whatever their party; the
majority party usually wins on numbers, not by rule), plurality wins, writes to `congressLeaders` under role `speaker_of_the_house`.

## DE: Bundestagspräsident

**Location:** `src/lib/congress/bundestagspraesident/`

- `triggerBundestagspraesidentElectionAfterReconcile(db, now)` (`openElection.ts`),   called from the Bundestag election resolution path once the AMS
  (Additional-Member-System) reconciliation completes, i.e. the cycle has filled all
  630 seats via direct mandates + list seats. Idempotent: a no-op if an election is
  already `voting` and not expired. Electorate is `getBundestagComposition()`, policy
  is `POLICY_BY_ROLE.speaker_of_the_bundestag` (`any-seated`).
- `resolveBundestagspraesidentElection(db, partyMap, force)` (`resolveElection.ts`),   mirrors `resolveSpeakerElection` exactly: top-vote-getter wins, writes to
  `congressLeaders` under role `speaker_of_the_bundestag`, sends a `DISCORD_COLORS
  .leadership` Discord announcement on a successfully claimed close.

Collections: `bundestagspraesidentElections` (`_id: "current"`),
`bundestagspraesidentNominations`.

## NG: National Assembly presiding officers

**Location:** `src/lib/congress/ngChamberLeadership/`

Two independent roles, one per chamber, each running its own election cycle:

| Role                   | Member chamber (`memberOfficeType`) | Officer written (`officerOfficeType`) |
| ------------------------ | ------------------------------------- | ---------------------------------------- |
| `speaker_ng_reps`        | `house`                                | `speaker`                                 |
| `president_ng_senate`    | `senate`                               | `senatePresident`                         |

Unlike DE and CN, an NG ballot is not opened by a post-election reconcile hook: an admin
starts it through the `start-election` action in `ngChamberLeadership/actions.ts`
(admin only; refused while an election is already `voting` or a previous one is still
resolving). Candidates are House or Senate members who nominate themselves.

Config lives in `NG_ROLE_CONFIG` (`config.ts`), which also defines the collection
names: `ngChamberLeadershipElections` (`_id: role`) and
`ngChamberLeadershipNominations`.

`getNgChamberComposition(db, partyMap, memberOfficeType)` (`composition.ts`) mirrors
`getBundestagComposition` but is scoped per-chamber: it tallies seats from
`electedOfficials` filtered to `officeType: memberOfficeType, countryId: "NG"`, then
runs `computeBlocsForCountry` to get the majority bloc. This scoping matters for
`any-seated` eligibility, the House ballot's electorate is House parties only, the
Senate ballot's is Senate parties only.

`resolveNgChamberLeadershipElection(db, role, force)` (`resolveElection.ts`) differs
from DE/CN in destination: **NG does not write to `congressLeaders`.** It writes the
winner directly into `electedOfficials` under `officeType: cfg.officerOfficeType,
countryId: "NG"` (upserting the presiding-officer record), because that's what the
read-only presiding-officers route already reads. This keeps the NG Leadership tab a
single source of truth instead of joining two collections.

An empty candidate list simply closes the election with no officer write, no
explicit vacate call, since there's nothing in `congressLeaders` to clear.

## CN: CPPCC Chairman and NPCSC Chairman

Two independent chair elections, both drawn from seated NPC (National People's
Congress) delegates via `getNpcComposition()`, but with different eligibility:

| Role          | Location                              | Policy                 | Electorate rationale                                                                 |
| -------------- | --------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `chair_npcsc`   | `src/lib/congress/npcscChair/`           | `any-seated`              | NPC Standing Committee Chairman, any seated NPC party can run.                            |
| `chair_cppcc`   | `src/lib/congress/cppccChair/`           | `largest-single-party`     | The CPPCC advisory body is appointed, not electable, so the game models its chair election as restricted to the largest NPC party (the CCP), reusing the US Majority Leader eligibility shape. |

Both openers (`triggerNpcscChairElectionAfterReconcile`,
`triggerCppccChairElectionAfterReconcile`) and resolvers
(`resolveNpcscChairElection`, `resolveCppccChairElection`) are structurally identical
to the DE Bundestagspräsident pair: 24h ballot, auto-nominate eligible incumbent,
top-vote-getter wins, write to `congressLeaders` under the respective role, atomic
close via `claimStatusTransition`, Discord announcement to country `"CN"`.

Collections: `npcscChairElections` / `npcscChairNominations`,
`cppccChairElections` / `cppccChairNominations`.

Incumbent seat check for both CN roles queries `electedOfficials` with
`officeType: "npcDelegate", countryId: "CN"`, losing an NPC delegate seat drops the
incumbent from re-nomination the same way losing a House seat drops the US Speaker.

## Timing

- **Open (DE):** inside general-election resolution, `reconcileGermanElection` in `src/lib/turn/election/generalResolution.ts` calls `triggerBundestagspraesidentElectionAfterReconcile` once `maybeReconcileBundestag` reports the AMS reconcile done.
- **Open (CN):** the same file calls `triggerNpcscChairElectionAfterReconcile` and `triggerCppccChairElectionAfterReconcile` once no CN `npcDelegate` election for that cycle remains unresolved.
- **Open (NG):** admin action, any time.
- **Close (DE, CN, US):** the `leadershipElections` phase runs `resolveExpiredLeadershipElections` in `src/lib/congress/leadershipElections.ts`, in the batch with the election phases and after `leadershipPartyEligibility`, which vacates majority-gated offices whose holder left the majority party and opens a 24-turn race for them. A ballot is closed when `isLeadershipElectionClosed` is true (current turn at or past `endsOnTurn`, or the wall-clock `endsAt` when no turn is stored).
- **Close (NG):** resolved when the NG leadership route is read after expiry, or by the admin end action, not by the turn phase.
- Each DE, CN and NG route also resolves an expired ballot when read; `claimStatusTransition` makes concurrent resolution safe.

## Edge cases and limits

- **No candidates:** the election closes with the seat vacant (DE and CN call `vacateCongressLeadershipRole`; NG just writes no officer).
- **Ties:** DE, CN and NG resolvers sort by `votesFor` descending only, so equal counts follow stored nomination order; the majority-gated House and Senate offices break ties by earliest nomination (`createdAt`).
- **Incumbent:** auto-nominated only if still seated in the right chamber AND still eligible under the role policy, re-checked every open. CN checks `officeType: "npcDelegate"`.
- **Concurrent resolvers:** only the one that wins `claimStatusTransition` announces and writes.
- **NG scoping:** House and Senate compositions are tallied separately, so a party seated only in the Senate cannot run for House Speaker.
- **`majority-coalition`:** defined in the policy union and implemented by `isPartyEligible`, but no role uses it today.
- **CPPCC:** restricted to the largest NPC party because the real body is appointed, not electable.
- **Seat count:** the Bundestag opener assumes the AMS reconcile has filled all seats (630 in the modern calibration).

### Worked example

DE after a general election: the reconcile fills 630 seats. The opener sets the ballot to `voting` for 24 turns, marks old open nominations `failed`, and auto-nominates the incumbent if they hold a seat and their party has one. Three parties each declare a candidate and members vote 220, 180 and 90. At turn 24 the `leadershipElections` phase confirms the 220 candidate, fails the other two, writes `speaker_of_the_bundestag` to `congressLeaders`, and posts the Discord announcement. If no one had declared, the seat would be vacated instead.

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

## Related systems

- [`congress-speaker.md`](congress-speaker.md), US Speaker mechanics in full, the
  template all four other roles were built to match.
- `src/lib/congress/leadershipElections.ts`, `isLeadershipElectionClosed()`,
  `vacateCongressLeadershipRole()`, shared across all `congressLeaders`-backed roles.
- `src/lib/congress/leadership/electionRoleMap.ts`, `leadershipRoleLabel()`, the
  human-readable label used in Discord announcements.
- `src/lib/turn/atomicClaim.ts`, `claimStatusTransition()`, the atomic close guard
  shared by every resolver in this doc.

Last checked: 2026-10-29, version 1.18.0
