# Party Whips

## Summary

Technical design for the whip system, which lets parties and caucuses coordinate both player and NPP voting without turning every vote into a hard override.

Player guide: [Voting & Whips](https://www.ahousedividedgame.com/wiki/voting-and-whips)

Whips currently live on:

- national party `Whip Room`
- state / regional party `Whip Room`
- caucus `Whip` tab
- bill detail `Whip Panel`

Whips are stored in `billWhips` and can target either `character` audiences (players) or `npp` audiences.


## Rules

| Rule | Value | Source |
| --- | --- | --- |
| NPP whips per target and chamber (national, state, caucus), per phase | 2 attempts, then "Maximum 2 whip attempts per bill/chamber reached" | `src/app/api/country/[code]/parties/[id]/whip/route.ts`, `.../region/[id]/party/[partyId]/whip/route.ts`, `.../caucuses/[slug]/whip/route.ts` |
| Player whips per target | one `soft` and one `hard`, each at most once | national whip route, character branch |
| Hidden NPP success roll, base chance | 55 | `WHIP_SUCCESS_BASE_CHANCE` in `src/lib/partyWhips/whipSuccess.ts` |
| Loyalty weight | `round(loyalty * 0.35)` added | `WHIP_LOYALTY_WEIGHT` |
| Stubbornness weight | `round(stubbornness * 0.18)` subtracted | `WHIP_STUBBORNNESS_WEIGHT` |
| Mode bonus | soft +6, hard +15 | `WHIP_MODE_BONUS` |
| Final chance clamp | 40 to 95 percent | `WHIP_MIN_SUCCESS_CHANCE`, `WHIP_MAX_SUCCESS_CHANCE` |
| Statecraft bonus | `round((statMultiplier(statecraft) - 1) * 50)` points; `statMultiplier = 1 + (stat - 5.5) * 0.04`, so 0 at the neutral stat 5.5 and about plus or minus 9 at the extremes (`EFFICACY_PIVOT`, `EFFICACY_SLOPE` in `src/lib/stats/statsConstants.ts`) | `statecraftWhipBonus` in `src/lib/partyWhips/whipSuccess.ts` |
| Missing loyalty or stubbornness | treated as 50 | `src/lib/partyWhips/whipSuccess.ts`, `src/lib/turn/npp/crossPressure.ts` |
| Party whip force in turn-time voting | hard 60, soft 30 | `PARTY_WHIP_BASE_BY_MODE` in `src/lib/turn/npp/crossPressure.ts` |
| Caucus whip force (defined, not wired in the autonomous path) | table is hard 80, soft 40, free 0, but `computeWhipForce` reads only the soft value (40) whatever the mode; core-position bonus 20 | `CAUCUS_WHIP_BASE_BY_MODE`, `CORE_POSITION_BONUS` in `src/lib/turn/npp/crossPressure.ts` |
| Compliance multiplier | `loyalty/100 * 0.7 + (1 - stubbornness/100) * 0.3` | `complianceMultiplier` in `crossPressure.ts`, weights `COMPLIANCE_LOYALTY_WEIGHT` 0.7 and `COMPLIANCE_PLIABILITY_WEIGHT` 0.3 in `src/lib/turn/npp/complianceRules.ts` |
| Party-line lean with no whip | `20 * complianceMultiplier` for same-party-as-sponsor NPPs | `PARTY_LINE_BIAS_BASE`, `computePartyLineForce` |
| Cabinet discipline pressure on whip force | multiplier `1 + bonus`, bonus between 0 and 0.2 | `applyCabinetWhipPressure` in `src/lib/resetCabinet/rules/gameplay.ts` |
| Force range and verdict | each force clamped to -100..100; sum above 5 is for, below -5 is against, otherwise abstain | `VERDICT_THRESHOLD`, `verdictFromForces` in `src/lib/turn/npp/crossPressure.ts` |
| Local bill force weights | ideology 1, whip 1, district 1.35, donors 0.65 | `LOCAL_BILL_FORCE_WEIGHTS` in `src/lib/turn/npp/stateBillVoting.ts` |
| Statecraft use growth per whip | `USE_GROWTH_INCREMENT` 0.03 XP | `src/lib/stats/statsConstants.ts` |
| Route rate limit | 20 requests per 60 seconds per user, on each of the national, state and caucus whip routes | the three whip `route.ts` files |

### Who can whip

#### National party

The `National Party Chair`, `Vice Chair`, an admin, or a chamber leader of the party (Speaker, Majority or Minority Leader, Majority or Minority Whip, President Pro Tempore) can issue whips. Targets are bills and, where the country uses them, leadership elections, PM appointment votes, no-confidence votes, cabinet nominations, SCOTUS nominations, Speaker vacate motions and impeachment votes. German chambers refuse leadership-election whips and use PM appointment or no-confidence whips instead. NPP-audience whips also require the party's NPP control to be unlocked (`getPartyNppControlStatus`).

#### State / regional party

Only the State Party Chair or Vice Chair can issue whips, for NPPs in their own state. Targets are limited to bills in the sub-national legislature, cabinet nominations and their own state's governor impeachment.

#### Caucus

The Caucus Chair, an admin or a chamber leader can issue caucus whips. They are scoped to caucus members only and behave like a smaller internal whip bloc inside the national party.

### Player vs NPP whips

#### Player whips

- `soft`: notification and guidance only ("Party vote recommendation").
- `hard`: immediate forced vote write at issue time, snapshotted so it can be undone (`applyPlayerWhipToBill` and siblings in `src/lib/congress/applyPlayerWhip.ts`). The player may later change their vote; the change shows as defiance.

A hard player whip reports how many players were overridden and how many were already aligned.

#### NPP whips

NPP whips are intentionally different from player whips. They interact with autonomous NPP behaviour, and soft and hard affect NPPs differently.

**Hard NPP bill whip.** At issue time `applyWhipVotesToBill` (`src/lib/congress/applyWhipVotes.ts`) walks every party NPP in the chamber that is not already voting the whip direction. For each:

1. Compute the NPP's autonomous cross-pressure verdict with this whip applied.
2. Roll 1 to 100 against the hidden success chance (formula below).
3. Roll at or below the chance: the vote is written in the whip direction.
4. Roll above: the vote is written as the cross-pressure verdict (which may still agree with the whip). 

Override ballots (US veto override, JP Shugiin override) coerce an abstain into `against`. NPPs who had already voted are re-resolved and their old tally is subtracted first.

```
chance = clamp(55 + round(loyalty * 0.35) - round(stubbornness * 0.18)
               + modeBonus + statecraftBonus, 40, 95)
```

The curve is deliberately generous so same-party NPPs usually comply, while stubborn or disloyal NPPs still have a real chance to balk.

**Soft NPP bill whip.** Does nothing at issue time (`applyWhipVotesToBill` returns immediately for `soft`). The whip document is stored, and later, when NPPs vote autonomously in the turn, it adds weaker pressure (30 instead of 60) into the cross-pressure verdict. Soft whips are meant to tip close calls, not dominate neutral NPPs.

### Autonomous bill-vote pressure

When an NPP votes on a bill in the turn (`src/lib/turn/npp/billVoting.ts` for federal bills, `src/lib/turn/npp/stateBillVoting.ts` for local bills), the verdict is the clamped sum of four forces: ideology, whip, district (home-state or home-region sentiment) and donors. Whip pressure follows these rules:

- `hard` party whips use magnitude 60, `soft` use 30, each scaled by the compliance multiplier and any Cabinet discipline bonus.
- State whips take precedence over national: `resolveWhipForNPP` (`src/lib/turn/npp/whipResolution.ts`) picks the state whip for the NPP's home state first, and counts a national whip **only when that state party has no chair or vice chair** seated. Within a tier the latest attempt wins, then the latest timestamp, then hard over soft.
- Caucus whips apply only through the immediate issue-time path. The autonomous resolver passes `caucusWhip: null`, so a caucus whip does not add turn-time pressure, even though `computeWhipForce` knows how to price one.
- With no whip at all, co-partisan NPPs lean toward their own sponsor's bill by `20 * complianceMultiplier` (a government's goal bills use a soft whip instead).
- Turn-time voting skips NPPs that already have a vote on the bill, so a whip issued first is not overridden by the turn.

### Leadership elections

US congressional leadership elections are **player-only** in live NPP behaviour. The turn processor counts `speakerVotes` as a constant 0 (`src/lib/turn/nppBehavior.ts`), so NPPs never vote in Speaker, House or Senate leadership races on their own. Whip helpers for NPP leadership votes (`applyWhipVotesToLeadership`) still exist and a chair's hard whip writes NPP leadership votes directly with no roll (see Edge cases), but autonomous NPP congressional leadership voting is not an active simulation system.

### Defiance

Whip history is a **defiance watch** (`src/lib/partyWhips/whipDefiance.ts`), not a permanent compliance ledger.

An entry appears only when the whip exists, the target has cast a vote, and that vote currently contradicts the whip. It clears when the target changes back into compliance, the whip becomes irrelevant, or the underlying target closes or is withdrawn. For bills, only whips from the current phase count: a veto-override ballot ignores whips issued before it began (`src/lib/congress/billWhipPhase.ts`).

### Access patterns

- Party members see the internal whip room on pages they are authorized to access.
- State / regional whip rooms are local-scoped.
- Caucus whip tooling is on the caucus surface.
- The route rate limit is 20 requests per 60 seconds per user.

## Data

| Collection | Fields | Read or written | Player-visible |
| --- | --- | --- | --- |
| `billWhips` | `targetType`, `targetId`, `chamber`, `direction`, `candidacyId`, `issuedBy` (`stateParty`, `nationalParty`, `caucus`), `countryId`, `stateId`, `partyId`, `caucusId`, `issuedByCharacterId`, `issuedByRole`, `audience`, `mode`, `attemptNumber` (1 or 2), `createdAt` | Inserted by the three whip routes; read by turn-time voting, defiance, and the bill whip panel | Party members with access see whips and the defiance watch; the NPP success roll is hidden |
| `bills` | `votes`, `otherChamberVotes`, `vetoOverrideVotes` (maps keyed `npp_<id>` or character id), per-vote tallies, `whippedFromVote` snapshot for player undo, `overrideVotingStartedAt` | Written by hard whips and by turn-time voting | Vote totals yes; the whip-applied snapshot no |
| `electedOfficials` | `nppId`, `officeType`, `seatsHeld`, `countryId` | Read to find the NPPs to whip and their weight | Yes |
| `npps` | `personality.loyalty`, `personality.stubbornness`, `party`, `homeState`, `isTechnocrat` | Read only | Personality is shown as hints; exact values are not |
| `characters` | `stats.statecraft`, `statXp.statecraft` | Statecraft read for the bonus; XP incremented by `USE_GROWTH_INCREMENT` | Own stats only |
| `statePartyOrg` | `chairId`, `viceChairId` | Read to decide whether a state whip pre-empts a national one | Yes |
| `nppVotePredictions` | forces, verdict, resolved vote per NPP and bill | Rewritten after a whip so the forecast stays current | Yes, on the prediction surface |
| Leadership, nomination and motion collections (`speakerNominations`, `houseLeadershipNominations`, `senateLeadershipNominations`, `speakerVacateMotions`, `impeachments`, `cabinetNominations`, `scotusNominations`) | per-target votes | Written by hard leadership-type whips | Yes |

## Configuration

Whips read no `gameConfig` field and have no era or scenario override. Behaviour changes only through code constants and through live data.

| Setting | Default | Where set |
| --- | --- | --- |
| `WHIP_SUCCESS_BASE_CHANCE`, `WHIP_LOYALTY_WEIGHT`, `WHIP_STUBBORNNESS_WEIGHT`, `WHIP_MODE_BONUS`, `WHIP_MIN_SUCCESS_CHANCE`, `WHIP_MAX_SUCCESS_CHANCE` | 55, 0.35, 0.18, soft 6 and hard 15, 40, 95 | `src/lib/partyWhips/whipSuccess.ts` |
| `PARTY_WHIP_BASE_BY_MODE`, `CAUCUS_WHIP_BASE_BY_MODE`, `CORE_POSITION_BONUS`, `PARTY_LINE_BIAS_BASE`, `VERDICT_THRESHOLD` | hard 60 and soft 30, hard 80 soft 40 free 0, 20, 20, 5 | `src/lib/turn/npp/crossPressure.ts` |
| Compliance weights | 0.7 and 0.3 | `src/lib/turn/npp/complianceRules.ts` |
| Cabinet discipline bonus | 0 to 0.2, loaded per party and turn | `src/lib/resetCabinet/loadDiscipline.ts`, `applyCabinetWhipPressure` in `src/lib/resetCabinet/rules/gameplay.ts` (throws outside 0 to 0.2) |
| Max NPP attempts per target and chamber | 2 | the three whip routes |
| NPP control requirement (national NPP whips only) | party age and member tenure, waived for default parties and admins | `getPartyNppControlStatus` in `src/lib/parties/antiAbuseGuards.ts` |
| Rate limit | 20 per 60 seconds per user | the three whip routes |
| Whip window start | `overrideVotingStartedAt` on a veto-override ballot; election `startedAt` for US Speaker and leadership targets | `src/lib/congress/billWhipPhase.ts`, national whip route |
| German chambers (`bundestag`, `landtag`) | leadership-election whips refused | national whip route |

## Timing

- **Issue time (a request, not a turn).** The whip document is inserted, then party NPPs in that chamber are resolved immediately (hard whips), and the chair's Statecraft gets use-growth XP (`USE_GROWTH_INCREMENT`, flushed at turn).
- **Turn time.** NPP bill voting runs in the NPP behaviour phase after election entry and endorsements: `processBillVoting` (federal), then `processStateBillVoting` (local) in `src/lib/turn/nppBehavior.ts`. Whips issued before the turn feed the `whip` force.
- **Defiance** is computed on read from the current votes and whips.

## Worked trace

A national party chair with neutral Statecraft (stat 5.5, bonus `round((1 - 1) * 50) = 0`) issues a hard "for" whip on an open bill. A cabinet discipline bonus of 0 applies. NPP A has loyalty 70 and stubbornness 40, and without the whip its forces on this bill are ideology -30, district -10, donors 0.

| Step | Computation | Result |
| --- | --- | --- |
| Loyalty term | `round(70 * 0.35) = round(24.5)` | 25 |
| Stubbornness term | `round(40 * 0.18) = round(7.2)` | 7 |
| Hard roll chance | `clamp(55 + 25 - 7 + 15 + 0, 40, 95)` | 88 percent |
| Compliance | `0.7 * 0.7 + 0.3 * 0.6 = 0.49 + 0.18` | 0.67 |
| Whip force, cross-pressure | `60 * (1 + 0) * 0.67`, clamped to -100 to 100 | 40.2 |
| Verdict with the whip | `-30 + 40.2 - 10 + 0 = 0.2`, inside plus or minus 5 | abstain |
| Roll of 73 (at or below 88) | success: vote written in the whip direction | `for`, counted as fell in line |
| Roll of 95 (above 88) | failure: vote is the cross-pressure verdict | `abstain`, counted as ignored |

The vote is stored under `bills.votes["npp_<id>"]` with the NPP's `seatsHeld` weight added to the tally, and `nppVotePredictions` is rewritten with the post-whip forces. If the bill is a veto-override ballot, an `abstain` result is coerced to `against`.

Other numbers from the same inputs:

| Case | Computation | Result |
| --- | --- | --- |
| Soft whip on a non-bill target | `55 + 25 - 7 + 6` | 79 percent |
| Soft whip on a bill, later at turn time | `30 * 0.67` | 20.1 force, no roll |
| Hard whip with maximum cabinet discipline | `60 * 1.2 * 0.67` | 48.24 force |
| Chair Statecraft 8 | `round((1.1 - 1) * 50)` | plus 5, chance becomes 93 |
| NPP B, loyalty 20, stubbornness 80, hard whip | `55 + 7 - 14 + 15` | 63 percent |
| NPP B turn-time hard force | `60 * (0.14 + 0.06)` | 12; with ideology -30 the sum is -18, so against |

## Edge cases and limits

- **Second whip.** After a failed hard whip a chair can issue one more NPP whip on the same target and chamber (attempt 2 of 2). The third is refused. For a veto-override ballot the count restarts, because only whips since `overrideVotingStartedAt` count. Leadership and vacate-motion whips are likewise scoped to the current election instance (ticket #959).
- **Players:** one soft and one hard whip per target; a second of the same mode is refused.
- **Already aligned NPPs** are counted as fell-in-line and left alone.
- **Roll floor and ceiling (bill hard whips and non-bill soft whips).** Even a maximally stubborn, disloyal NPP gets at least 40 percent on a roll; even a perfect one gets at most 95.
- **Abstain.** A cross-pressure sum within 5 of zero abstains. Override votes cannot abstain.
- **Technocrat NPPs** do not vote on state bills at all, so state whips do not affect them.
- **Banned-party NPPs** in a one-party state are skipped by federal NPP voting.
- **State legislatures without active players:** no state chair or vice chair seated means the national whip applies to that state's NPPs instead.
- **Only bill whips can be defied at issue time.** On leadership, PM appointment, no-confidence, cabinet, vacate-motion and impeachment targets a `hard` NPP whip is always obeyed with no roll. A `soft` whip on those targets runs the same roll with the soft bonus (+6); a failed roll falls back to the NPP's own best same-party or same-state choice (`src/lib/congress/applyWhipVotes.ts`). On bills, `soft` is advisory only.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Roll chance stays in 40 to 95 | `calculateNppWhipSuccessChance` clamp; `src/lib/partyWhips/whipSuccess.test.ts` |
| Each cross-pressure force is within -100 to 100 and the verdict uses a plus or minus 5 band | `clamp100` and `verdictFromForces`; `src/lib/turn/npp/crossPressure.test.ts` |
| Cabinet discipline bonus is within 0 to 0.2 | `applyCabinetWhipPressure` throws otherwise |
| At most 2 NPP whips per target, chamber and party in the current phase | Route checks; `route.test.ts` for the national and caucus routes. The state route has no route test |
| At most one soft and one hard player whip per target | National route check; `character-whip.integration.test.ts` |
| A hard bill whip subtracts an NPP's old vote before adding the new one, so tallies do not double count | Logic in `applyWhipVotesToBill`; `src/lib/congress/applyWhipVotes.test.ts` covers application, not named for this case |
| A hard player whip is undoable: `whippedFromVote` stores the prior vote | `applyPlayerWhip.test.ts`, `clearWhippedVote.test.ts` |
| An NPP is only whipped onto its own country's bill | Country guards in `applyWhipVotes.ts`; `applyWhipVotes.test.ts` (cross-country guard, bug 0699) |
| Votes written by a whip never move a player's positions | Not enforced in this module; stated by the player guide and handled in the vote path |

## Failure and recovery

| Failure | What it looks like | Repair |
| --- | --- | --- |
| Whip document inserted but apply step fails | A whip exists but NPP votes did not change; the chair sees an error | The whip row is inserted before the apply step (player whips also write an audit row first), so it stays traceable; the chair can use the remaining attempt, or an admin repairs the target |
| Tally disagrees with the vote map | For or Against totals differ from the stored votes | Re-resolving subtracts an NPP's old vote before adding the new one to prevent it; a stored mismatch is repaired by a heal that recomputes the tally |
| Stale whips carried into a veto-override ballot | Defiance shows whips from the passage phase | Readers reject whips older than `overrideVotingStartedAt` (`isBillWhipInCurrentPhase`); old rows are also cleaned up best-effort |
| Cross-country party id collision | A whip from another country's party applies | `resolveWhipForNPP` and the apply functions skip whips and NPPs of other countries |

## Connections

**Driven by**
- [Parties](./parties.md) and [caucuses](./caucuses.md): chair, vice chair and caucus chair seats decide who can whip (route authorization checks).
- [NPP system](./npp-system.md): loyalty and stubbornness personality values feed `complianceMultiplier` and the roll.
- Character Statecraft stat: `statecraftWhipBonus` raises the roll.
- Cabinet discipline: `cabinetDisciplineForParty` boosts whip force in `src/lib/turn/npp/billVoting.ts`.

**Affects**
- [Bills and legislation](./bills-legislation.md): hard whips write NPP votes into `bills.votes`, `otherChamberVotes` or `vetoOverrideVotes`, changing tallies before the deadline.
- [Parliamentary government](./parliamentary-government.md): PM appointment and no-confidence votes can be whipped.
- [Congress leadership](./congress-leadership.md): leadership-election whips write NPP leadership votes.
- NPP vote predictions: `nppVotePredictions` is rewritten with the post-whip forces so the forecast surface stays current.

## Tests

| File | Covers |
| --- | --- |
| `src/lib/partyWhips/whipSuccess.test.ts` | Roll chance, clamps, Statecraft bonus |
| `src/lib/partyWhips/whipDefiance.test.ts`, `playerWhip.test.ts`, `playerWhipSummary.test.ts`, `issuerRole.test.ts`, `constraints.test.ts` | Defiance, player whip modes, issuer roles, constraints |
| `src/lib/congress/applyWhipVotes.test.ts`, `applyWhipVotesImpeachment.test.ts` | NPP whip application, overrides, leadership-type targets |
| `src/lib/congress/applyPlayerWhip.test.ts`, `applyPlayerWhipImpeachment.test.ts`, `clearWhippedVote.test.ts` | Player hard whips and undo |
| `src/lib/congress/billWhipPhase.test.ts`, `billWhipPanelData.test.ts` | Phase window and panel data |
| `src/lib/turn/npp/crossPressure.test.ts`, `crossPressure.v2.test.ts` | Forces and verdict |
| `src/lib/turn/npp/billVoting.test.ts`, `stateBillVoting.test.ts`, `whipResolution.test.ts` | Turn-time voting and whip precedence |
| `src/app/api/country/[code]/parties/[id]/whip/route.test.ts`, `.../whip/character-whip.integration.test.ts`, `.../whip/impeachment.route.test.ts` | National route |
| `src/app/api/country/[code]/parties/[id]/caucuses/[slug]/whip/route.test.ts` | Caucus route |
| `src/app/api/country/[code]/region/[id]/party/[partyId]/whip/impeachment.route.test.ts` | State route, impeachment only |

Gaps: the state whip route has no general route test, and no test exercises the caucus whip through turn-time voting because it is not wired there.

## Known issues and history

- **Caucus whips have no turn-time effect.** The autonomous resolver passes `caucusWhip: null`, so a caucus whip changes votes only through its issue-time path. The player wiki lists caucus whip pressure (40, with a core-position bonus of 20) in its key numbers as if it fed NPP decisions at the turn; it does not.
- **Caucus force table is partly dead.** `computeWhipForce` uses only the `soft` value (40) of `CAUCUS_WHIP_BASE_BY_MODE` regardless of the whip's mode; the hard (80) and free (0) entries are unused.
- **US congressional leadership elections are player-only** for autonomous NPP behaviour (`speakerVotes` is a constant 0), though a chair's hard whip can still write NPP leadership votes.
- Ticket #959: leadership and vacate-motion whips are scoped to the current election instance.
- The roll curve is described in code as deliberately generous so same-party NPPs usually comply.

Last checked: 2026-10-29, version 1.18.0
