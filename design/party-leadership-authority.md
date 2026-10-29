# Party Leadership Authority

Design doc for four party-leadership mechanics that sit below the national/state
chair election flow: acting-chair inheritance, leadership tenure gates, the
unmanned-default capture shield, and UK regional-party ballot gating.

## Acting chair (vice-chair inheritance)

**Location:** `src/lib/parties/actingChair.ts`

Per the 2026-05-22 decision: when `PoliticalParty.chairId` is `null` AND
`viceChairId` is set, the vice-chair inherits all chair **authority** functions
(Chair Office access, parliamentary PM proposal, coalition actions, etc.) until a new
chair is elected or admin-appointed. The vice-chair does not become the chair, no
schema mutation happens: `chairId` stays `null`, `viceChairId` stays set. Only the
vice-chair's acting authority expands while the chair slot is vacant; their party
*role* is unchanged.

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

- **`getActingChairId`** / **`canActAsChair`** are for authorization checks. For
  identity display ("the chair of this party is X"), read `party.chairId` directly,   a vice-chair acting as chair is never presented as the chair.
- **`isViceChairActing`** drives UI affordances that should warn the player they're
  operating in an acting capacity (e.g. a "Chair Office (acting)" tab label).

`canActAsChair` gates a broad surface: party settings, join/join-request approval,
purge, hero image and logo uploads, bulk-org actions, priority-region selection,
campaigner management, coalition create/join/leave/disband-vote/invite
accept/decline, anywhere a route would otherwise require `party.chairId ===
characterId`.

## Leadership tenure gate

**Location:** `src/lib/parties/leadershipTenure.ts`

A character must have been a member of a party for at least
`PARTY_LEADERSHIP_TENURE_TURNS` (**24 turns**) before they may run for or vote in
that party's leadership elections. The clock resets on every join, initial join,
party switch, or merge-absorption, via the `partyJoinedTurn` stamp.

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

A missing `partyJoinedTurn` (`null`/`undefined`) is treated as eligible, grandfathers
established members through the rollout instead of false-locking them before a
backfill runs.

A second, separate constant, `STATE_LEADERSHIP_RELOCATION_DELAY_TURNS` (also **24
turns**), gates state-party leadership specifically: after relocating, a character
must wait this many turns before standing in (or being appointed into) STATE party
leadership, to stop relocation-hopping into a fresh state party org (ticket #949). It
is intentionally decoupled from the (longer) general relocation cooldown, local
leadership residency stays fixed at 24 turns even if the movement cooldown itself
changes. A missing `lastRelocatedTurn` is grandfathered eligible, same pattern as
above.

**Callers:** every party/caucus/region leadership election route, `enter`, `vote`,
and the read-only election/leadership/campaigners views, call `getPartyTenure`
directly against `authUser.character.partyJoinedTurn` to gate candidacy and voting.

**Founding-election waiver:** the accelerated 12-turn chair race run at iteration
start (`election.founding === true`) waives both the 24h new-character cooldown and
the party-tenure gate. The waiver is enforced server-side by the same `enter`/`vote`
routes, mirrored in the read-model builder
(`src/lib/parties/queries/leadership.ts`) so the UI doesn't show a locked state that
the route would then accept anyway.

## Unmanned-default capture shield

**Location:** `src/lib/parties/unmannedDefenseShield.ts`

Reduces the effect of actions that *attack* a target party's metrics, Build Org
rival-poach, Suppression, when the target is a **default party with no active human
chair**: an abandoned DEM/REP-style stronghold. Without this shield, a
political-strength-rich rival could grind an unmanned default party's Org/turnout to
nothing, eroding the baseline two-party landscape new players rely on to enter the
game.

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

`DEFENSE_UNMANNED_CAPTURE_MULTIPLIER = 0.5` (`src/lib/turn/partyOrg/defenseConstants.ts`)
, an unmanned default party takes **half** the poach effect a manned party would.

`isUnmannedDefault(party, isActiveHumanChair)` first checks `party.isDefault`; only
default parties (not player-founded parties) are eligible for the shield. It then
resolves the chair seat: **not** an active human when the seat is vacant (`chairId ==
null`), the chair character is an NPP (no `userId`), or the chair's user is banned.

The multiplier applies **only to the reduction inflicted on the target** (the poach
slice), it never touches the share a party draws from the Unaffiliated pool.

**Callers:** `POST /api/country/[code]/region/[id]/party/[partyId]/build-org`,
`src/lib/nppAutonomy/v3/party/nppBuildOrg.ts`,
`src/lib/turn/politicalStrength/computeBuildOrgPreview.ts`, every Build Org
attack-path resolver checks this multiplier against the target party before applying
the poach.

## UK regional-party ballot gating

Historical: an earlier runtime gate (`src/lib/parties/regionalContest.ts`, `canPartyContestState`) kept SNP, Plaid Cymru and the Northern Ireland parties off ballots outside their home nations. That module no longer exists in the code, and this page does not document a current replacement.

## Related systems

- [`congress-leadership.md`](congress-leadership.md), chamber leadership (Speaker,
  Majority/Minority Leader/Whip) elections, which share `PARTY_LEADERSHIP_TENURE_TURNS`-
  style gating patterns but are a distinct role set from party chair.
- [`chamber-leadership-by-country.md`](chamber-leadership-by-country.md), presiding-
  officer elections built on the same `rolePolicy.ts` eligibility engine.
