# Demographic & Election Implementation Audit

Historical record: this page describes the archetype-era implementation as audited in February 2025. For current behaviour see [Granular electorate as shipped](./granular-electorate-as-shipped.md) and [Election engine](./election-engine.md).

**Date:** 2025-02-23  
**Scope:** 12 archetype system, group-level competitive allocation, poll, elections, admin

> Historical implementation audit. The live vote path now uses the granular Layer-1 electorate and swing-flow general-election engine. Use [Granular electorate as shipped](granular-electorate-as-shipped.md) and [Election engine](election-engine.md) for current behavior. The checks below describe the retired archetype-era implementation and should not be used as current operational guidance.

---

## ✅ What's Working

### Election Engine

- **`accumulateVoteTurn`** correctly calls `distributeVotesByGroupLevelAllocation` for group-level competitive allocation
- **`distributeVotesByGroupLevelAllocation`** iterates categories → groups, uses `demographics.categoryWeights[category._id]` and `demographics.groups[group.id]`
- **`calcStateTurnout`**, **`calcCandidateVotePotential`** use same category/group structure
- **Primary resolution** (`primaryResolution.ts`) calls `accumulateVoteTurn` per turn
- All election logic reads `demographicCategories` and `stateDemographics` from DB - compatible with 12 archetypes

### Poll

- **computePollData** uses categories from DB, looks up `demographics.groups[group.id]`
- **In-race share** computed via group-level competitive allocation (matches election engine)
- **Stale poll invalidation** clears stored polls when schema mismatch (old 6 vs new 12)
- **Terminology** updated to "voter group" (no demographic framing)

### NPP Election Behavior

- **NPP dropout** uses `demographicCategories` and `stateDemographics` - iterates categories/groups, uses `categoryWeights`, `groups[group.id]`
- Compatible with 12 archetypes

### State Page Demographics Tab

- **StatePageTabsDemographics** iterates `categories` from API, maps `demographics.groups[g.id]` - works with any category structure
- Shows group name, population %, economic/social lean

### Admin Demographics Manager

- Fetches categories from DB, initializes defaults for single category (voterGroups: 100)
- **Reseed button** calls `/api/admin/demographics/reseed` - upserts categories and state demographics from seed

### Debug & Utils

- **`/api/debug/demographics`** uses `calculateStateLean` with categories - works with voterGroups
- **`calculateStateLean`**, **`validateCategoryWeights`** support flexible `CategoryWeights` (voterGroups: 100)
- **demographics.test.ts** has voterGroups test case

---

## ⚠️ Issues & Gaps

### 1. ~~**CRITICAL: demographicDefaults not updated by reseed/seed-demographics**~~ ✅ FIXED

**Problem:** Game reset copies from `demographicDefaults` → `stateDemographics`. The reseed API and `seed-demographics` script only updated `stateDemographics` and `demographicCategories`. They did **not** update `demographicDefaults`.

**Fix applied:** Reseed API and `seed-demographics.ts` now also upsert `demographicDefaults` with the same state demographics.

### 2. **Actions page still says "Full Demographic Poll"**

**Location:** `src/app/actions/page.tsx` lines 114-122

**Current:** `label: "Full Demographic Poll"`, `flavor: "A comprehensive breakdown across every demographic category..."`, `effect: "Full demographic breakdown"`

**Fix:** Align with poll page: "Full Poll", "voter group" terminology.

### 3. **Dashboard "demographic group" copy**

**Location:** `src/app/dashboard/page.tsx` line 685

**Current:** `"Commission a poll to see your support breakdown by demographic group."`

**Fix:** Change to "voter group".

### 4. **Poll API success message**

**Location:** `src/app/api/actions/poll/route.ts` line 538

**Current:** `"Commissioned a full demographic poll for $..."`

**Fix:** "Commissioned a full poll for $..."

### 5. **pollHelpers.ts - legacy CATEGORY_ICONS**

**Location:** `src/app/actions/poll/pollHelpers.ts` lines 58-60

**Current:** `race: "👥", gender: "⚧", education: "🎓", wealth: "💰", age: "📅", ideology: "🧭", voterGroups: "🗳️"`

**Impact:** Low. Old keys are unused with 12-archetype schema. `voterGroups` is used. No functional bug, but dead code.

**Optional:** Remove old keys or leave for backward compatibility if old polls exist.

### 6. **DemographicCategoryId type includes legacy IDs**

**Location:** `src/lib/db/types/demographics.ts`

**Current:** `"race" | "gender" | "education" | "wealth" | "age" | "ideology" | "voterGroups"`

**Impact:** None. Type allows both; schema mismatch detection in poll uses string arrays. Fine to keep for migration/backward compatibility.

### 7. **StatePageTabsDemographics - "demographic" wording**

**Location:** `src/components/state/StatePageTabsDemographics.tsx` lines 40-42

**Current:** "No demographic data available", "Demographic information has not been configured"

**Impact:** Low. Could change to "voter group" for consistency, but "demographic" is still technically correct (demographics = population characteristics).

---

## 🔗 Election ↔ Poll Integration

| Flow                                                                                                         | Status |
| ------------------------------------------------------------------------------------------------------------ | ------ |
| Poll `computePollData` uses same categories/demographics as election engine                                  | ✅     |
| Poll in-race share uses group-level competitive allocation (matches `distributeVotesByGroupLevelAllocation`) | ✅     |
| Election `accumulateVoteTurn` uses `distributeVotesByGroupLevelAllocation`                                   | ✅     |
| Both use `calcAppeal`, `approvalScalar`, `partyOrgScalar` from demographicAppeal                             | ✅     |
| `ElectionComparisonPanel` uses `inRaceVoteShare` when available                                              | ✅     |

**Verdict:** Poll and elections are correctly integrated.

---

## 📋 Recommended Fixes (Priority)

1. **High:** Update reseed API and `seed-demographics` to also upsert `demographicDefaults`
2. **Medium:** Actions page - "Full Poll", voter group wording
3. **Low:** Dashboard, poll API message, StatePageTabsDemographics - terminology tweaks
4. **Optional:** Clean up CATEGORY_ICONS legacy keys

---

## Partisan Lean Display

**Yes - already uses the new system.** `calculateStateLean(demographics, categories)` is category-agnostic: it iterates over whatever categories exist in the DB. With 12 archetypes (voterGroups + 12 groups), it computes economic/social lean from those groups. Used by:

- State page (`/state/[id]`) - fresh calculation when demographics exist
- Map overview API - same
- Admin demographics PATCH - caches result to state document

---

## Migration Checklist (for existing DBs)

- [ ] Run **Reseed Demographics** (Admin → Demographics) or `npm run seed:demographics`
- [ ] **Important:** Also run full seed with `--reset` once, OR add demographicDefaults update to reseed, so game reset doesn't revert to old demographics
- [ ] Commission new polls (stale ones are auto-invalidated on schema mismatch)
- [ ] Verify state Demographics tab shows 12 groups (Young Renters, Evangelicals, etc.)
