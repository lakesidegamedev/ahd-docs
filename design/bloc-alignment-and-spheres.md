# Bloc Alignment and Spheres of Influence

## Summary

Player guide: [Bloc Alignment & Spheres of Influence](https://www.ahousedividedgame.com/wiki/bloc-spheres)

Alignment tracks how drawn each nation is toward each Cold War pole (0-100 shares that sum with an "uncommitted" remainder). Spheres of influence are the downstream effect: which patron a nation actually belongs to right now. Alignment is the cause, sphere membership is the effect, `sphereProjection.ts` is the seam between the two systems.

**Location:** `src/lib/alignment/`, with the per-turn driver in `src/lib/turn/alignmentPhase.ts`.

**Key files:**

- `blocStress.ts` - Bloc-level strain gauge and its damping effect on bloc plays
- `sphereProjection.ts` - Projects pole shares onto sphere membership
- `crossing.ts` - Re-projects a nation's shares when the game crosses into a new alignment era
- `drift.ts` - Bounded passive per-turn movement
- `influence.ts` - Price and cap of a paid influence play
- `membershipEligibility.ts` - Join/leave thresholds for alignment-governed organizations
- `crisisCatalog.ts`, `crisisTurn.ts` - Flashpoint crises (see [crisis-system.md](./crisis-system.md#crisis-catalog-and-bloc-alignment-crisis-chains))
- `normalize.ts`, `project.ts` - Share normalization and lead/status derivation
- `topology.ts`, `rules/customBlocs.ts` - Live poles and channels, including player-founded Blocs

## Rules

### Shares and lead

Each nation has one share per pole of the live topology plus `nonAligned`. `normalizeShares()` in `src/lib/alignment/normalize.ts` is the only write path: every share is a multiple of 0.01 in [0, 100], computed in integer hundredths (`UNITS_PER_POINT = 100`), and `sum(shares) + nonAligned = 100`. A row summing over 100 is scaled proportionally with largest-remainder apportionment, so the ordering of poles is preserved.

`leadFor()` (`project.ts`) is the top share minus the runner-up share, snapped to the hundredth grid. All gates compare against lead, not the top share. `statusFor()` returns the first match of: `player`, `locked` (lead >= 85), `loyal` (member and lead >= join gate), `defection-risk` (member below the gate), `eligible` (non-member, lead >= join gate), `non-aligned` (lead <= 20), else `contested`.

### Gates

| Constant | Value | File |
| --- | --- | --- |
| `ALIGNMENT_GATES.locked` | 85 | `src/lib/constants/alignmentEras.ts` |
| `ALIGNMENT_GATES.nonAligned` | 20 | `src/lib/constants/alignmentEras.ts` |
| `JOIN_GATE_BY_POLE_COUNT` | 2 poles: 50, 3 poles: 40, 4 poles: 35 | `src/lib/constants/alignmentEras.ts` |
| `PER_NATION_TURN_CAP` | 5 | `src/lib/constants/alignmentEras.ts` |
| `CRISIS_TURN_CAP` | 7.5 | `src/lib/constants/alignmentEras.ts` |

`joinGateForPoleCount()` falls back to 50 below two poles and 35 above four. The gate loosens as poles multiply because a four-way split cannot produce a fifty-point lead. This is the same gate the alignment Ledger bands use, so the page and the sphere system cannot disagree about who is committed.

### Bloc stress

A bloc's own cohesion is modeled, not just its members' individual shares: an alliance that grabs half the map should not defend all of it as easily as a compact one. Stress is a 0-1 gauge (`computeBlocStress()`) built from three weighted components of the bloc's own membership:

| Component | Weight | Meaning |
| --- | --- | --- |
| Contested | 0.45 | Fraction of members where a rival pole holds `>= CONTESTED_RIVAL_MIN` (25) share |
| Wants out | 0.35 | Fraction of members with `wantsOutSinceTurn` set |
| Digesting | 0.20 | Fraction of members with `joinedTurn > 0` that joined within `DIGESTION_WINDOW_TURNS` (12 turns) |

Constants live in `src/lib/alignment/blocStress.ts`: the weights (`CONTESTED_WEIGHT`, `WANTS_OUT_WEIGHT`, `DIGESTION_WEIGHT`), `CONTESTED_RIVAL_MIN = 25`, `DIGESTION_WINDOW_TURNS = 12` and `STRESS_MAX_DAMPING = 0.4`.

Formula: `stress = clamp01(0.45 * contested + 0.35 * wantsOut + 0.20 * digesting)`, where each term is a fraction of the bloc's members. It runs from 0 (no member contested, leaving or recent) to 1 (all three at 100%). An empty bloc has stress 0.

`joinedTurn > 0` excludes founding and seeded members, which the seeders stamp with turn 0. Raw member count is deliberately **not** an input: a large bloc of settled, uncontested members should not be penalized for size alone.

`blocPlayEffectiveness(stress)` returns a multiplier on the bloc's own plays: `1 - STRESS_MAX_DAMPING * clamp01(stress)`. A fully-stressed bloc is impaired (60% effectiveness), never inert. `blocStressLabel()` buckets the gauge into `Settled` (< 0.25), `Strained` (< 0.6), or `Overextended` (>= 0.6) for player-facing display.

### Sphere projection

`projectSphereAlignment()` converts a nation's pole shares (0-100) into the sphere system's per-sponsor alignment scale (0-1) by dividing by 100, one entry per sponsored pole in the current era (including zero-share sponsors, so a lapsed patron shows as lapsed rather than disappearing). A pole with no sponsor (`sponsorForPole()` returns null) is skipped. If one country leads two poles, its strongest channel wins.

`primarySphereFor()` determines which patron a nation is actually committed to: it takes the nation's top pole and requires `lead >= joinGateForPoleCount(poleCount)` before returning that pole's sponsor. Below the gate, nobody has committed the nation and there is no primary sphere.

`applyAlignmentToMembership()` writes projected alignment through onto an existing `SphereMembership` document:

- Only relationships that already exist are updated, alignment does not create a new patron relationship (that is the `court` intent's job).
- `integration` (economic entanglement) is never touched by this, it is sphere-owned and lags political sympathy on purpose.
- The primary sponsor is only cleared when the membership shape allows it (no primary with 0-1 relationships); with 2+ relationships and no committed sponsor, it falls back to whichever surviving relationship has the highest alignment, so the record stays valid (`assertValidSphereMembership` requires a primary at 2+ relationships).

### Era crossing

`applyEraCrossing()` re-projects a nation's pole shares onto the poles of a new alignment era, run exactly once per crossing (guarded by the stored `eraKey`, so a long game converts cleanly instead of drifting between vocabularies or re-converting every turn).

- Every surviving pole is seeded at zero first, so a pole nobody inherits into (e.g. Beijing splitting off in a later era) reads as a real zero.
- A pole that survives the era transition keeps its own share.
- A pole that is superseded hands its share to its declared successor (`era.inherit[from]`; `{ WEST: "WASHINGTON", EAST: "MOSCOW" }` for the 1991 crossing).
- A pole with neither is dropped; `normalizeShares` returns that share to the uncommitted pool.

### Drift (passive movement)

Drift is bounded background movement, small enough that a deliberate influence play always outweighs it (`computeDrift()`, `src/lib/alignment/drift.ts`). `NON_ALIGNED_RESISTANCE = 0.5` is defined in `drift.ts`; the gates and caps are in the table above.

1. If `lead >= 85` the nation is returned unchanged: only a deliberate play outside drift can shift it.
2. `resistance = 0.5` if `lead <= 20`, else 1. Genuinely uncommitted countries are hard to move.
3. Per pole: if the pole's own pull is `<= 0` it keeps that (negative) value. Otherwise `net = max(0, own - strongestRivalPull)`. Opposing pulls cancel **before** the cap; allied pulls on the same pole share a key and add.
4. `requested = sum(abs(net)) * resistance`. `scale = cap / requested` if `requested > cap`, else 1, where `cap` is `PER_NATION_TURN_CAP` (5) or the passed `CRISIS_TURN_CAP` (7.5) for a nation with an open crisis.
5. `next[pole] = share[pole] + net[pole] * resistance * scale`, then `normalizeShares()`. A gain comes out of the uncommitted pool first and only bites a rival pole once that pool is exhausted.

The scale is one vector for the whole nation, so the cap bounds the nation's whole turn, not each pole separately. Overflow above the cap is discarded.

### Membership pull

Belonging to an alignment-channel organization exerts its own small passive pull toward that org's pole (`membershipPullForTurn()`):

- `MEMBERSHIP_PULL_PER_TURN = 0.04` (`src/lib/alignment/drift.ts`) share points per turn per unit of channel weight (roughly 1 point every 24 turns before weighting).
- `MEMBERSHIP_PULL_CEILING = 67` (same file): the pull is `max(0, min(0.04 * weight, 67 - currentShare))`. Membership alone can carry a nation to 67, never higher; past 67 and toward the 85 lock needs deliberate plays.
- The ceiling clamps only the passive component; a nation already carried past 67 by deliberate plays keeps every point, drift simply stops adding on top.
- A channel with weight 0 or less pulls nothing. The post-1991 `EU` channel has weight 0.6, so it pulls 0.024 a turn.

### Sanctions erosion

`SANCTIONS_ALIGNMENT_EROSION = 1` (`src/lib/turn/alignmentPhase.ts`). For each active `sanctions` organization legislation against a nation, the sanctioning org's pole receives a pull of `-1 * channel.weight` each turn. It is negative pull, not a push toward a rival: the uncommitted remainder absorbs it and a rival only gains by acting. It is deliberately much larger than one turn of membership pull but still bounded by the cap and resistance like everything else.

### Influence plays and aid

Plays and aid enter the same pull vector as membership pull, so they share the cap, the non-aligned resistance and the locked gate with drift (`src/lib/alignment/influence.ts`):

| Constant | Value |
| --- | --- |
| `PLAY_MAX_POINTS` | 10 (ceiling on one play) |
| `MIN_PLAY_POINTS` | 0.01 (the commit path refuses a smaller spend as `below-min-points`) |
| `POINT_COST_GDP_SHARE` | 0.001 (one point costs 0.1% of the target's annual GDP) |

`pointsForSpend(amountUsd, targetGdpUsd) = min(10, amountUsd / (targetGdpUsd * 0.001))`, and 0 for a non-positive spend or an unpriceable target. The pull toward the channel's pole is `pointsForSpend * channel.weight`, and the phase multiplies it by `blocPlayEffectiveness(stress)` of the paying org. Aid (`queueAidAlignment.ts`) can only reach a member and needs a member vote; a play can reach any nation. Aid is retention, plays are acquisition. A conquered nation swings by `OUTCOME_SWING = PER_NATION_TURN_CAP` (`applyConflictOutcomeAlignment.ts`) outside the turn vector, and that path does move a locked nation.

### Membership eligibility

`standingFor()` (`membershipEligibility.ts`) answers whether a nation can join, or should leave, an alignment-governed organization, measured on the nation's **share** in that org's pole, not its overall lead.

- `JOIN_SHARE = 60` (`src/lib/alignment/membershipEligibility.ts`), share at or above which a nation may join.
- `LEAVE_SHARE = 40` (same file), share at or below which a member is on its way out (`wantsOut`).
- Between 41 and 59 is a deliberate deadband: neither joining nor leaving, so a member doesn't flap in and out of its bloc on a few points of drift.
- `SUSTAIN_TURNS = 24` (same file; half a game year): how long a nation must hold a threshold before the turn phase acts on it.
- The Non-Aligned Movement has no pole of its own; its "share" is the `nonAligned` remainder, evaluated against the same 60/40 thresholds (`NON_ALIGNED_ORG_ID = "NON_ALIGNED"`).
- `governsMembership` is fail-closed: an org whose channel hasn't opted into `alignmentAccession` carries alignment influence but is not actually joined or left on alignment (e.g. the EU's own accession criteria). `standingFor()` returns null for an org with no channel in the era, and every caller must read null as "no condition", never "ineligible".

### Crisis constants

`CRISIS_WINDOW_TURNS = 12`, `TUG_OF_WAR_MIN_SHARE = 25` (`crisis.ts`); `MAX_OPEN_CRISES = 3` and `DEFECTION_CRISIS_AT = SUSTAIN_TURNS / 2 = 12` (`crisisTurn.ts`). A tug of war needs the runner-up share at least 25 and the gap between top two at most `ALIGNMENT_GATES.nonAligned` (20). A crisis grants nothing itself: it only raises that nation's cap from 5 to 7.5.

## Data

| Collection | Fields read or written | Player-visible |
| --- | --- | --- |
| `countryAlignments` | `entityId`, `eraKey`, `shares`, `nonAligned`, `previous`, `joinReadySince`, `turn`, `updatedAt`. Written every turn by the phase; `previous` is the pre-drift snapshot and is null on seed and on crossing | Shares, remainder, lead and trend (shown with two decimals via `formatShare`) |
| `organizationMemberships` | Read: `organizationId`, `countryId`, `joinedTurn`, `wantsOutSinceTurn`. Written: `wantsOutSinceTurn`; removed on defection | Membership; the wants-out clock feeds warnings and stress |
| `alignmentPlays` | Read pending rows (`resolvedTurn: null`). Written on resolve: `resolvedTurn`, `appliedPoints`, `effectivePoints`, `refunded`, `effectivePoleId` | Resolved plays are shown to members as what their money bought |
| `alignmentCrises` | `kind`, `targetEntityId`, `openedTurn`, `closesTurn`, `status`, `resolvedTurn`, `retargetedFrom`; opened and closed by the phase | Crisis desk |
| `sphereMemberships` | `relationships[].alignment`, `primarySphereId`; written through `saveSphereMembership()` | Sphere ledger |
| `organizationLegislation` | Read: active `sanctions` rows and `sanctionsTargetCountryId` | Yes, as legislation |
| `organizationProposals` | Inserted by the accession step (`status: "pending"`, `domesticApproved: true`) | Yes, as a membership proposal |
| `gameState` | Read: `intOrgAlignmentEnabled`, year fields | Not directly |

The phase also writes refunds to the organization fund (`creditOrganizationFund`). Bloc stress is not stored: it is computed each turn per channel org and returned in the phase result (`blocStress`, rounded to 3 decimals); the Influence tab recomputes it in `queries/orgInfluence.ts`.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `gameState.intOrgAlignmentEnabled` | Off (fail-closed: only an explicit `true` enables) | Admin Feature Gates panel; read by `featureFlag.ts` |
| Era table `ALIGNMENT_ERAS` | `cold-war` 1945-1990: poles `WEST`, `EAST`; `post-cold-war` from 1991: `WASHINGTON`, `MOSCOW`, `BEIJING` | `src/lib/constants/alignmentEras.ts` |
| Channels, cold-war | `NATO` to `WEST`, `WARSAW_PACT` to `EAST`, each weight 1 and `alignmentAccession: true` | same file |
| Channels, post-cold-war | `NATO` to `WASHINGTON` (weight 1, accession true), `EU` to `WASHINGTON` (weight 0.6, no accession). `MOSCOW` and `BEIJING` have no channel org | same file |
| Player-founded Blocs | Add an `ORG:<id>` pole and a channel with weight 1 and `alignmentAccession: true` | `buildAlignmentTopology()` in `rules/customBlocs.ts`, loaded by `topology.ts` |
| Opening shares | Authored per roster key and preset, with `METROPOLE_RETENTION = 0.85`, `DECOLONISED_RETENTION = 0.3`, `DEFAULT_LEAN = 34`, `NON_MEMBER_SEED_CAP = 50` | `src/lib/alignment/seedAlignment.ts` |

The Commonwealth deliberately carries no channel: stacking it behind NATO gave the West a permanent 1.75-to-1 advantage over the Warsaw Pact that no play could answer. Everything else in the Rules section is a compiled constant, not runtime config.

## Timing

Alignment runs once per turn as the `alignment` phase (`processAlignmentTurn()` in `src/lib/turn/alignmentPhase.ts`, registered in `src/simulation/phases/turnPhaseRegistry.ts`). It is sequential and runs after the batch that contains the `internationalOrganizations` phase, because drift reads the organization memberships that phase writes. The `settlement` phase runs after it and reads live bloc membership; `mutualDefence` follows, reading alliance membership including alignment defections.

```
internationalOrganizations (batch)
        |
        v
alignment:  gate check -> load rows, memberships, plays, sanctions
            -> bloc stress per channel org
            -> self-heal missing rows
            -> close due crises, read open-crisis targets
            -> for each nation:
                 era crossing -> membership pull -> sanctions erosion
                 -> plays (x effectiveness) -> computeDrift -> write row
                 -> resolve plays -> sync sphere membership
            -> open new crises on the settled state
            -> defection sweep -> accession requests
            -> resolve orphan plays
        |
        v
settlement -> mutualDefence
```

With the master gate off the phase returns zeroed counters and touches nothing.

## Worked trace

A two-pole (1955) NATO member holds `WEST 52`, `EAST 30`, `nonAligned 18`, with no open crisis. The Warsaw Pact commits a play of USD 120 million against it; the target's annual GDP is USD 20 billion. The Warsaw Pact's stress is 0.225 (10 members: 3 contested, 2 wanting out, 1 digesting).

1. Stress: `0.45 * 0.3 + 0.35 * 0.2 + 0.20 * 0.1 = 0.135 + 0.07 + 0.02 = 0.225` (Settled). Effectiveness `1 - 0.4 * 0.225 = 0.91`.
2. Era crossing: stored key is `cold-war`, no change.
3. Membership pull (NATO, weight 1): `max(0, min(0.04, 67 - 52)) = 0.04` on `WEST`. This is the `background` vector.
4. Play: `pointsForSpend = min(10, 120,000,000 / (20,000,000,000 * 0.001)) = 120,000,000 / 20,000,000 = 6`. Times weight 1 and 0.91 gives 5.46 pull on `EAST`.
5. Drift: lead = 52 - 30 = 22, so not locked (85) and not in the band (20), resistance 1. Net `WEST = max(0, 0.04 - 5.46) = 0`; net `EAST = max(0, 5.46 - 0.04) = 5.42`. `requested = 5.42 > cap 5`, so `scale = 5 / 5.42 = 0.9225`; EAST delta = `5.42 * 1 * 0.9225 = 5.00`.
6. Shares: `EAST 35`, `WEST 52`; `normalizeShares` leaves `nonAligned = 100 - 87 = 13`. The gain came out of the uncommitted pool.
7. Play record: `appliedPoints = 5.46` (pre-cap, rounded to a hundredth), `effectivePoints = 5.00` (the observed gain; the background pull on `EAST` is 0, so the play takes all of it), `refunded: false`.
8. Result: new lead 52 - 35 = 17, so the nation is now in the non-aligned band. NATO share 52 is above `LEAVE_SHARE` 40, so no wants-out clock. `primarySphereFor()` needs lead 50, so there is no committed sponsor; with 2+ sphere relationships the primary falls back to the highest-alignment one (projected 0.52 for the US, 0.35 for Russia).

If the nation had an open crisis, `cap = 7.5` and the full 5.42 would apply, giving `EAST 35.42`.

An era crossing for the same row on 1991: `WEST 52 -> WASHINGTON 52`, `EAST 30 -> MOSCOW 30`, `BEIJING 0`, `nonAligned 18`; `previous` is set to null for that turn, and the join gate becomes 40.

## Edge cases and limits

- A nation at lead 85 or more cannot be moved by drift at all, so membership pull never makes a nation locked by itself (the pull ceiling of 67 sits well under 85). `commitInfluencePlay` refuses a locked target up front (`target-locked`); a conquest swing is the exception.
- Drift in the non-aligned band is halved so an uncommitted country is not nudged into a bloc by background noise.
- Opposing pulls cancel before the cap. Splitting effort between two poles wastes it.
- Overflow above the per-turn cap is discarded, not carried forward.
- A play that resolves to exactly 0 applied points (the target locked or lost its row between commit and resolve) is refunded to the org fund. Aid rows (`source: "aid"`) are never refunded, because the money already left for the recipient. A play scaled down by the cap is not a refund case.
- A play whose channel org lost its channel at an era crossing resolves at zero. A play whose target has no alignment row resolves at zero in the orphan sweep.
- A play against an unpriceable target (GDP of zero or unknown) buys nothing: zero here would otherwise make an unpriceable nation free to flip.
- Zero-share sponsors still get an entry in `projectSphereAlignment()`, so a lapsed patron is visible as lapsed.
- `applyAlignmentToMembership()` never creates a patron relationship and never touches `integration`.
- Bloc stress ignores member count on purpose. Stress damps a bloc's plays by at most 40%.
- Founding and seeded members (joined turn 0) never count as digesting.
- The deadband between 41 and 59 share prevents join/leave flapping, and the 24-turn hold means one bad turn cannot flip membership. Leaving needs a sustained run: recovering or sitting in the deadband clears `wantsOutSinceTurn`.
- Player-controlled countries are never pulled out of an alliance and never auto-apply to join one: the phase counts a defection warning instead.
- Accession only asks: a non-player nation that held `JOIN_SHARE` for `SUSTAIN_TURNS` in a bloc's pole files a proposal (`domesticApproved: true`) and the org's member vote decides. A refused applicant does not re-apply for `SUSTAIN_TURNS`.
- Dissolved countries are dropped from the phase's rows and defection sweep.
- Organizations that have not opted into `alignmentAccession` carry influence but never join or leave on alignment (fail-closed).
- A pole that disappears at an era crossing with no declared successor returns its share to the uncommitted pool.
- A non-member opening share in a bloc's pole is capped at 50 (`NON_MEMBER_SEED_CAP`), below the 60 join share, so a world does not open with unplayed nations applying on turn one.

## Invariants

- Every stored row satisfies `sum(shares) + nonAligned = 100` with hundredth precision. Enforced by routing every write through `normalizeShares()`; tested in `src/lib/alignment/normalize.test.ts` and "always writes a row whose shares still total 100" in `src/lib/turn/alignmentPhase.test.ts`.
- A locked nation does not move by drift or play. Tested ("does not move a locked nation even with a play against it", "stamps zero when the target locked between commit and resolution").
- Passive membership pull never carries a share past 67. Tested in `drift.test.ts` and "will not carry a member past the drift ceiling".
- A sphere membership with two or more relationships always has a primary. Enforced at save by `assertValidSphereMembership()` in `membershipStore.ts`.
- A refund is credited only for non-aid plays. Tested ("never refunds an aid row").
- Stress stays in [0, 1] (`clamp01`) and effectiveness never drops below 0.6.
- One open crisis per nation and at most 3 open at once: enforced in `openDueCrises()` by construction, covered by `crisisTurn.test.ts`.
- Not enforced: that every write path actually goes through `normalizeShares()`. The file comment states a bypass is a defect, but nothing scans for one.

## Failure and recovery

- **Phase off by accident.** With `intOrgAlignmentEnabled` not set the phase returns zero counters and shares freeze. Recovery: set the gate; the next turn resumes from stored rows.
- **Missing alignment row.** A nation created after world seeding (decolonisation) or seated in a bloc without a sphere record would have frozen alignment. The phase self-heals by inserting an opening row from `resolveOpeningShares()` and crossing it into the live era on the same turn (`rowsHealed`).
- **Row in the wrong era vocabulary.** The stored `eraKey` drives crossing, so a row left behind is re-projected automatically on the next turn.
- **Stuck pending plays.** Plays whose target has no row, or whose channel vanished, are resolved at zero rather than left to accumulate.
- **Stale defectors.** A dissolved country's leftover membership rows are skipped by the sweep and cleaned up by the merge, not the drift engine.
- **Bad shares in storage.** If a row fails the sum-to-100 invariant, a data repair (heal) re-normalizes it; the phase's own next write also renormalizes.
- Refunds make a play whose target locked in flight whole again, so the usual player complaint "my money vanished" does not occur for zero-resolve plays.

## Connections

Driven by:

- International organization membership: `internationalOrganizations` phase writes the memberships that supply membership pull and bloc stress. See `src/lib/alignment/drift.ts`.
- Organization legislation: active sanctions erode the sanctioning bloc's standing (`SANCTIONS_ALIGNMENT_EROSION` in `alignmentPhase.ts`).
- Deliberate influence plays and aid by blocs and players (`commitInfluencePlay.ts`, `queueAidAlignment.ts`): these are the only way past the 67 membership ceiling and the 85 lock. War outcomes swing conquered hosts via `applyConflictOutcomeAlignment.ts`.
- [Crisis system](./crisis-system.md): an open crisis raises a nation's per-turn cap from 5 to 7.5 (`openCrisisTargets()` in `crisisTurn.ts`).
- The alignment era table in `src/lib/constants/alignmentEras.ts`: poles, gates and successors per era.

Affects:

- Sphere memberships: `applyAlignmentToMembership()` in `sphereProjection.ts` writes alignment, and the primary sponsor, onto existing `SphereMembership` records.
- The `settlement` phase, which reads live bloc membership after alignment has run, and `mutualDefence`, which reads alliance membership after defections.
- Organization joins and defections: `standingFor()` decides who may accede or is on the way out, and defection warnings and defections come out of the same phase (through `removeOrganizationMembership()`, the same path a withdrawal bill uses).
- Bloc plays: `blocPlayEffectiveness()` scales a bloc's own influence by up to 40% down, read through `src/lib/alignment/queries/orgInfluence.ts`.
- [Crisis system](./crisis-system.md): sustained `wantsOutSinceTurn` feeds the defection-crisis trigger once it is 12 turns old.

International organizations and their alignment channels are defined in `src/lib/constants/alignmentEras.ts`.

## Tests

- `src/lib/alignment/blocStress.test.ts`, `drift.test.ts`, `crossing.test.ts`, `membershipEligibility.test.ts`, `sphereProjection.test.ts`, `normalize.test.ts`, `project.test.ts`, `influence.test.ts`
- `src/lib/alignment/crisis.test.ts`, `crisisTurn.test.ts`, `topology.test.ts`, `featureFlag.test.ts`
- `src/lib/alignment/seedAlignment.test.ts`, `seedCountryAlignments.test.ts`
- `src/lib/alignment/rules/effectivePlayPoints.test.ts`, `customBlocs.test.ts`
- `src/lib/alignment/queries/orgInfluence.test.ts`
- `src/lib/alignment/commands/commitInfluencePlay.test.ts`, `queueAidAlignment.test.ts`
- `src/lib/turn/alignmentPhase.test.ts`: gate-off, crossing, drift, sphere sync, healing, plays, refunds, stress, sanctions, defection, accession.

Gaps: no test for the exact sanctions-erosion magnitude against a mixed-weight channel set, and no test that scans for writes that bypass `normalizeShares()`.

## Known issues and history

- The wording in `influence.ts` for `pointsForSpend` ("1% of their economy is 1 point ... spending past 5% of their GDP is visibly wasted") is stale. The price is `POINT_COST_GDP_SHARE = 0.001`, so one point costs 0.1% of GDP and the 5-point cap is reached at 0.5% of GDP. The player wiki repeats the 5% claim (see the player guide's tips).
- The player wiki says a "wants out" member counts toward stress after holding 40 or less for 24 turns. In code, `wantsOutSinceTurn` is stamped the first turn the share is at or below 40, and the stress term counts any member with it set. The 24-turn hold only gates the actual defection.
- The `ALIGNMENT_ERAS` comment on the post-Cold-War era says "Four poles", but the era defines three (`WASHINGTON`, `MOSCOW`, `BEIJING`); the 4-pole join gate of 35 applies only when a player-founded Bloc adds a pole.
- The `alignmentAccession` comment names the Non-Aligned Movement among the opted-in blocs, but no `ALIGNMENT_ERAS` channel exists for it; it is handled through the `NON_ALIGNED_ORG_ID` special case in `standingFor()`.
- Contested was originally "our share below the locked gate (85)", which made most of both blocs contested on day one and was asymmetric between NATO and the Warsaw Pact. It is now the rival's share (`CONTESTED_RIVAL_MIN = 25`).
- Membership pull used to be 2 points a turn and now is 0.04, after it carried members to locked inside half a game year. Share precision moved from whole numbers to tenths to hundredths for the same reason: sub-point effects were rounding to zero.
- Founders used to be skipped by the defection sweep, which let a seed founder hold two rival bloc memberships (ticket #1285). They are now judged like any other member.

Last checked: 2026-10-29, version 1.18.0
