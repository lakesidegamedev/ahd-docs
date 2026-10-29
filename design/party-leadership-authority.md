# Party Leadership Authority

Technical design for four party-leadership rules that sit below the national and state chair election flow: acting-chair inheritance, leadership tenure gates, the unmanned-default capture shield, and (historically) UK regional-party ballot gating.

Player guide: [Party Leadership & Authority](https://www.ahousedividedgame.com/wiki/party-leadership-authority)

## Rules

| Rule | Constant or function | Value | Source |
| --- | --- | --- | --- |
| Leadership tenure | `PARTY_LEADERSHIP_TENURE_TURNS` | 24 turns of membership before standing in or voting in any party, caucus or region leadership election | `src/lib/parties/leadershipTenure.ts` |
| State relocation delay | `STATE_LEADERSHIP_RELOCATION_DELAY_TURNS` | 24 turns after relocating before standing in, voting in or being appointed to STATE party leadership | `src/lib/parties/leadershipTenure.ts` |
| Founding national chair election length | `FOUNDING_CHAIR_ELECTION_DURATION_TURNS` | 12 turns | `src/lib/nationalPartyElectionConstants.ts` |
| Founding state election length | `FOUNDING_STATE_ELECTION_DURATION_TURNS` | 12 turns | `src/lib/statePartyElections.ts` |
| New-character cooldown | `NEW_CHARACTER_COOLDOWN_MS` | 24 hours of wall-clock time (not turns) on leadership and committee actions | `src/lib/auth/newCharacterCooldown.ts` |
| Unmanned default capture shield | `DEFENSE_UNMANNED_CAPTURE_MULTIPLIER` | 0.5 | `src/lib/turn/partyOrg/defenseConstants.ts` |

### Acting chair (vice-chair inheritance)

**Location:** `src/lib/parties/actingChair.ts`

Per the 2026-05-22 decision: when `PoliticalParty.chairId` is `null` AND `viceChairId` is set, the vice-chair inherits all chair **authority** functions (Chair Office access, parliamentary PM proposal, coalition actions, etc.) until a new chair is elected or admin-appointed. The vice-chair does not become the chair and no schema mutation happens: `chairId` stays `null`, `viceChairId` stays set. Only the vice-chair's acting authority expands while the chair slot is vacant; their party role is unchanged.

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

`canActAsChair` gates a broad surface: party settings, join and join-request approval, purge, hero image and logo uploads, bulk-org actions, priority-region selection, campaigner management, coalition create, join, leave, disband vote, and invite accept or decline, and anywhere a route would otherwise require `party.chairId === characterId`. Nineteen files under `src/app` and `src/lib` call it.

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

**Leaving or being purged.** Leave (`src/app/api/country/[code]/parties/[id]/leave/route.ts`) and purge (`.../purge/route.ts`) unset `partyJoinedTurn`. The character has no party at that point, so the grandfather rule has no effect until they join again, which stamps a fresh turn. Rejoining the same party therefore restarts the 24 turns.

**State relocation delay.** A second, separate constant, `STATE_LEADERSHIP_RELOCATION_DELAY_TURNS` (also 24 turns), gates state-party leadership specifically. After relocating, a character must wait this many turns before standing in, voting in or being appointed into STATE party leadership, to stop relocation-hopping into a fresh state party org (ticket #949). It is intentionally decoupled from the longer general relocation cooldown, so local leadership residency stays fixed at 24 turns even if the movement cooldown changes. It reuses `getPartyTenure` with `lastRelocatedTurn` as the clock. A missing `lastRelocatedTurn` is grandfathered eligible. Callers: the state-party `election`, `election/enter`, `leadership` and `campaigners` routes under `src/app/api/country/[code]/region/[id]/party/[partyId]/`.

**Callers of the party tenure gate:** every party, caucus and region leadership election route (`enter`, `vote`, and the read-only election, leadership and campaigners views), plus the read-model builder `src/lib/parties/queries/leadership.ts`.

**Worked example.** A character joins a party at turn 100. At turn 110 `turnsServed` is 10 and `turnsRemaining` is 14, so they cannot enter or vote. At turn 124 `turnsServed` is 24, `turnsRemaining` is 0, and they can. If they switch parties at turn 120, the new party stamps 120 and they are eligible there from turn 144. If they also relocated at turn 130, the state-party gate additionally holds them out until turn 154.

### Founding-election waiver

The accelerated 12-turn leadership elections run at iteration start (`election.founding === true`) waive both the 24-hour new-character cooldown and the party-tenure gate, so brand-new players can seat the full chair, vice-chair and treasurer slate. The waiver is enforced server-side by the same `enter` and `vote` routes and mirrored in `src/lib/parties/queries/leadership.ts`, so the UI does not show a locked state the route would then accept. Committee-method restrictions still apply during founding elections.

### Unmanned-default capture shield

**Location:** `src/lib/parties/unmannedDefenseShield.ts`

Reduces the effect of actions that attack a target party's metrics (Build Org rival-poach, Suppression) when the target is a **default party with no active human chair**: an abandoned DEM or REP style stronghold. Without this shield, a political-strength-rich rival could grind an unmanned default party's Org and turnout to nothing, eroding the baseline two-party landscape new players rely on to enter the game.

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

`DEFENSE_UNMANNED_CAPTURE_MULTIPLIER = 0.5` (`src/lib/turn/partyOrg/defenseConstants.ts`): an unmanned default party takes half the poach effect a manned party would.

`isUnmannedDefault(party, isActiveHumanChair)` first checks `party.isDefault`; only default parties (not player-founded parties) are eligible. It then resolves the chair seat. The chair is not an active human when the seat is vacant (`chairId == null`), the chair character is an NPP (no `userId`), or the chair's user is banned.

The multiplier applies only to the reduction inflicted on the target (the poach slice). It never touches the share a party draws from the Unaffiliated pool.

**Callers:** `src/app/api/country/[code]/region/[id]/party/[partyId]/build-org/route.ts`, `src/lib/nppAutonomy/v3/party/nppBuildOrg.ts` and `src/lib/turn/politicalStrength/computeBuildOrgPreview.ts`. Every Build Org attack-path resolver checks this multiplier against the target party before applying the poach, so the player preview and the NPP path agree with the live result.

### UK regional-party ballot gating

Historical: an earlier runtime gate (`src/lib/parties/regionalContest.ts`, `canPartyContestState`) kept SNP, Plaid Cymru and the Northern Ireland parties off ballots outside their home nations. That module no longer exists in the code, and this page does not document a current replacement.

## Timing

None of these rules runs on its own schedule. They are checked at the moment something happens.

- **Acting chair:** evaluated on every request to a chair-gated route, from the party document as it is at that moment. A chair election that resolves in the turn processor writes `chairId`, and the next request sees it.
- **Tenure gate:** evaluated when a player calls `enter` or `vote` on a leadership election and when the leadership read model is built. It is never evaluated in the turn processor, so a candidate already entered is not removed if their clock later changes.
- **Capture shield:** evaluated when a Build Org action is previewed or submitted, and when the NPP Build Org path resolves in the NPP autonomy phase of the turn (`src/lib/nppAutonomy/v3/party/nppBuildOrg.ts`), before the poach is applied.
- **Founding waiver:** applies only while an election carries `founding: true`, which is only stamped during the pre-iteration founding phase.

For turn-phase ordering see [`turn-processing.md`](./turn-processing.md).

## Edge cases and limits

- **Both chair and vice-chair vacant:** `getActingChairId` returns `null`, `canActAsChair` is false for everyone, and chair-gated routes refuse. Only an election or an admin appointment restores authority.
- **Chair seat filled but chair is banned or inactive:** `getActingChairId` still returns the chair. The vice-chair does not inherit while `chairId` is set. (The capture shield treats a banned chair as absent; the acting-chair rule does not.)
- **Acting vice-chair is never shown as chair.** Identity display reads `party.chairId`.
- **Tenure floor:** `turnsServed` is clamped to 0 or more, so a join stamp in the future cannot produce a negative count.
- **Grandfathering:** missing `partyJoinedTurn` or `lastRelocatedTurn` means eligible, never locked.
- **Mergers keep tenure; leaving, switching and rejoining restart it.**
- **The two 24-turn gates are independent.** A state-party candidate needs both the party tenure and the relocation delay. The relocation check is never run through the founder exemption.
- **Shield scope:** default parties only. A player-founded party with a vacant chair gets no protection.
- **Shield is one-sided:** it lowers damage taken by the target. It does not raise what the attacker gains from the Unaffiliated pool and does not protect a manned default party.

## Connections

**Driven by**
- [Parties](./parties.md): chair and vice-chair seats come from leadership elections, and the join, leave, purge and merge flows write `partyJoinedTurn` (`applyCharacterPartyJoin.ts`).
- Character relocation: `src/lib/character/performRelocation.ts` writes `lastRelocatedTurn`, which feeds the state relocation delay.
- Charter founding: `src/lib/charters/ratifyCharter.ts` sets `foundedPartyId` and the founding-turn `partyJoinedTurn`.
- Account bans: a banned user turns a default party's chair seat into an unmanned seat for the shield.

**Affects**
- [Congress leadership](./congress-leadership.md) and [chamber leadership by country](./chamber-leadership-by-country.md): chamber leadership races follow a similar eligibility pattern but are a distinct role set from party chair.
- [Party influence](./party-influence.md) and Build Org: the shield halves the poach slice of attack actions through `resolveUnmannedDefaultCaptureMultiplier`.
- [Parliamentary government](./parliamentary-government.md): PM proposal and coalition actions require `canActAsChair`.

Last checked: 2026-10-29, version 1.18.0
