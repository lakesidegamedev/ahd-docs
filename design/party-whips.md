# Party Whips

Technical design for the whip system, which lets parties and caucuses coordinate both player and NPP voting without turning every vote into a hard override.

Player guide: [Voting & Whips](https://www.ahousedividedgame.com/wiki/voting-and-whips)

## Overview

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
| Statecraft bonus | `round((statMultiplier(statecraft) - 1) * 50)` points, about plus or minus 9, 0 at neutral | `statecraftWhipBonus` in `src/lib/partyWhips/whipSuccess.ts` |
| Missing loyalty or stubbornness | treated as 50 | `src/lib/partyWhips/whipSuccess.ts`, `src/lib/turn/npp/crossPressure.ts` |
| Party whip force in turn-time voting | hard 60, soft 30 | `PARTY_WHIP_BASE_BY_MODE` in `src/lib/turn/npp/crossPressure.ts` |
| Caucus whip force (defined, not wired in the autonomous path) | hard 80, soft 40, free 0; core-position bonus 20 | `CAUCUS_WHIP_BASE_BY_MODE`, `CORE_POSITION_BONUS` |
| Compliance multiplier | `loyalty/100 * 0.7 + (1 - stubbornness/100) * 0.3` | `complianceMultiplier` |
| Party-line lean with no whip | `20 * complianceMultiplier` for same-party-as-sponsor NPPs | `PARTY_LINE_BIAS_BASE`, `computePartyLineForce` |
| Cabinet discipline pressure on whip force | multiplier `1 + bonus`, bonus between 0 and 0.2 | `applyCabinetWhipPressure` in `src/lib/resetCabinet/rules/gameplay.ts` |
| Force range and verdict | each force clamped to -100..100; sum above 5 is for, below -5 is against, otherwise abstain | `VERDICT_THRESHOLD`, `verdictFromForces` in `src/lib/turn/npp/crossPressure.ts` |
| Local bill force weights | ideology 1, whip 1, district 1.35, donors 0.65 | `LOCAL_BILL_FORCE_WEIGHTS` in `src/lib/turn/npp/stateBillVoting.ts` |

## Scope

### National party

The `National Party Chair`, `Vice Chair`, an admin, or a chamber leader of the party (Speaker, Majority or Minority Leader, Majority or Minority Whip, President Pro Tempore) can issue whips. Targets are bills and, where the country uses them, leadership elections, PM appointment votes, no-confidence votes, cabinet nominations, SCOTUS nominations, Speaker vacate motions and impeachment votes. German chambers refuse leadership-election whips and use PM appointment or no-confidence whips instead. NPP-audience whips also require the party's NPP control to be unlocked (`getPartyNppControlStatus`).

### State / regional party

Only the State Party Chair or Vice Chair can issue whips, for NPPs in their own state. Targets are limited to bills in the sub-national legislature, cabinet nominations and their own state's governor impeachment.

### Caucus

The Caucus Chair, an admin or a chamber leader can issue caucus whips. They are scoped to caucus members only and behave like a smaller internal whip bloc inside the national party.

## Player vs NPP whips

### Player whips

- `soft`: notification and guidance only ("Party vote recommendation").
- `hard`: immediate forced vote write at issue time, snapshotted so it can be undone (`applyPlayerWhipToBill` and siblings in `src/lib/congress/applyPlayerWhip.ts`). The player may later change their vote; the change shows as defiance.

A hard player whip reports how many players were overridden and how many were already aligned.

### NPP whips

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

**Worked example.** An NPP has loyalty 70 and stubbornness 40 and the chair has neutral Statecraft.
- Hard bill whip chance: `55 + 25 - 7 + 15 = 88` percent. The soft-mode chance on a non-bill target would be `55 + 25 - 7 + 6 = 79` percent.
- Compliance multiplier: `0.7 * 0.7 + 0.6 * 0.3 = 0.67`. A later turn-time hard whip force is `60 * 0.67 = 40.2`; soft is `30 * 0.67 = 20.1`.
- A loyalty 20, stubbornness 80 NPP gets `55 + 7 - 14 + 15 = 63` percent for a hard whip, and a turn-time hard force of only `60 * 0.20 = 12`.
- If that NPP's ideology force is -30 and nothing else pulls, a hard whip "for" at 12 leaves the sum at -18, so they vote against.

## Autonomous bill-vote pressure

When an NPP votes on a bill in the turn (`src/lib/turn/npp/billVoting.ts` for federal bills, `src/lib/turn/npp/stateBillVoting.ts` for local bills), the verdict is the clamped sum of four forces: ideology, whip, district (home-state or home-region sentiment) and donors. Whip pressure follows these rules:

- `hard` party whips use magnitude 60, `soft` use 30, each scaled by the compliance multiplier and any Cabinet discipline bonus.
- State whips take precedence over national: `resolveWhipForNPP` (`src/lib/turn/npp/whipResolution.ts`) picks the state whip for the NPP's home state first, and counts a national whip **only when that state party has no chair or vice chair** seated. Within a tier the latest attempt wins, then the latest timestamp, then hard over soft.
- Caucus whips apply only through the immediate issue-time path. The autonomous resolver passes `caucusWhip: null`, so a caucus whip does not add turn-time pressure, even though `computeWhipForce` knows how to price one.
- With no whip at all, co-partisan NPPs lean toward their own sponsor's bill by `20 * complianceMultiplier` (a government's goal bills use a soft whip instead).
- Turn-time voting skips NPPs that already have a vote on the bill, so a whip issued first is not overridden by the turn.

## Leadership elections

US congressional leadership elections are **player-only** in live NPP behaviour. The turn processor counts `speakerVotes` as a constant 0 (`src/lib/turn/nppBehavior.ts`), so NPPs never vote in Speaker, House or Senate leadership races on their own. Whip helpers for NPP leadership votes (`applyWhipVotesToLeadership`) still exist and a chair's hard whip writes NPP leadership votes directly with no roll (see Edge cases), but autonomous NPP congressional leadership voting is not an active simulation system.

## Defiance

Whip history is a **defiance watch** (`src/lib/partyWhips/whipDefiance.ts`), not a permanent compliance ledger.

An entry appears only when the whip exists, the target has cast a vote, and that vote currently contradicts the whip. It clears when the target changes back into compliance, the whip becomes irrelevant, or the underlying target closes or is withdrawn. For bills, only whips from the current phase count: a veto-override ballot ignores whips issued before it began (`src/lib/congress/billWhipPhase.ts`).

## Access patterns

- Party members see the internal whip room on pages they are authorized to access.
- State / regional whip rooms are local-scoped.
- Caucus whip tooling is on the caucus surface.
- The route rate limit is 20 requests per 60 seconds per user.

## Timing

- **Issue time (a request, not a turn).** The whip document is inserted, then party NPPs in that chamber are resolved immediately (hard whips), and the chair's Statecraft gets use-growth XP (`USE_GROWTH_INCREMENT`, flushed at turn).
- **Turn time.** NPP bill voting runs in the NPP behaviour phase after election entry and endorsements: `processBillVoting` (federal), then `processStateBillVoting` (local) in `src/lib/turn/nppBehavior.ts`. Whips issued before the turn feed the `whip` force.
- **Defiance** is computed on read from the current votes and whips.

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

Last checked: 2026-10-29, version 1.18.0
