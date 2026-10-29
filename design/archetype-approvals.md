# Archetype Approvals System

Historical record: this page describes work as of the original archetype-approval design, before archetypes were replaced by census buckets. For current behaviour see [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md).

> **DEPRECATED, legacy behavior, not the live model.** The 12-archetype voter system this document was written to design is dead as an independent electorate model. Per project doctrine, archetypes have no plan B, no independent display, and no independent targets. In the shipped code, `archetypeApprovals` and the archetype id itself now function purely as a **bucket-keyed compatibility shim**: `src/lib/demographics/archetypeBucketMap.ts` projects each archetype-keyed value onto 2-3 Layer-1 census buckets (weights summing to 1.0) so legacy-authored effects (character/NPP approvals, legislation `demographicEffects`, Address favorability, GOTV modifiers) still land on the **granular Layer-1 electorate**, which is the actual vote path for every country (see [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md)). There is no independent archetype vote-share logic left anywhere in the engine. The schema-change and gap-analysis content below describes the historical design that shipped the `archetypeApprovals` field; read it as a record of that legacy system, not as current architecture guidance.

## Overview

This document describes the system for tracking voter archetype approvals for politicians (both player characters and NPPs), integrating with legislation votes, displaying in polls, and implementing approval decay over time.

**This describes the legacy archetype-approval system as originally shipped.** The archetype id is retained today only as a bucket-projection key (see the deprecation notice above); nothing below should be read as a description of the current live vote model.

## Current State Analysis

### Existing Infrastructure

1. **Character.groupFavorability** (`Record<string, number>`) - Already exists, stores per-group favorability
2. **voteImpacts.ts** - Records how votes affect group favorability via `recordVoteImpacts()`
3. **LegislationType.policyOptions[].groupApprovals** - Defines which groups approve/disapprove of policies
4. **Poll system** - Already displays group-level results with appeal calculations

### Gap Analysis

| Component           | Current State                          | Needed                        |
| ------------------- | -------------------------------------- | ----------------------------- |
| Character approvals | Uses old groups (college, urban, etc.) | Migrate to 12 archetypes      |
| NPP approvals       | Not implemented                        | Add groupFavorability field   |
| Legislation impacts | Uses old groups                        | Add archetypeApprovals field  |
| Poll display        | Shows old groups                       | Show archetype approvals      |
| Approval decay      | Not implemented                        | Add turn-based decay          |
| 2020 baseline       | Not implemented                        | Pre-bake historical approvals |

## The 12 Voter Archetypes

```typescript
const VOTER_ARCHETYPES = [
  "young_renters", // Young, low-income, liberal
  "evangelicals", // Religious conservatives
  "rural_traditionalists", // Rural, conservative, gun owners
  "union_trades", // Working class, economic left
  "soccer_moms", // Suburban swing voters
  "college_liberals", // Educated progressives
  "small_business", // Entrepreneurial, economic right
  "public_sector", // Government workers, union-aligned
  "retirees", // Seniors, moderate conservative
  "libertarians", // Economic right, socially moderate
  "new_immigrants", // Hispanic/Asian, lean Democratic
  "secular_professionals", // High-education, socially liberal
] as const;
```

## Schema Changes

### 1. NPP Schema Update

```typescript
// src/lib/db/types/npp.ts
export interface NPP {
  // ... existing fields ...

  // NEW: Per-archetype approval ratings (-100 to +100)
  archetypeApprovals?: Record<string, number>;

  // NEW: Last turn approvals were updated (for decay calculation)
  approvalsLastUpdated?: number;
}
```

### 2. Character Schema Update

```typescript
// src/lib/db/types/character.ts
export interface Character {
  // ... existing fields ...

  // EXISTING: Keep for backwards compatibility during migration
  groupFavorability?: Record<string, number>;

  // NEW: Per-archetype approval ratings (-100 to +100)
  archetypeApprovals?: Record<string, number>;

  // NEW: Last turn approvals were updated (for decay calculation)
  approvalsLastUpdated?: number;
}
```

### 3. LegislationType Schema Update

```typescript
// src/lib/db/types/legislation.ts
export interface LegislationPolicyOption {
  // ... existing fields ...

  // EXISTING: Keep old groupApprovals for compatibility
  groupApprovals?: Record<string, number>;

  // NEW: Archetype-specific approval impacts
  archetypeApprovals?: Record<string, number>;

  // NEW: Per-turn membership drift while this policy is active
  archetypeMembershipDrift?: Record<string, number>;
}
```

### 4. New VoteImpact Schema

```typescript
// src/lib/db/types/voteImpact.ts
export interface VoteImpact {
  // ... existing fields ...

  // NEW: Archetype-specific impacts (separate from old groupImpacts)
  archetypeImpacts?: Record<string, number>;
}
```

## Approval Value Semantics

| Value | Meaning                                 |
| ----- | --------------------------------------- |
| -100  | Strongly opposed (would never vote for) |
| -50   | Disapproves (unlikely to vote for)      |
| 0     | Neutral (no opinion)                    |
| +50   | Approves (likely to vote for)           |
| +100  | Strongly approves (strong supporter)    |

**Starting baseline**: 0 (neutral) for all archetypes, modified by:

1. 2020 pre-baked values based on party/position
2. Legislation votes
3. Active law effects
4. Campaign actions (future)

## Implementation Phases

### Phase 1: Schema & Data Layer **[COMPLETE]**

**Files modified:**

- `src/lib/db/types/npp.ts` - Added `archetypeApprovals?: Record<string, number>`
- `src/lib/db/types/character.ts` - Added `archetypeApprovals?: Record<string, number>`
- `src/lib/db/types/statePolicy.ts` - Added `archetypeImpacts?: Record<string, number>` to `VoteImpact`
- `src/lib/db/types/legislation.ts` - Added `archetypeApprovals` to policy options (done earlier)

### Phase 2: Legislation Tagging **[COMPLETE]**

**Done:** Updated all helper functions in `scripts/seeds/legislationTypes.ts` to generate `archetypeApprovals` instead of the old `groupApprovals`. All 76 legislation types now automatically get archetype-based approvals.

Example mappings:

```typescript
// Environmental Protection
archetypeApprovals: {
  college_liberals: 25,
  secular_professionals: 20,
  young_renters: 15,
  small_business: -20,
  rural_traditionalists: -15,
  libertarians: -10,
}

// Gun Rights Expansion
archetypeApprovals: {
  rural_traditionalists: 30,
  evangelicals: 20,
  libertarians: 25,
  soccer_moms: -25,
  college_liberals: -30,
  secular_professionals: -20,
}

// Tax Cuts
archetypeApprovals: {
  small_business: 30,
  libertarians: 25,
  retirees: 10,
  public_sector: -25,
  college_liberals: -15,
  union_trades: -10,
}
```

### Phase 3: Vote Recording Update **[COMPLETE]**

**Modified `src/lib/voteImpacts.ts`:**

- Added detection of archetype system vs legacy group system
- Records `archetypeImpacts` in VoteImpact documents
- Added `applyArchetypeApprovalChanges()` function with value clamping (-100 to +100)

**Implementation:**

```typescript
async function recordVoteImpactsForProvision(
  db: Db,
  bill: Bill | StateBill,
  chamber: "house" | "senate" | "state_senate",
  currentTurn: number,
  legislationTypeId: string,
  effectDirection: number
): Promise<void> {
  // ... existing code ...

  // NEW: Process archetype approvals
  if (policyOption?.archetypeApprovals) {
    for (const [characterIdStr, vote] of Object.entries(votes)) {
      if (vote === "abstain") continue;

      const archetypeImpacts: Record<string, number> = {};

      for (const [archetypeId, approval] of Object.entries(policyOption.archetypeApprovals)) {
        archetypeImpacts[archetypeId] =
          vote === "for" ? approval * VOTE_IMPACT_SCALE : -approval * VOTE_IMPACT_SCALE;
      }

      await applyArchetypeApprovalChanges(db, characterIdStr, archetypeImpacts);
    }
  }
}

async function applyArchetypeApprovalChanges(
  db: Db,
  characterId: string,
  archetypeImpacts: Record<string, number>
): Promise<void> {
  const incUpdates: Record<string, number> = {};

  for (const [archetypeId, impact] of Object.entries(archetypeImpacts)) {
    incUpdates[`archetypeApprovals.${archetypeId}`] = impact;
  }

  // Update both Character and NPP collections
  await db
    .collection("characters")
    .updateOne(
      { _id: new ObjectId(characterId) },
      { $inc: incUpdates, $set: { approvalsLastUpdated: currentTurn } }
    );

  await db
    .collection("npps")
    .updateOne(
      { _id: new ObjectId(characterId) },
      { $inc: incUpdates, $set: { approvalsLastUpdated: currentTurn } }
    );
}
```

### Phase 4: Approval Decay **[COMPLETE]**

**Created `src/lib/turn/archetypeApprovalDecay.ts`** and added to turn processing in `src/lib/turnSystem.ts`:

- 0.5% decay per turn toward 0
- Values below 0.01 threshold are zeroed out
- Processes both characters and NPPs
- Added as phase 14c in turn processing (after policyReactionDecay)

**Implementation:**

```typescript
const APPROVAL_DECAY_RATE = 0.005; // 0.5% decay toward neutral per turn

export async function processApprovalDecay(db: Db): Promise<void> {
  // Process characters, use bulk operations for efficiency
  const characters = await db
    .collection("characters")
    .find({
      archetypeApprovals: { $exists: true },
    })
    .toArray();

  const bulkOps = [];

  for (const char of characters) {
    const updates: Record<string, number> = {};
    let hasUpdates = false;

    for (const [archetype, approval] of Object.entries(char.archetypeApprovals || {})) {
      if (approval === 0) continue; // Skip already-neutral

      // Decay toward 0 (neutral)
      const decayedValue = approval * (1 - APPROVAL_DECAY_RATE);
      // Round small values to 0 to prevent floating point accumulation
      updates[`archetypeApprovals.${archetype}`] = Math.abs(decayedValue) < 0.5 ? 0 : decayedValue;
      hasUpdates = true;
    }

    if (hasUpdates) {
      bulkOps.push({
        updateOne: {
          filter: { _id: char._id },
          update: { $set: updates },
        },
      });
    }
  }

  if (bulkOps.length > 0) {
    await db.collection("characters").bulkWrite(bulkOps);
  }

  // Same for NPPs
  const npps = await db
    .collection("npps")
    .find({
      archetypeApprovals: { $exists: true },
    })
    .toArray();

  const nppBulkOps = [];

  for (const npp of npps) {
    const updates: Record<string, number> = {};
    let hasUpdates = false;

    for (const [archetype, approval] of Object.entries(npp.archetypeApprovals || {})) {
      if (approval === 0) continue;

      const decayedValue = approval * (1 - APPROVAL_DECAY_RATE);
      updates[`archetypeApprovals.${archetype}`] = Math.abs(decayedValue) < 0.5 ? 0 : decayedValue;
      hasUpdates = true;
    }

    if (hasUpdates) {
      nppBulkOps.push({
        updateOne: {
          filter: { _id: npp._id },
          update: { $set: updates },
        },
      });
    }
  }

  if (nppBulkOps.length > 0) {
    await db.collection("npps").bulkWrite(nppBulkOps);
  }
}
```

**Decay behavior:**

- 0.5% per turn → ~22% decay per game year (48 turns)
- An approval of +100 decays to ~78 after 1 year, ~61 after 2 years
- Keeps recent votes relevant while letting old history fade

### Phase 5: Poll Integration **[COMPLETE]**

**Modified `src/lib/actions/pollCalculations.ts`:**

- Added `calcEffectiveFavorability()` function
- Each group result now includes `archetypeApproval` and `effectiveFavorability`
- Vote weight calculations use per-archetype effective favorability
- In-race vote share uses per-archetype approvals for all candidates

**Implementation:**

```typescript
// src/app/actions/poll/route.ts or similar

interface ArchetypeApprovalResult {
  archetypeId: string;
  name: string;
  population: number; // % of state electorate
  approval: number; // -100 to +100
  appealScore: number; // Calculated appeal based on approval + lean alignment
  estimatedVotes: number; // population × turnout × appealScore
}

function calculateArchetypeAppeals(
  character: Character,
  stateDemographics: StateDemographics,
  archetypeApprovals: Record<string, number>
): ArchetypeApprovalResult[] {
  const results: ArchetypeApprovalResult[] = [];

  for (const [archetypeId, group] of Object.entries(stateDemographics.groups)) {
    const approval = archetypeApprovals[archetypeId] ?? 0;

    // Appeal combines approval with policy alignment
    const policyAlignment = calculatePolicyAlignment(
      character.policies,
      group.economicLean,
      group.socialLean
    );

    // Approval contributes 40%, policy alignment 60%
    const appealScore = (approval / 100) * 0.4 + policyAlignment * 0.6;

    results.push({
      archetypeId,
      name: getArchetypeName(archetypeId),
      population: group.population,
      approval,
      appealScore,
      estimatedVotes: Math.round(
        group.population * (group.turnout / 100) * Math.max(0, appealScore)
      ),
    });
  }

  return results.sort((a, b) => b.approval - a.approval);
}
```

### Phase 6: 2020 Baseline Approvals

**Create pre-baked approvals based on 2020 political positions:**

```typescript
// scripts/seeds/baselineApprovals.ts

interface PartyBaselineApprovals {
  party: string;
  baseApprovals: Record<string, number>;
}

const PARTY_BASELINES_2020: PartyBaselineApprovals[] = [
  {
    party: "democrat",
    baseApprovals: {
      young_renters: 40,
      evangelicals: -50,
      rural_traditionalists: -40,
      union_trades: 20,
      soccer_moms: 10,
      college_liberals: 50,
      small_business: -20,
      public_sector: 35,
      retirees: -5,
      libertarians: -30,
      new_immigrants: 25,
      secular_professionals: 40,
    },
  },
  {
    party: "republican",
    baseApprovals: {
      young_renters: -35,
      evangelicals: 50,
      rural_traditionalists: 45,
      union_trades: -10,
      soccer_moms: -5,
      college_liberals: -50,
      small_business: 30,
      public_sector: -30,
      retirees: 15,
      libertarians: 20,
      new_immigrants: -20,
      secular_professionals: -35,
    },
  },
  {
    party: "independent",
    baseApprovals: {
      // Neutral baseline, modified by actual positions
      young_renters: 0,
      evangelicals: 0,
      rural_traditionalists: 0,
      union_trades: 0,
      soccer_moms: 5,
      college_liberals: 0,
      small_business: 5,
      public_sector: 0,
      retirees: 0,
      libertarians: 10,
      new_immigrants: 0,
      secular_professionals: 0,
    },
  },
];

// Apply baseline + position modifier
function calculateInitialApprovals(
  party: string,
  policies: PolicyPositions
): Record<string, number> {
  const baseline = PARTY_BASELINES_2020.find((p) => p.party === party)?.baseApprovals ?? {};
  const result: Record<string, number> = { ...baseline };

  // Modify based on actual positions (economic: -5 to +5, social: -5 to +5)
  // Extreme positions amplify archetype reactions

  for (const archetype of Object.keys(result)) {
    const archetypeLean = getArchetypeLean(archetype);

    // Economic alignment: positive if candidate and archetype agree
    const econAlignment = policies.economic * archetypeLean.economic;

    // Social alignment: positive if candidate and archetype agree
    const socialAlignment = policies.social * archetypeLean.social;

    // Each point of alignment adds ±2 approval
    result[archetype] += (econAlignment + socialAlignment) * 2;

    // Clamp to -100/+100
    result[archetype] = Math.max(-100, Math.min(100, result[archetype]));
  }

  return result;
}
```

## Poll Display Changes

### Current Poll System

The poll system (`src/lib/actions/pollCalculations.ts`) already shows per-group results:

| Current Field                | Description                                                 |
| ---------------------------- | ----------------------------------------------------------- |
| `appeal`                     | Policy alignment score (0-25)                               |
| `populationPct`              | Group's share of state population                           |
| `turnoutPop`                 | Estimated voters from this group                            |
| `reachedPop`                 | Voters candidate reaches (NPI-based)                        |
| `weightedPotential`          | Final vote potential (appeal × reach × approval × partyOrg) |
| `economicLean`, `socialLean` | Group's political lean                                      |

**Gap**: No per-archetype approval shown, only global favorability applied uniformly.

### Proposed Poll Updates

Add archetype approval to group results:

```typescript
// In computePollData(), add to each group result:
return {
  // ... existing fields ...

  // NEW: Per-archetype approval rating
  archetypeApproval: character.archetypeApprovals?.[group.id] ?? 0,

  // NEW: Effective favorability (base + archetype modifier)
  effectiveFavorability: Math.max(
    0,
    Math.min(100, favorability + (character.archetypeApprovals?.[group.id] ?? 0) * 0.5)
  ),
};
```

### Quick Poll (1 action)

- Show top 3 / bottom 3 archetypes by **weightedPotential** (current behavior)
- **NEW**: Add archetype approval column showing modifier (-100 to +100)

### Full Poll (2 actions)

- Show all 12 archetypes with:
  - Policy appeal (existing)
  - **NEW**: Archetype approval rating
  - **NEW**: Effective favorability (base + archetype)
  - Population share & estimated votes (existing)
  - Trend indicator (up/down from last poll)

### UI Mockup

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ VOTER GROUP BREAKDOWN                                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Group                │ Appeal │ Approval │ Eff.Fav │ Pop % │ Est. Votes     │
├──────────────────────┼────────┼──────────┼─────────┼───────┼────────────────┤
│ College Liberals     │  18.2  │   +45    │   73%   │  12%  │   48,230       │
│ Secular Professionals│  16.8  │   +38    │   69%   │   9%  │   32,100       │
│ Young Renters        │  14.5  │   +32    │   66%   │   8%  │   18,400       │
│ Union & Trades       │  12.1  │   +18    │   59%   │  10%  │   28,900       │
│ Soccer Moms          │  10.5  │    +5    │   53%   │  14%  │   42,100       │
│ New Americans        │  11.2  │   +12    │   56%   │   7%  │   14,200       │
│ Public Sector        │  13.4  │   +25    │   63%   │   8%  │   24,800       │
│ Retirees             │   6.2  │   -12    │   44%   │  15%  │   31,200       │
│ Small Business       │   4.8  │   -28    │   36%   │  10%  │   18,400       │
│ Libertarians         │   3.2  │   -35    │   33%   │   4%  │    4,200       │
│ Evangelicals         │   2.1  │   -52    │   24%   │  12%  │   12,100       │
│ Rural Traditionalists│   2.8  │   -48    │   26%   │   9%  │    9,800       │
└──────────────────────┴────────┴──────────┴─────────┴───────┴────────────────┘

Legend:
  Appeal     = Policy alignment score (0-25, based on economic/social position match)
  Approval   = Archetype-specific approval modifier (-100 to +100, from votes/actions)
  Eff.Fav    = Effective favorability (base favorability + approval×0.5, clamped 0-100)
  Est. Votes = Projected votes (appeal × reach × eff.fav × partyOrg × turnout)
```

## Election Integration **[COMPLETE]**

### Current Election Formula

The election engine (`src/lib/electionEngine.ts`) calculates votes per candidate per group:

```typescript
candidateWeight = appeal × reach × approval × partyOrg
```

| Component    | Formula                                      | Range   | Source              |
| ------------ | -------------------------------------------- | ------- | ------------------- |
| **appeal**   | Position score (quadratic) + influence score | 0-50    | `calcAppeal()`      |
| **reach**    | `normalizeNPI(politicalInfluence)`           | 0-1     | Name recognition    |
| **approval** | `favorability / 100`                         | 0-1     | Global favorability |
| **partyOrg** | `0.5 + (org/100) × 0.5`                      | 0.5-1.0 | Party organization  |

**Position Score** (core of appeal):

```typescript
positionRaw = max(0, 50 - |demoEP - charEP| × 5 - |demoSP - charSP| × 5)
positionScore = positionRaw² / 100  // 0-25, quadratic curve
```

**Implementation**: Modified `distributeVotesByGroupLevelAllocation()` in `electionEngine.ts` to use per-archetype approval:

- Added `calcEffectiveFavorability()` helper function
- Updated `EnrichedCandidate` interface with `archetypeApprovals` field
- Modified `fetchEnrichedCandidates()` to include archetype approvals for characters and NPPs
- Updated vote weight calculation to use per-archetype effective favorability

### Implementation Details

```typescript
// In the group loop (line ~231-261):
for (const ec of enriched) {
  const reach = normalizeNPI(ec.politicalInfluence);
  const appeal = calcAppeal(demoEP, demoSP, posEP, posSP, ...);

  // NEW: Per-archetype approval instead of global favorability
  const archetypeApproval = ec.archetypeApprovals?.[group.id] ?? 0;

  // Option A: Archetype modifies base favorability (additive)
  // Range: favorability (0-100) + archetypeApproval (-100 to +100) / 2 = -50 to +150, clamped to 0-100
  const effectiveFavorability = Math.max(0, Math.min(100,
    ec.favorability + archetypeApproval * 0.5
  ));
  const approval = approvalScalar(effectiveFavorability);

  // Option B: Archetype as separate multiplier (multiplicative)
  // Archetype approval -100 to +100 → multiplier 0.5 to 1.5
  const archetypeMultiplier = 1 + (archetypeApproval / 200);
  const approval = approvalScalar(ec.favorability) * archetypeMultiplier;

  const org = partyOrgScalar(partyOrgByParty.get(ec.party));
  const w = Math.max(0, appeal * reach * approval * org);
  weights[ec.candidateId] = w;
}
```

### Recommended Approach: Additive (Option A)

**Rationale:**

- Preserves existing balance (favorability remains the base)
- Archetype approval acts as a modifier (-50 to +50 effective change)
- Extreme archetype disapproval (-100) can tank a candidate with a group even if favorability is high
- Extreme archetype approval (+100) can help with a group even if favorability is moderate

**Example scenarios:**
| Favorability | Archetype Approval | Effective Favorability | Approval Scalar |
|--------------|-------------------|------------------------|-----------------|
| 50 (neutral) | 0 (neutral) | 50 | 0.50 |
| 50 (neutral) | +60 (approves) | 80 | 0.80 |
| 50 (neutral) | -60 (disapproves) | 20 | 0.20 |
| 70 (liked) | +40 (approves) | 90 | 0.90 |
| 70 (liked) | -80 (hates) | 30 | 0.30 |
| 30 (disliked) | +100 (loves) | 80 | 0.80 |

### EnrichedCandidate Schema Update

```typescript
// src/lib/electionEngine.ts
export interface EnrichedCandidate {
  // ... existing fields ...

  // NEW: Per-archetype approval ratings
  archetypeApprovals?: Record<string, number>;
}

// In fetchEnrichedCandidates():
if (c.isNPP && c.nppId) {
  const npp = nppMap.get(c.nppId.toString());
  if (npp) {
    // ... existing ...
    archetypeApprovals = npp.archetypeApprovals;
  }
} else {
  const char = charMap.get(c.characterId.toString());
  if (char) {
    // ... existing ...
    archetypeApprovals = char.archetypeApprovals;
  }
}
```

## Membership Drift (Future Phase)

Active laws can slowly shift archetype populations:

```typescript
interface MembershipDriftConfig {
  archetypeId: string;
  driftPerTurn: number; // -0.05 to +0.05 population % per turn
}

// Applied in turn processing when laws are active
async function processMembershipDrift(
  db: Db,
  stateId: string,
  activePolicies: ActivePolicy[]
): Promise<void> {
  const demographics = await getStateDemographics(db, stateId);

  const driftTotals: Record<string, number> = {};

  for (const policy of activePolicies) {
    if (!policy.archetypeMembershipDrift) continue;

    for (const [archetype, drift] of Object.entries(policy.archetypeMembershipDrift)) {
      driftTotals[archetype] = (driftTotals[archetype] ?? 0) + drift;
    }
  }

  // Apply drift, normalize to maintain 100% total
  // ...
}
```

## Testing Strategy

1. **Unit tests**: Approval calculation, decay math, vote impact recording
2. **Integration tests**: Full vote → impact → approval flow
3. **Migration tests**: Verify existing data preserved during migration
4. **E2E tests**: Poll display shows archetype data correctly

## Migration Path

1. Add new schema fields (non-breaking, all optional)
2. Run migration to initialize archetypeApprovals from party baseline
3. Update legislation types with archetypeApprovals
4. Deploy vote recording updates
5. Deploy poll display updates
6. Add decay to turn processing
7. Deprecate old groupFavorability (future cleanup)

## Design Decisions

### Resolved

1. **Approval scope**: **Home state only**
   - All legislation votes (state or federal) affect the politician's home state approvals only
   - Simpler implementation, fewer DB writes
   - Can expand to national tracking later if needed for presidential races

2. **Decay rate**: **0.5% per turn, continuous**
   - Applied every turn (not batched)
   - ~22% decay per game year

3. **Integration approach**: **Additive (Option A)**
   - `effectiveFavorability = favorability + archetypeApproval × 0.5`
   - Clamped to 0-100

## Open Questions

1. ~~**State-specific baselines**: Should different states have different baseline approvals?~~ **RESOLVED**: Start with uniform 0 baseline; state-specific can be added later as refinement.

2. **Cross-archetype effects**: Should some legislation affect archetype membership directly? (e.g., pro-union laws increase union*trades population), \_Deferred for future update*

3. **Campaign modifiers**: How should campaign actions (rallies, ads) interact with archetype approvals?, _Deferred for future update_

4. ~~**Visibility thresholds**: Should archetypes with <1% population be hidden in polls?~~ **RESOLVED**: No, all archetypes should be visible.

5. ~~**Legislation tagging**: Need to add `archetypeApprovals` to all 100+ existing legislation types~~ **DONE** - Updated helper functions in `scripts/seeds/legislationTypes.ts` to generate `archetypeApprovals` instead of the old `groupApprovals`. All 76 legislation types now automatically get archetype-based approvals.

## Implementation Status

**Completed: 2026-03-08**

All core phases implemented:

- Phase 1: Schema updates (Character, NPP, VoteImpact types)
- Phase 2: Legislation tagging (archetypeApprovals in legislationTypes.ts)
- Phase 3: Vote recording (voteImpacts.ts updated)
- Phase 4: Decay processing (archetypeApprovalDecay.ts, integrated into turnSystem.ts)
- Phase 5: Poll integration (pollCalculations.ts updated with effective favorability)
- Phase 6: 2020 baselines, _Using uniform 0 baseline; party-specific can be added later_
- Phase 7: Election integration (electionEngine.ts updated with per-archetype effective favorability)
