# Demographic System Audit & Election Realism Proposal

Historical record: this page describes the demographic and election system as audited on 2026-02-23, in the 12-archetype era. For current behaviour see [Granular electorate as shipped](./granular-electorate-as-shipped.md) and [Election engine](./election-engine.md).

**Date:** 2026-02-23  
**Goal:** Audit the demographic system and propose a new election approach that reuses existing appeal while improving realism.

> Historical design audit. The shipped granular-electorate implementation has superseded several formulas and data-shape descriptions below. Use [Granular electorate as shipped](granular-electorate-as-shipped.md) and [Election engine](election-engine.md) for current mechanics.

---

## Part 1: Current System Audit

### 1.1 Demographic Structure

| Component      | Current State                                                              | Notes                                                                                        |
| -------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Categories** | 6: race, gender, education, wealth, age, ideology                          | Each has `defaultWeight`; state overrides via `categoryWeights`                              |
| **Groups**     | 26 total across categories                                                 | Each group: `population`, `economicLean`, `socialLean`, `defaultTurnout`                     |
| **State data** | `StateDemographics.groups` = flat `Record<groupId, StateDemographicGroup>` | All groups live in one flat map; category membership is implicit via `demographicCategories` |

**Category weights (default):** Education 25%, Wealth 20%, Race 15%, Ideology 15%, Age 12.5%, Gender 12.5%.

### 1.2 Appeal Formula (unchanged)

```ts
// positionScore: 0-25
positionRaw = max(0, 50 - |econDiff|×5 - |socialDiff|×5)
positionScore = positionRaw² / 100

// influenceScore: 0-25
influenceScore = (politicalInfluence / 100) × 25

appeal = positionScore + influenceScore  // max 50
```

**Used by:** `electionEngine.ts`, poll route, NPP dropout.

### 1.3 Vote Flow (per turn)

1. **Total pool** = `calcStateTurnout()` - sum over groups of `pop × turnout × categoryWeight`
2. **Per candidate raw potential** = sum over groups of `reachedPop × (appeal/50) × categoryWeight`

   Where `reachedPop = groupPop × turnout × (politicalInfluence/100)`

3. **Final potential** = raw potential × approval × party org
4. **Distribution** = turn pool × party strength modifier, split proportionally by final potential

### 1.4 Realism Issues Identified

| Issue                            | Description                                                                                                                                                                                                                                                                                                  | Severity   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| **Double-counting voters**       | Each voter is counted in _multiple_ categories (race, gender, education, wealth, age, ideology). A voter is white + male + college + middle_income + age_30_44 + moderate. The current model sums weighted contributions across all categories as if they were independent. In reality, a person votes once. | **High**   |
| **Category-weighted sum**        | We sum `groupPop × appeal × categoryWeight` across 6 categories. The total is not a voter count - it's a weighted score. Turnout pool is also category-weighted.                                                                                                                                             | **High**   |
| **Reach is uniform**             | `politicalInfluence = reach` applies identically to all groups. A low-influence candidate can't reach urban or rural voters differently.                                                                                                                                                                     | **Medium** |
| **Single policy space**          | Only econ (left-right) and social (left-right). Real elections have many dimensions (e.g., immigration, guns, climate).                                                                                                                                                                                      | **Medium** |
| **Proportional split is global** | We split the _entire_ turn pool by _total_ potential. We don't model "Evangelicals vote 70% for A, 30% for B" within each group.                                                                                                                                                                             | **Medium** |
| **Turn weighting**               | At the time of this audit, the final 4 turns received 25% of the pool. The shipped value is now 30%.                                                                                                                                                                                                         | **Low**    |

### 1.5 What Works Well

- **Appeal formula** - Quadratic position + influence is intuitive and produces sensible gradients. Policy alignment matters; name recognition matters.
- **Approval scalar** - "Voters won't support candidates they don't approve of" is realistic.
- **Party org scalar** - Stronger state party = better mobilization.
- **Government approval** - Scales turnout pool by state performance; governor races most affected.
- **Reuse** - Same appeal used for polls, elections, NPP dropout. Keeps consistency.

---

## Part 2: Proposed Election Model (Realism-Focused)

**Principle:** Keep the existing appeal formula. Change how we _use_ it to produce votes.

### 2.1 Core Concept: Group-Level Competitive Allocation

Each demographic group has a fixed number of voters. Those voters split among candidates based on **relative appeal** within that group.

**Current (global):**

```
totalPotential_A = sum over all groups of (reachedPop × appeal_A/50)
totalPotential_B = sum over all groups of (reachedPop × appeal_B/50)
share_A = totalPotential_A / (totalPotential_A + totalPotential_B)
votes_A_this_turn = turnPool × share_A
```

**Proposed (per-group):**

```
For each group g:
  groupVoters = groupPop × turnout × reach
  appeal_A_g = calcAppeal(demoEP, demoSP, charEP, charSP, influence)
  appeal_B_g = calcAppeal(...)
  share_A_g = appeal_A_g / (appeal_A_g + appeal_B_g + ...)
  votes_A_from_g = groupVoters × share_A_g

votes_A_this_turn = sum over groups of votes_A_from_g
```

**Effect:** Each group's votes are split proportionally to appeal within that group. Evangelicals vote 80% for the conservative candidate; progressives vote 90% for the liberal. No double-counting if we use a single group dimension (see below).

### 2.2 Option A: Flatten to 12 Voter Groups (from demographic-overhaul-plan)

Use the 12 mutually exclusive archetypes. Each voter belongs to one group:

| ID                    | Name                  | Econ | Social |
| --------------------- | --------------------- | ---- | ------ |
| young_renters         | Young Renters         | -3   | -3     |
| evangelicals          | Evangelicals          | +2   | +4     |
| rural_traditionalists | Rural Traditionalists | +2   | +3     |
| union_trades          | Union & Trades        | -2   | +1     |
| soccer_moms           | Soccer Moms           | 0    | -1     |
| college_liberals      | College Liberals      | -3   | -4     |
| small_business        | Small Business        | +3   | +1     |
| public_sector         | Public Sector Workers | -2   | -2     |
| retirees              | Retirees              | +1   | +2     |
| libertarians          | Libertarians          | +4   | +2     |
| new_immigrants        | New Americans         | -1   | 0      |
| secular_professionals | Secular Professionals | -1   | -3     |

**Pros:**

- One person, one vote - no double-counting
- Group sizes derived from Layer 1 (race, age, etc.) - no new data entry
- Appeal formula unchanged
- Polls show 12 groups; players understand "I'm strong with Evangelicals, weak with Progressives"

**Cons:**

- Requires migration from 6 categories / 26 groups
- Derivation engine adds complexity

### 2.3 Option B: Single "Primary" Category (Minimal Change)

Keep current 6 categories but only use **one** for vote allocation (e.g., ideology). Ideology is the most politically salient; groups are mutually exclusive.

**Pros:**

- Minimal change - just stop summing across categories; use ideology only
- Same appeal formula
- Same data structures

**Cons:**

- Loses race, age, education, wealth effects in elections (they still affect state lean display)
- Ideology groups overlap with real demographics (e.g., evangelicals skew older, white)

### 2.4 Option C: Hybrid - Per-Group Allocation, Keep Current Structure

Keep 6 categories and 26 groups. For each group, compute:

```
groupVoters = groupPop × turnout × reach
  (but cap so sum of groupVoters across groups ≤ totalTurnout - avoid overcounting)

For each group:
  share_A = appeal_A / sum(appeal_all_candidates)
  votes_A += groupVoters × (categoryWeight/100) × share_A
```

**Issue:** We still have overlap. A voter is in multiple groups. We'd need to either:

- Use a "primary" group per voter (complex), or
- Accept that we're distributing a _weighted_ pool, not a true voter count

**Realism:** Better than current (per-group competitive split) but still not OPOV.

### 2.5 Recommended Path: Option A (12 Groups) + Group-Level Competitive Allocation

1. **Adopt 12 voter groups** from demographic-overhaul-plan - mutually exclusive, derived from Layer 1.
2. **Use group-level competitive allocation** - within each group, votes split by relative appeal.
3. **Keep appeal formula** - `calcAppeal()` unchanged.
4. **Keep approval, party org, government approval** - unchanged.
5. **Reach** - still `politicalInfluence/100`; could later add per-group reach modifiers.

**Formula:**

```
For each of 12 groups g:
  groupVoters = statePop × groupSize_pct × derivedTurnout × reach
  For each candidate c:
    appeal_c = calcAppeal(demoEP, demoSP, charEP, charSP, influence)
  totalAppeal = sum(appeal_c)
  For each candidate c:
    votes_c += groupVoters × (appeal_c / totalAppeal) × approvalScalar × partyOrgScalar
```

**Turn pool:** Same as now - `turnVoteWeight()` × party strength. We're distributing that pool per group, then summing.

Actually: we need to be careful. The turn pool is a _fixed_ number of votes per turn. We're not creating new votes. So:

**Corrected flow:**

1. Compute `totalPool` for the turn (unchanged).
2. For each group, compute `groupShare = groupVoters / totalTurnout` (what fraction of the electorate is this group).
3. For each group, compute each candidate's share of that group: `share_c = appeal_c / sum(appeal_all)`.
4. Candidate c's votes from group g: `totalPool × groupShare × share_c × approval × partyOrg`.
5. Sum over groups for each candidate.

This preserves the fixed turn pool. Each group contributes a fraction of the pool proportional to its size; within that fraction, candidates split by relative appeal.

---

## Part 3: Implementation Summary

### Phase 1: Group-Level Competitive Allocation (No Structural Change)

**Change:** In `calcCandidateVotePotential` and election accumulation, switch from "sum raw potential, then split pool proportionally" to "for each group, compute share of group by relative appeal; sum votes per candidate from all groups."

**Files:** `electionEngine.ts`, poll route.

**Effect:** Same 6 categories, 26 groups. But within each group, votes split by relative appeal. Reduces the "global proportional" feel; each demographic group now behaves like a bloc.

### Phase 2: Flatten to 12 Groups (Optional, Larger Change)

**Change:** Replace 6 categories with 1 category of 12 voter groups. Derive group sizes from existing state config. Update seeds, poll UI, admin.

**Files:** `demographicCategories.ts`, `stateDemographics.ts`, poll route, `DemographicsManager`, types.

**Effect:** One person, one vote. No double-counting. Cleaner mental model.

---

## Part 4: Summary

| Aspect              | Current                                      | Proposed (Phase 1)                             | Proposed (Phase 2)           |
| ------------------- | -------------------------------------------- | ---------------------------------------------- | ---------------------------- |
| **Vote allocation** | Global proportional split by total potential | Per-group competitive split by relative appeal | Same                         |
| **Voter model**     | Sum across categories (double-counted)       | Same structure, but per-group split            | 12 mutually exclusive groups |
| **Appeal**          | Unchanged                                    | Unchanged                                      | Unchanged                    |
| **Realism**         | Medium - voters over-counted                 | Higher - groups vote as blocs                  | Highest - OPOV               |

**Recommendation:** Implement Phase 1 first. It is a contained change that improves realism (groups vote as blocs) without migration. Phase 2 can follow if the 12-group model is desired.
