# Bloc Alignment and Spheres of Influence

Player guide: [Bloc Alignment & Spheres of Influence](https://www.ahousedividedgame.com/wiki/bloc-spheres)

## Overview

Alignment tracks how drawn each nation is toward each Cold War pole (0-100 shares that sum with an "uncommitted" remainder). Spheres of influence are the downstream effect: which patron a nation actually belongs to right now. Alignment is the cause, sphere membership is the effect, `sphereProjection.ts` is the seam between the two systems.

**Location:** `src/lib/alignment/`

**Key files:**

- `blocStress.ts` - Bloc-level strain gauge and its damping effect on bloc plays
- `sphereProjection.ts` - Projects pole shares onto sphere membership
- `crossing.ts` - Re-projects a nation's shares when the game crosses into a new alignment era
- `drift.ts` - Bounded passive per-turn movement
- `membershipEligibility.ts` - Join/leave thresholds for alignment-governed organizations
- `crisisCatalog.ts`, `crisisTurn.ts` - Flashpoint crises (see [crisis-system.md](./crisis-system.md#crisis-catalog-and-bloc-alignment-crisis-chains))
- `normalize.ts`, `project.ts` - Share normalization and lead/status derivation

## Bloc Stress

A bloc's own cohesion is modeled, not just its members' individual shares, an alliance that grabs half the map should not defend all of it as easily as a compact one. Stress is a 0-1 gauge (`computeBlocStress()`) built from three weighted components of the bloc's own membership:

| Component     | Weight | Meaning                                                                 |
| ------------- | ------ | ------------------------------------------------------------------------ |
| Contested     | 0.45   | Fraction of members where a rival pole holds `>= CONTESTED_RIVAL_MIN` (25) share |
| Wants out     | 0.35   | Fraction of members with `wantsOutSinceTurn` set (sustained-leave signal from `membershipEligibility.ts`) |
| Digesting     | 0.20   | Fraction of members that joined within `DIGESTION_WINDOW_TURNS` (12 turns) |

Constants live in `src/lib/alignment/blocStress.ts`: the weights, `CONTESTED_RIVAL_MIN = 25`, `DIGESTION_WINDOW_TURNS = 12` and `STRESS_MAX_DAMPING = 0.4`. The stress gauge is a weighted sum of the three fractions, so it runs from 0 (no member contested, leaving or recent) to 1 (all three at 100%).

Raw member count is deliberately **not** an input, a large bloc of settled, uncontested members should not be penalized for size alone.

`blocPlayEffectiveness(stress)` returns a multiplier on the bloc's own plays: `1 - STRESS_MAX_DAMPING * stress`, where `STRESS_MAX_DAMPING = 0.4`. A fully-stressed bloc is impaired (60% effectiveness), never inert. `blocStressLabel()` buckets the gauge into `Settled` (<0.25), `Strained` (<0.6), or `Overextended` (>=0.6) for player-facing display.

## Sphere Projection

`projectSphereAlignment()` converts a nation's pole shares (0-100) into the sphere system's per-sponsor alignment scale (0-1), one entry per sponsored pole in the current era (including zero-share sponsors, so a lapsed patron shows as lapsed rather than disappearing).

`primarySphereFor()` determines which patron a nation is actually committed to: it takes the nation's top pole and requires `lead >= joinGateForPoleCount(poleCount)` (the same gate the alignment Ledger's bands use) before returning a sponsor. The gate is `JOIN_GATE_BY_POLE_COUNT` in `src/lib/constants/alignmentEras.ts`: lead 50 in a two-pole era, 40 with three poles, 35 with four (any other count falls back to 50 below two poles, 35 above four). It loosens as poles multiply because a four-way split cannot produce a fifty-point lead. Below that gate, nobody has committed the nation and there is no primary sphere.

`applyAlignmentToMembership()` writes projected alignment through onto an existing `SphereMembership` document:

- Only relationships that already exist are updated, alignment does not create a new patron relationship (that is the `court` intent's job).
- `integration` (economic entanglement) is never touched by this, it is sphere-owned and lags political sympathy on purpose.
- The primary sponsor is only cleared when the membership shape allows it (no primary with 0-1 relationships); with 2+ relationships and no committed sponsor, it falls back to whichever surviving relationship has the highest alignment, so the record stays valid.

## Era Crossing

`applyEraCrossing()` re-projects a nation's pole shares onto the poles of a new alignment era, run exactly once per crossing (guarded by a stored era key so a long game converts cleanly instead of drifting between vocabularies or re-converting every turn).

- Every surviving pole is seeded at zero first, so a pole nobody inherits into (e.g. Beijing splitting off in a later era) reads as a real zero.
- A pole that survives the era transition keeps its own share.
- A pole that is superseded hands its share to its declared successor (`era.inherit[from]`).
- A pole with neither is dropped; `normalizeShares` returns that share to the uncommitted pool.

## Drift (Passive Movement)

Drift is bounded background movement, small enough that a deliberate influence play always outweighs it (`computeDrift()`, `src/lib/alignment/drift.ts`).

Constants: `ALIGNMENT_GATES = { locked: 85, nonAligned: 20 }`, `PER_NATION_TURN_CAP = 5` and `CRISIS_TURN_CAP = 7.5` in `src/lib/constants/alignmentEras.ts`; `NON_ALIGNED_RESISTANCE = 0.5` in `src/lib/alignment/drift.ts`.

- A nation at or above `ALIGNMENT_GATES.locked` (85 lead) is immovable by drift; only a deliberate play can shift it.
- A nation in the non-aligned band (`lead <= ALIGNMENT_GATES.nonAligned`, 20) absorbs drift at half rate (`NON_ALIGNED_RESISTANCE = 0.5`), genuinely uncommitted countries are hard to move.
- Opposing pulls on different poles cancel **before** the per-turn cap applies, so only the net margin survives; allied pulls on the same pole simply add.
- The scaled result is capped by `PER_NATION_TURN_CAP = 5` share points per turn, or `CRISIS_TURN_CAP = 7.5` for a nation with an open crisis (see crisis chains).

### Membership Pull

Belonging to an alignment-channel organization exerts its own small passive pull toward that org's pole (`membershipPullForTurn()`):

- `MEMBERSHIP_PULL_PER_TURN = 0.04` (`src/lib/alignment/drift.ts`) share points per turn per unit of channel weight (roughly 1 point every 24 turns, half a game year, before weighting).
- Capped at `MEMBERSHIP_PULL_CEILING = 67` (`src/lib/alignment/drift.ts`) share points, membership alone can carry a nation to 67, never higher. Getting a nation past 67 (and up toward the 85 locked gate) requires deliberate plays, not just standing membership.
- The ceiling clamps only the passive component; a nation already carried past 67 by deliberate plays keeps every point, drift simply stops adding on top.

## Membership Eligibility

`standingFor()` (`membershipEligibility.ts`) answers whether a nation can join, or should leave, an alignment-governed organization, measured on the nation's **share** in that org's pole, not its overall lead.

- `JOIN_SHARE = 60` (`src/lib/alignment/membershipEligibility.ts`), share at or above which a nation may join.
- `LEAVE_SHARE = 40` (same file), share at or below which a member is on its way out (`wantsOut`).
- Between 41 and 59 is a deliberate deadband: neither joining nor leaving, so a member doesn't flap in and out of its bloc on a few points of drift.
- `SUSTAIN_TURNS = 24` (same file; half a game year): how long a nation must hold a threshold before the turn phase acts on it. This is also what feeds `wantsOutSinceTurn` into bloc stress and the defection-crisis trigger.
- The Non-Aligned Movement has no pole of its own; its "share" is the `nonAligned` remainder, evaluated against the same 60/40 thresholds.
- `governsMembership` is fail-closed: an org whose channel hasn't opted into `alignmentAccession` carries alignment influence but is not actually joined or left on alignment (e.g. the Commonwealth's former-empire association, the EU's own accession criteria).

## Worked example

A nation holds 52 share toward one pole, 30 toward its rival and 18 uncommitted, in a two-pole era. Its lead is 22, so it sits just above the non-aligned band (20) and absorbs drift at full rate, but below the join gate of 50, so it has no primary sphere. If the rival bloc pushes 12 raw points of influence at it in one turn and its own patron pushes 4, the opposing pulls cancel first (net 8), then the 5-point per-nation cap applies, so it moves 5 points that turn. With an open crisis the cap is 7.5 and the full 8 would be cut to 7.5.

## Timing

Alignment runs once per turn as the `alignment` phase (`processAlignmentTurn()` in `src/lib/turn/alignmentPhase.ts`, registered in `src/simulation/phases/turnPhaseRegistry.ts`). It is deliberately sequential and runs after the batch that contains the `internationalOrganizations` phase, because drift reads the organization memberships that phase writes. The `settlement` phase runs after it and reads live bloc membership.

Order inside the phase:

1. Bloc stress is computed once per alignment channel from the memberships and shares already loaded.
2. Each nation's shares are re-projected if the game has crossed into a new alignment era (`applyEraCrossing()`, once per crossing, guarded by the stored era key).
3. Drift and membership pull are computed (`computeDrift()`, `membershipPullForTurn()`) under the normal or crisis cap, then written.
4. Projected alignment is written through to existing sphere memberships (`applyAlignmentToMembership()`).
5. New flashpoint crises open on the settled state and due crises close (`openDueCrises()`, `closeDueCrises()` in `crisisTurn.ts`).
6. The defection sweep applies `standingFor()` to every governed membership, setting or clearing `wantsOutSinceTurn` and acting once a nation has held a threshold for `SUSTAIN_TURNS`.

## Edge cases and limits

- A nation at lead 85 or more cannot be moved by drift at all, so membership pull never makes a nation locked by itself (the pull ceiling of 67 sits well under 85).
- Drift in the non-aligned band is halved so an uncommitted country is not nudged into a bloc by background noise.
- Opposing pulls cancel before the cap. Splitting effort between two poles wastes it.
- Overflow above the per-turn cap is discarded, not carried forward.
- Zero-share sponsors still get an entry in `projectSphereAlignment()`, so a lapsed patron is visible as lapsed.
- `applyAlignmentToMembership()` never creates a patron relationship and never touches `integration`, which is economic entanglement owned by the sphere system and lags political sympathy on purpose.
- If the membership has two or more relationships and no sponsor clears the join gate, the primary falls back to the relationship with the highest alignment so the record stays valid.
- Bloc stress ignores member count on purpose. Stress damps a bloc's plays by at most 40%, so a fully stressed bloc is never inert.
- The deadband between 41 and 59 share prevents join/leave flapping, and the 24-turn hold means one bad turn cannot flip membership.
- Organizations that have not opted into `alignmentAccession` carry influence but never join or leave on alignment (fail-closed).
- A pole that disappears at an era crossing with no declared successor returns its share to the uncommitted pool.

## Connections

Driven by:

- International organization membership: `internationalOrganizations` phase writes the memberships that supply membership pull and bloc stress. See `src/lib/alignment/drift.ts`.
- Deliberate influence plays by blocs and players: these are the only way past the 67 membership ceiling and the 85 lock.
- [Crisis system](./crisis-system.md): an open crisis raises a nation's per-turn cap from 5 to 7.5 (`openCrisisTargets()` in `crisisTurn.ts`).
- The alignment era table in `src/lib/constants/alignmentEras.ts`: poles, gates and successors per era.

Affects:

- Sphere memberships: `applyAlignmentToMembership()` in `sphereProjection.ts` writes alignment, and the primary sponsor, onto existing `SphereMembership` records.
- The `settlement` phase, which reads live bloc membership after alignment has run.
- Organization joins and defections: `standingFor()` decides who may accede or is on the way out, and defection warnings and defections come out of the same phase.
- Bloc plays: `blocPlayEffectiveness()` scales a bloc's own influence by up to 40% down, read through `src/lib/alignment/queries/orgInfluence.ts`.
- [Crisis system](./crisis-system.md): sustained `wantsOutSinceTurn` feeds the defection-crisis trigger.

International organizations and their alignment channels are defined in `src/lib/constants/alignmentEras.ts`.

Last checked: 2026-10-29, version 1.18.0
