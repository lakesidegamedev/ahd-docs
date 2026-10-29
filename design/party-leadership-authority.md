# Party Leadership Authority

## Summary

Technical design for four party-leadership rules that sit below the national and state chair election flow: acting-chair inheritance, leadership tenure gates, the unmanned-default capture shield (implemented but not currently called by any live action), and (historically) UK regional-party ballot gating.

Player guide: [Party Leadership & Authority](https://www.ahousedividedgame.com/wiki/party-leadership-authority)

## Rules

| Rule | Constant or function | Value | Source |
| --- | --- | --- | --- |
| Leadership tenure | `PARTY_LEADERSHIP_TENURE_TURNS` | 24 turns of membership before standing in or voting in any party, caucus or region leadership election | `src/lib/parties/leadershipTenure.ts` |
| State relocation delay | `STATE_LEADERSHIP_RELOCATION_DELAY_TURNS` | 24 turns after relocating before standing in, voting in or being appointed to STATE party leadership | `src/lib/parties/leadershipTenure.ts` |
| Founding national chair election length | `FOUNDING_CHAIR_ELECTION_DURATION_TURNS` | 12 turns | `src/lib/nationalPartyElectionConstants.ts` |
| Founding state election length | `FOUNDING_STATE_ELECTION_DURATION_TURNS` | 12 turns | `src/lib/statePartyElections.ts` |
| New-character cooldown | `NEW_CHARACTER_COOLDOWN_MS` | 24 hours of wall-clock time (not turns) on leadership and committee actions | `src/lib/auth/newCharacterCooldown.ts` |
| Unmanned default capture shield | `DEFENSE_UNMANNED_CAPTURE_MULTIPLIER` | 0.5 (helper exists, no live caller; see Known issues) | `src/lib/turn/partyOrg/defenseConstants.ts` |
| State relocation delay for campaigner appointments | same `STATE_LEADERSHIP_RELOCATION_DELAY_TURNS` | 24 turns | `src/lib/parties/leadershipTenure.ts` |

### Acting chair (vice-chair inheritance)

**Location:** `src/lib/parties/actingChair.ts`

Per the 2026-05-22 decision: when `PoliticalParty.chairId` is `null` AND `viceChairId` is set, the vice-chair inherits all chair **authority** functions (Chair Office access, coalition actions, party settings, etc.) until a new chair is elected or admin-appointed. The vice-chair does not become the chair and no schema mutation happens: `chairId` stays `null`, `viceChairId` stays set. Only the vice-chair's acting authority expands while the chair slot is vacant; their party role is unchanged.

```typescript
export function getActingChairId(
  party: Pick<PoliticalParty, "chairId" | "viceChairId">
): ObjectId | null {
  if (party.chairId) return party.chairId;
  if (party.viceChairId) return party.viceChairId;
  return null;
}

export function canActAsChair(
  party: Pick<PoliticalParty, "chairId" | "viceChairId">,
  characterId: ObjectId
): boolean {
  const acting = getActingChairId(party);
  return acting != null && acting.equals(characterId);
}

export function isViceChairActing(
  party: Pick<PoliticalParty, "chairId" | "viceChairId">
): boolean {
  return party.chairId == null && party.viceChairId != null;
}
```

- **`getActingChairId`** and **`canActAsChair`** are for authorization checks. For identity display ("the chair of this party is X"), read `party.chairId` directly. A vice-chair acting as chair is never presented as the chair.
- **`isViceChairActing`** drives UI affordances that warn the player they are operating in an acting capacity (for example a "Chair Office (acting)" tab label).

`canActAsChair` gates a broad surface: party settings, join and join-request approval, purge, hero image and logo uploads, bulk-org actions, priority-region selection, campaigner management, coalition create, join, leave, disband vote, and invite accept or decline, and anywhere a route would otherwise require `party.chairId === characterId`. `canActAsChair` appears in 17 non-test source files: `src/lib/parties/proposals.ts`, the party hub page, and the party routes for `bulk-org`, `settings`, `hero`, `priority-region`, `join-requests`, `campaigners`, `purge`, the six coalition routes, and `src/app/api/upload/party-logo/route.ts`. The party `join` route uses `getActingChairId` directly. The hub page (`PartyHubPage.tsx`) computes the same condition inline and labels the tab "Chair office (acting)".

### Leadership tenure gate

**Location:** `src/lib/parties/leadershipTenure.ts`

A character must have been a member of a party for at least `PARTY_LEADERSHIP_TENURE_TURNS` (24) before they may run for or vote in that party's leadership elections. The clock is the `partyJoinedTurn` stamp, written by `applyCharacterPartyJoin` (`src/lib/parties/applyCharacterPartyJoin.ts`) on every join, join-request approval and voluntary party switch, and by charter ratification (`src/lib/charters/ratifyCharter.ts`).

```typescript
export function getPartyTenure(
  partyJoinedTurn: number | null | undefined,
  currentTurn: number,
  requiredTurns: number = PARTY_LEADERSHIP_TENURE_TURNS
): PartyTenure {
  if (partyJoinedTurn == null) {
    return { turnsServed: Number.POSITIVE_INFINITY, eligible: true, turnsRemaining: 0 };
  }
  const turnsServed = Math.max(0, currentTurn - partyJoinedTurn);
  const turnsRemaining = Math.max(0, requiredTurns - turnsServed);
  return { turnsServed, eligible: turnsRemaining === 0, turnsRemaining };
}
```

Routes and read models call `getLeadershipEligibility(subject, currentTurn, partyId)`, which wraps `getPartyTenure` and adds the charter-founder exemption (below).

A missing `partyJoinedTurn` (`null` or `undefined`) is treated as eligible. This grandfathers established members through the rollout instead of false-locking them before a backfill runs.

**Charter founder exemption.** A character whose `foundedPartyId` equals the party being contested is always eligible in that one party. Ratification stamps their `partyJoinedTurn` to the founding turn, which would otherwise lock all three founders out of their own new party for 24 turns. The exemption is scoped to that party. Joining any party clears `foundedPartyId` (`applyCharacterPartyJoin.ts`), so a founder who leaves and later returns serves the full 24 turns.

**Merger.** Party mergers do not rewrite `partyJoinedTurn`, so absorbed members keep their original tenure (stated in the header comment of `leadershipTenure.ts`).

**Leaving or being purged.** Leave (`src/app/api/country/[code]/parties/[id]/leave/route.ts`), purge (`.../purge/route.ts`), a relocation that leaves the party (`src/lib/character/performRelocation.ts`) and a ban (`src/lib/account/stripPartyMembershipForBannedUser.ts`) unset `partyJoinedTurn`, `partyJoinedAt` and `foundedPartyId`. The character has no party at that point, so the grandfather rule has no effect until they join again, which stamps a fresh turn. Rejoining the same party therefore restarts the 24 turns.

**State relocation delay.** A second, separate constant, `STATE_LEADERSHIP_RELOCATION_DELAY_TURNS` (also 24 turns), gates state-party leadership specifically. After relocating, a character must wait this many turns before standing in, or being appointed into, STATE party leadership. The state `election/vote` route does not check it: voting needs only the party tenure. This stops relocation-hopping into a fresh state party org (ticket #949. It is intentionally decoupled from the longer general relocation cooldown, so local leadership residency stays fixed at 24 turns even if the movement cooldown changes. It reuses `getPartyTenure` with `lastRelocatedTurn` as the clock. A missing `lastRelocatedTurn` is grandfathered eligible. Callers: the state-party `election` (read model), `election/enter`, `leadership` (appointments) and `campaigners` routes under `src/app/api/country/[code]/region/[id]/party/[partyId]/`, plus the national party `campaigners` route (`src/app/api/country/[code]/parties/[id]/campaigners/route.ts`, which can skip it via `skipRelocationGate`). Campaigner appointments are blocked for recently relocated characters (ticket #974); admins bypass the state campaigner check.

**Callers of the party tenure gate:** the national, caucus and state party election routes (`enter`, `vote`, and the read-only `election` views), plus the read-model builder `src/lib/parties/queries/leadership.ts`. New characters created through `src/app/api/auth/character/route.ts` are stamped with the current turn.

### Founding-election waiver

The accelerated 12-turn leadership elections run at iteration start (`election.founding === true`, created by `createMissingFoundingLeadershipElections` in `src/lib/nationalPartyElections.ts` and the `founding` option of `src/lib/statePartyElections.ts`) waive the 24-hour new-character cooldown, the party-tenure gate and, for state elections, the relocation delay, so brand-new players can seat the full chair, vice-chair and treasurer slate. The waiver is enforced server-side by the same `enter` and `vote` routes and mirrored in `src/lib/parties/queries/leadership.ts`, so the UI does not show a locked state the route would then accept. Committee-method restrictions still apply during founding elections.

### Unmanned-default capture shield

**Location:** `src/lib/parties/unmannedDefenseShield.ts`

Designed to reduce the effect of actions that attack a target party's metrics (the old Build Org rival-poach, Suppression) when the target is a **default party with no active human chair**: an abandoned DEM or REP style stronghold. Without this shield, a political-strength-rich rival could grind an unmanned default party's Org and turnout to nothing, eroding the baseline two-party landscape new players rely on to enter the game.

```typescript
export async function resolveUnmannedDefaultCaptureMultiplier(
  db: Db,
  targetParty: Pick<PoliticalParty, "isDefault" | "chairId">
): Promise<number> {
  const unmanned = await isUnmannedDefault(targetParty as PoliticalParty, (chairId) =>
    isActiveHumanChair(db, chairId)
  );
  return unmanned ? DEFENSE_UNMANNED_CAPTURE_MULTIPLIER : 1;
}
```

`DEFENSE_UNMANNED_CAPTURE_MULTIPLIER = 0.5` (`src/lib/turn/partyOrg/defenseConstants.ts`): if it were applied, an unmanned default party would take half the poach effect a manned party would. The per-party Org floor and tier bands in the same file are also inert since the 2026-05-20 cap cleanup.

`isUnmannedDefault(party, isActiveHumanChair)` first checks `party.isDefault`; only default parties (not player-founded parties) are eligible. It then resolves the chair seat. The chair is not an active human when the seat is vacant (`chairId == null`), the chair character is an NPP (no `userId`), or the chair's user is banned.

The multiplier applies only to the reduction inflicted on the target (the poach slice). It never touches the share a party draws from the Unaffiliated pool.

**Callers:** none in live code. A search of `src` finds `resolveUnmannedDefaultCaptureMultiplier` only in its own module, its test, and a mock in `computeBuildOrgPreview.test.ts`. Build Org no longer poaches a rival's points: a click deposits one fixed unit into the party's regional bucket and other parties' shares dilute proportionally (`src/app/api/country/[code]/region/[id]/party/[partyId]/build-org/route.ts`). Suppression is a turnout budget, not a targeted attack on a party. So the shield is currently inert: the helper and constant exist and are tested, but no action reads them.

### UK regional-party ballot gating

Historical: an earlier runtime gate (`src/lib/parties/regionalContest.ts`, `canPartyContestState`) kept SNP, Plaid Cymru and the Northern Ireland parties off ballots outside their home nations. That module no longer exists in the code, and this page does not document a current replacement.

## Data

| Collection | Fields | Read or written | Player-visible |
| --- | --- | --- | --- |
| `politicalParties` | `chairId`, `viceChairId`, `isDefault`, `sequentialId` | Read by every authority check; `chairId` and `viceChairId` are written by elections and committee removals (`applyRemoveOfficeHolderEffect` in `src/lib/parties/proposals.ts`) | Chair and vice-chair are shown on the party page; `isDefault` is not |
| `characters` | `partyJoinedTurn`, `partyJoinedAt`, `foundedPartyId`, `lastRelocatedTurn`, `createdAt`, `userId` | Read by the tenure, relocation and cooldown checks. Written on join, leave, purge, relocation, charter ratification, ban strip and character creation | Eligibility messages show turns remaining; the stamps themselves are not shown |
| `users` | `createdAt`, `isBanned` | Read only: `createdAt` anchors the 24-hour cooldown, `isBanned` marks an unmanned seat | No |
| `nationalPartyElections`, `statePartyElections`, caucus chair elections | `founding` | Written at creation, read by `enter` and `vote` routes to waive gates | The election itself is visible; the flag is not |
| `statePartyCandidates` | `electionId`, `characterId` | Written by the state `election/enter` route after the gates pass | Yes |

No collection is written by the gate functions themselves. `getPartyTenure`, `getLeadershipEligibility`, `getActingChairId`, `canActAsChair` and `isViceChairActing` are pure functions of the documents passed in.

## Configuration

None of these rules reads `gameConfig`, an era preset, a country preset or a scenario override. Every value is a code constant, so changing one is a code change and a deploy.

| Setting | Default | Where set |
| --- | --- | --- |
| `PARTY_LEADERSHIP_TENURE_TURNS` | 24 | `src/lib/parties/leadershipTenure.ts` |
| `STATE_LEADERSHIP_RELOCATION_DELAY_TURNS` | 24 | `src/lib/parties/leadershipTenure.ts` |
| `getPartyTenure` `requiredTurns` argument | defaults to `PARTY_LEADERSHIP_TENURE_TURNS` | same file |
| `RELOCATION_COOLDOWN_TURNS` (separate movement cooldown, deliberately not used here) | 72 | `src/lib/character/relocationCooldown.ts` |
| `NEW_CHARACTER_COOLDOWN_MS` | 24 hours | `src/lib/auth/newCharacterCooldown.ts` |
| `includePartyJoinedAt` on the cooldown input | true unless a flow passes false; leadership `enter` and `vote` pass false | `src/lib/auth/newCharacterCooldown.ts` |
| `FOUNDING_CHAIR_ELECTION_DURATION_TURNS`, `FOUNDING_STATE_ELECTION_DURATION_TURNS` | 12 | `src/lib/nationalPartyElectionConstants.ts`, `src/lib/statePartyElections.ts` |
| `election.founding` flag | absent (false) | stamped during the pre-iteration founding phase |
| `skipRelocationGate` option on the campaigner validator | false | `src/app/api/country/[code]/parties/[id]/campaigners/route.ts` |

## Timing

None of these rules runs on its own schedule. They are checked at the moment something happens.

- **Acting chair:** evaluated on every request to a chair-gated route, from the party document as it is at that moment. A chair election that resolves in the turn processor writes `chairId`, and the next request sees it.
- **Tenure gate:** evaluated when a player calls `enter` or `vote` on a leadership election and when the leadership read model is built. It is never evaluated in the turn processor, so a candidate already entered is not removed if their clock later changes.
- **Capture shield:** not evaluated by any live action (see Known issues). If wired in, it would run when the attacking action resolves, before the reduction is applied.
- **Founding waiver:** applies only while an election carries `founding: true`, which is only stamped during the pre-iteration founding phase.

For turn-phase ordering see [`turn-processing.md`](./turn-processing.md).

## Worked trace

A character joins party 7 at turn 100, switches into party 9 at turn 120, and relocates to a new state at turn 130. All numbers come from `getPartyTenure` with both constants at 24.

| Turn | Check | Computation | Result |
| --- | --- | --- | --- |
| 110 | Party 7 national `enter` | `turnsServed = 110 - 100 = 10`, `turnsRemaining = 24 - 10 = 14` | 403, "14 more turns" |
| 124 | Party 7 national `enter` | `turnsServed = 24`, `turnsRemaining = 0` | Allowed |
| 120 | Switch to party 9 | `applyCharacterPartyJoin` writes `partyJoinedTurn = 120`, clears `foundedPartyId` | Clock restarts |
| 130 | Relocate (party kept) | `performRelocation` writes `lastRelocatedTurn = 130`; `partyJoinedTurn` untouched | State clock starts |
| 144 | Vote in party 9 state election | party tenure `144 - 120 = 24`; the vote route has no relocation check | Allowed |
| 144 | Enter party 9 state election | party tenure passes; relocation `144 - 130 = 14`, `turnsRemaining = 10` | 403, "10 more turns" |
| 154 | Enter party 9 state election | relocation `154 - 130 = 24`, `turnsRemaining = 0` | Allowed |

A charter founder of party 9 would skip the first check entirely (`getLeadershipEligibility` returns eligible with `turnsRemaining = 0` when `foundedPartyId === "9"`), but would still face the relocation row.

Capture shield trace: not available, because no live action applies the multiplier. The helper alone returns `1` for a non-default party or a default party with an active human chair, and `0.5` for a default party whose chair seat is vacant, held by an NPP, or held by a banned user (`src/lib/parties/unmannedDefenseShield.test.ts`).

## Edge cases and limits

- **Both chair and vice-chair vacant:** `getActingChairId` returns `null`, `canActAsChair` is false for everyone, and chair-gated routes refuse. Only an election or an admin appointment restores authority.
- **Chair seat filled but chair is banned or inactive:** `getActingChairId` still returns the chair. The vice-chair does not inherit while `chairId` is set. (The capture shield treats a banned chair as absent; the acting-chair rule does not.)
- **Acting vice-chair is never shown as chair.** Identity display reads `party.chairId`.
- **Tenure floor:** `turnsServed` is clamped to 0 or more, so a join stamp in the future cannot produce a negative count.
- **Grandfathering:** missing `partyJoinedTurn` or `lastRelocatedTurn` means eligible, never locked.
- **Mergers keep tenure; leaving, switching and rejoining restart it.**
- **The two 24-turn gates are independent.** A state-party candidate needs both the party tenure and the relocation delay. The relocation check is never run through the founder exemption.
- **Founder exemption does not cover relocation.** The relocation check calls `getPartyTenure` directly.
- **Shield scope:** default parties only. A player-founded party with a vacant chair gets no protection.
- **Shield is one-sided:** it lowers damage taken by the target. It does not raise what the attacker gains from the Unaffiliated pool and does not protect a manned default party.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| `getActingChairId` returns the chair when seated, else the vice-chair, else `null`; the vice-chair never replaces `chairId` | `src/lib/parties/actingChair.test.ts` (pure function); no schema write exists |
| `turnsServed >= 0` and `turnsRemaining >= 0`; `eligible` is exactly `turnsRemaining === 0` | `src/lib/parties/leadershipTenure.test.ts` |
| A missing `partyJoinedTurn` is always eligible; an empty-string `foundedPartyId` never exempts | `leadershipTenure.test.ts` |
| Every join path that stamps `partyJoinedTurn` clears `foundedPartyId` | `src/lib/parties/applyCharacterPartyJoin.test.ts` |
| The same turn count gates `enter` and `vote` in national, caucus and state elections | Route tests (see Tests); no single shared check, each route calls the helper itself |
| Founding elections waive the gates in every route | Not enforced centrally: each route tests `election.founding` separately |

## Failure and recovery

| Failure | What it looks like | Repair |
| --- | --- | --- |
| Both chair and vice-chair seats empty | Chair-gated routes refuse everyone; the party page shows no Chair Office | Run or wait for a chair election, or an admin appoints a chair |
| Stale or missing `partyJoinedTurn` after a data import | A member is locked out (future stamp) or unexpectedly eligible (field absent) | Heal the character's stamp; absent stamps are grandfathered by design, so the safe direction is eligible |
| Stale `foundedPartyId` | A returning founder keeps an exemption they should have lost | Joins, leaves, purges, relocations and ban strips all clear it; a heal can unset a stray value |
| Mismatch between UI and route gates | The UI shows a locked or open state the route disagrees with | `src/lib/parties/queries/leadership.ts` mirrors the route checks; both must be changed together |
| Seat-holder removed mid-vote | A pending committee removal runs against a seat that has since changed | `applyRemoveOfficeHolderEffect` filters on the target character, so it becomes a no-op |

## Connections

**Driven by**
- [Parties](./parties.md): chair and vice-chair seats come from leadership elections, and the join, leave, purge and merge flows write `partyJoinedTurn` (`applyCharacterPartyJoin.ts`).
- Character relocation: `src/lib/character/performRelocation.ts` writes `lastRelocatedTurn`, which feeds the state relocation delay.
- Charter founding: `src/lib/charters/ratifyCharter.ts` sets `foundedPartyId` and the founding-turn `partyJoinedTurn`.
- Account bans: a banned user turns a default party's chair seat into an unmanned seat for the shield.

**Affects**
- [Congress leadership](./congress-leadership.md) and [chamber leadership by country](./chamber-leadership-by-country.md): chamber leadership races follow a similar eligibility pattern but are a distinct role set from party chair.
- [Party influence](./party-influence.md) and Build Org: the shield halves the poach slice of attack actions through `resolveUnmannedDefaultCaptureMultiplier`.
- Coalitions: create, join, leave, disband vote and invite responses require `canActAsChair` (`src/app/api/country/[code]/coalitions/`). PM proposal does not call it.

## Tests

| File | Covers |
| --- | --- |
| `src/lib/parties/actingChair.test.ts` | Acting chair resolution, `canActAsChair`, `isViceChairActing` |
| `src/lib/parties/leadershipTenure.test.ts` | Threshold, clamp, grandfathering, founder exemption, custom `requiredTurns` |
| `src/lib/parties/unmannedDefenseShield.test.ts` | Multiplier for custom, vacant, NPP-held, banned and human-held chairs |
| `src/lib/parties/applyCharacterPartyJoin.test.ts` | Join stamps and `foundedPartyId` clearing |
| `src/lib/parties/queries/leadership.test.ts` | Read model mirrors the gate |
| `src/app/api/country/[code]/parties/[id]/election/enter/route.test.ts`, `.../election/vote/tenureGate.test.ts` | National enter and vote gates |
| `src/app/api/country/[code]/parties/[id]/caucuses/[slug]/election/enter/route.test.ts`, `.../vote/route.test.ts` | Caucus gates |
| `src/app/api/country/[code]/region/[id]/party/[partyId]/election/enter/route.test.ts`, `.../vote/route.test.ts` | State enter and vote gates |
| `src/app/api/country/[code]/region/[id]/party/[partyId]/leadership/route.test.ts`, `.../campaigners/route.test.ts` | State appointments |
| `src/app/api/country/[code]/parties/[id]/leave/route.test.ts`, `.../purge/route.test.ts` | Tenure fields cleared |
| `src/lib/charters/ratifyCharter.test.ts`, `src/lib/character/performRelocation.test.ts`, `src/lib/auth/newCharacterCooldown.test.ts` | Founder stamp, relocation stamp, 24-hour cooldown |

Gaps: no test asserts that a live action applies the capture shield (the one Build Org preview test mocks it to `1`); there is no test for the join route's use of `getActingChairId`; the founding waiver is only covered per route.

## Known issues and history

- **Capture shield is not wired.** `resolveUnmannedDefaultCaptureMultiplier` has no live caller. Build Org stopped poaching rival points, and Suppression is a turnout budget, so the player wiki's claim that the shield halves Suppression against unmanned built-in parties does not match behaviour. The defense tier floors in `defenseConstants.ts` have been inert since 2026-05-20.
- **Wiki contradictions.** The player page says the vice-chair can propose a prime minister as acting chair; no PM-proposal code path calls `canActAsChair`. Its UK regional parties section describes organization starting values, not a ballot gate; no gate exists.
- 2026-05-22: vice-chair inherits chair authority when the chair seat is vacant.
- 2026-06-18: unmanned-default capture shield added (D3), later left unreferenced after Build Org changed.
- Ticket #949: state relocation delay. Ticket #974: same delay applied to campaigner appointments.

Last checked: 2026-10-29, version 1.18.0
