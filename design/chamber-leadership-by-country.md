# Chamber Leadership by Country

Design doc for the shared presiding-officer election framework and its four country
variants: US Speaker of the House, DE Bundestagspräsident, NG National Assembly
presiding officers, and CN CPPCC Chairman / NPCSC Chairman. All four resolve
top-vote-getter-wins on a fixed-duration ballot; they differ in electorate,
eligibility policy, and which collection the winner is written to.

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
   reconcile. Any prior stale nominations (`open`/`voting` status) are marked `failed`.
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

Election duration is `24 * 60 * 60 * 1000` ms (24h) for DE/CN, matching the
US Speaker's parity constant. The US Speaker ballot itself runs 24h (see
`congress-speaker.md`).

## US: Speaker of the House

Full mechanics documented in `congress-speaker.md`. 24h ballot, `any-seated`
eligibility restricted in practice to the majority party by the route's own checks,
plurality wins, writes to `congressLeaders` under role `speaker_of_the_house`.

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

## Related systems

- [`congress-speaker.md`](congress-speaker.md), US Speaker mechanics in full, the
  template all four other roles were built to match.
- `src/lib/congress/leadershipElections.ts`, `isLeadershipElectionClosed()`,
  `vacateCongressLeadershipRole()`, shared across all `congressLeaders`-backed roles.
- `src/lib/congress/leadership/electionRoleMap.ts`, `leadershipRoleLabel()`, the
  human-readable label used in Discord announcements.
- `src/lib/turn/atomicClaim.ts`, `claimStatusTransition()`, the atomic close guard
  shared by every resolver in this doc.
