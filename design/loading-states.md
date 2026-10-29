# Loading State Standardization Plan

Historical record: this page describes work as of May 2026 (plan) and 2026-08-11 (completed). No separate mechanic doc covers loading behaviour; this is a completed plan verified against code on 2026-08-11, and the current state is the `loading.tsx` skeleton files under `src/app/`.

**Author:** Hermes Agent  
**Date:** 2026-05-27  
**Status:** Completed - verified against code 2026-08-11  
**Repo:** a-house-divided (AHDGame)

---

## 1. Executive Summary

**As of 2026-08-11, this plan has been fully implemented.** The app now has 29 `loading.tsx` files, all using layout-matching skeleton components. The five spinner-only routes, the raw-div legislature loading state, and the inline text-based loading states described below have all been converted to skeletons. This document is kept as a historical record of the original audit and the design principles that guided the fix; the sections below describe the state of the code as it was in May 2026, before the rewrite.

**Goal (achieved):** Every data-dependent route shows a layout-matching skeleton during loading. No spinner-only pages. No layout shifts between loading and loaded states.

---

## 2. Audit Findings (as of May 2026, before this plan was implemented)

| Route / Component                                            | Loading Type                                     | Quality    | Issue                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------ | ---------- | ----------------------------------------------------------------------- |
| `src/app/loading.tsx`                                        | Skeleton (navbar + hero + cards)                 | Good       | Layout-matching, complex                                                |
| `src/app/profile/loading.tsx`                                | Skeleton (header card + meters + chips)          | Good       | Layout-matching                                                         |
| `src/app/state/[id]/loading.tsx`                             | Skeleton (hero + tabs + cards)                   | Good       | Layout-matching                                                         |
| `src/app/country/[code]/region/[id]/loading.tsx`             | Skeleton (hero + tabs + cards)                   | Good       | Layout-matching                                                         |
| `src/app/dashboard/loading.tsx`                              | Skeleton (hero strip + 2-col + poll)             | Good       | Layout-matching                                                         |
| `src/app/elections/[id]/loading.tsx`                         | **Spinner** (`LoadingSpinner`)                   | Poor       | Centered spinner, no layout match                                       |
| `src/app/congress/loading.tsx`                               | **Spinner** (`LoadingSpinner`)                   | Dead code  | `congress/page.tsx` is a redirect to legislature                        |
| `src/app/congress/bills/[id]/loading.tsx`                    | **Spinner** (`LoadingSpinner`)                   | Poor       | Shows briefly before client component takes over                        |
| `src/app/congress/nominations/[id]/loading.tsx`              | **Spinner** (`LoadingSpinner`)                   | Poor       | Shows briefly before client component takes over                        |
| `src/app/admin/loading.tsx`                                  | **Spinner** (`LoadingSpinner`)                   | Poor       | Double-loading with inline `<Suspense>` spinner inside `admin/page.tsx` |
| `src/app/country/[code]/region/[id]/legislature/loading.tsx` | **Raw divs** (`animate-pulse` on plain divs)     | Poor       | Doesn't use `Skeleton` component, no structural matching                |
| `src/app/elections/[id]/page.tsx` (inline)                   | **Loading text** (`"Loading election…"`)         | Poor       | Client-side `loading` state bypasses `loading.tsx`                      |
| `src/app/congress/bills/[id]/page.tsx` (inline)              | **Loading text** (`"Loading…"`)                  | Poor       | Client-side `loading` state bypasses `loading.tsx`                      |
| `src/app/congress/nominations/[id]/page.tsx` (inline)        | Presumed loading text                            | Poor       | Client-side `loading` state                                             |
| `src/app/admin/page.tsx` (inline `<Suspense>`)               | **Spinner** (inline `<div>` with `animate-spin`) | Poor       | Double-loading with `loading.tsx` spinner                               |
| `src/app/country/[code]/legislature/LegislatureClient.tsx`   | **Loading text** (Suspense fallback)             | Poor       | `"Loading Congress…"` text                                              |
| `src/app/page.tsx` (landing)                                 | Static content                                   | N/A        | No data fetch needed                                                    |
| 119 other pages                                              | No loading state                                 | Acceptable | Static content or handled by parent layout                              |

### 2.1a Current State (verified 2026-08-11)

Every route and inline state flagged below has been converted. Confirmed in the game repo:

- `src/app/elections/[id]/loading.tsx` renders `ElectionDetailSkeleton` from `./components/ElectionDetailSkeleton`.
- `src/app/congress/loading.tsx` renders the shared `LegislatureSkeleton` from `@/app/country/[code]/legislature/LegislatureSkeleton` (kept intentionally, not removed as dead code - the redirect can still flash it).
- `src/app/congress/bills/[id]/loading.tsx` renders `BillDetailSkeleton` from `./components/BillDetailSkeleton`.
- `src/app/congress/nominations/[id]/loading.tsx` renders `NominationDetailSkeleton` from `./components/NominationDetailSkeleton`.
- `src/app/admin/loading.tsx` renders `AdminTabsSkeleton` from `./components/AdminTabsSkeleton`, no spinner.
- `src/app/country/[code]/region/[id]/legislature/loading.tsx` renders the shared `LegislatureSkeleton`, no raw `animate-pulse` divs.
- `src/app/elections/[id]/page.tsx` uses `if (loading) return <ElectionDetailSkeleton />;` - no more `"Loading election…"` text.
- `src/app/congress/bills/[id]/page.tsx` line 121: `if (loading) return <BillDetailSkeleton />;` - no more `"Loading…"` text.
- `src/app/congress/nominations/[id]/page.tsx` line 89-91: `if (loading) { return <NominationDetailSkeleton />; }` - no more presumed loading text.
- `src/app/admin/page.tsx` uses `<Suspense fallback={<AdminTabsSkeleton />}>` - no inline `animate-spin` div.
- `src/app/country/[code]/legislature/LegislatureClient.tsx` defines `LegislatureFallback` as `<LegislatureSkeleton />`, not `"Loading Congress…"` text.

The shared primitives file exists at `src/components/ui/loading-skeletons.tsx`. `LoadingSpinner` (`src/components/ui/LoadingSpinner.tsx`) is no longer used by any page-level loading path; it remains in use only for small inline indicators: `src/app/country/[code]/political-metrics/components/CompareView.tsx`, `src/components/corporation/ProductStudio.tsx` and `src/components/corporation/IndustrialRelationsSection.tsx`, consistent with the original plan's intent to keep it for small inline regions.

The repo now has 29 `loading.tsx` files (not 11) and 223 `page.tsx` files (not 140).

### 2.2 Spinner-Only Routes (historical - fixed, see 2.1a)

Five `loading.tsx` files render only a `<LoadingSpinner>`:

1. `elections/[id]/loading.tsx` - Election detail view
2. `congress/loading.tsx` - **Dead code** (page is a redirect)
3. `congress/bills/[id]/loading.tsx` - Bill detail view
4. `congress/nominations/[id]/loading.tsx` - Nomination detail view
5. `admin/loading.tsx` - Admin panel

### 2.3 Inline Loading States (historical - fixed, see 2.1a)

These client components manage their own loading state and return plain text/spinner:

1. `elections/[id]/page.tsx:164-166` - `"Loading election…"` text
2. `congress/bills/[id]/page.tsx:116-118` - `"Loading…"` text
3. `congress/nominations/[id]/page.tsx` - Presumed loading text
4. `admin/page.tsx:33-38` - Inline spinner inside `<Suspense fallback>`
5. `country/[code]/legislature/LegislatureClient.tsx:8-10` - `"Loading Congress…"` text

**Problem:** In Next.js App Router, `loading.tsx` wraps the page in a Suspense boundary. Server components render `loading.tsx` while the page resolves. But client components bypass this - they render as a shell immediately, then show their own inline loading state. The user sees: **spinner (loading.tsx) → loading text (inline) → content**. This is a double-loading flash.

**Fix strategy:** Replace inline loading states with the same skeleton components used in `loading.tsx`, so the transition is seamless. For client components that always render through their inline path, the `loading.tsx` becomes a brief pre-hydration shell - keep it skeleton-based to avoid spinner→skeleton→content flash.

### 2.4 Pages Without Any Loading State (historical counts)

At the time of the original audit, 119 of 140 pages lacked a `loading.tsx`. The repo has since grown to 223 `page.tsx` files against 29 `loading.tsx` files, so most pages still inherit the root `src/app/loading.tsx` rather than having a route-specific one. Most are static inform pages (guides, legal, about) or simple routes that inherit the root `loading.tsx`. This is acceptable. Priority pages that were considered for future phases if they became data-heavy:

- `country/[code]/page.tsx` - country overview (currently covered by region loading)
- `elections/page.tsx` - election listing
- `parties/page.tsx` - party listing
- `wiki/[slug]/page.tsx` - wiki article view
- `world/page.tsx` - world overview

---

## 3. Design Principles

1. **Skeleton-first.** Loading states use the shared `Skeleton` component (from `src/components/ui/Skeleton.tsx`), never raw `<div>` with `animate-pulse`.
2. **Layout-matching.** The skeleton's DOM structure mirrors the loaded page - same grid columns, same card shapes, same spacing. No centered spinner.
3. **Composability over abstraction.** Build small, reusable skeleton primitives (`CardSkeleton`, `StatGridSkeleton`, `ListRowSkeleton`, `TabRowSkeleton`) rather than full-page skeleton components.
4. **No double-loading.** A route must never show two different loading states in sequence.
5. **Mobile-safe.** All skeletons use responsive Tailwind classes. No fixed widths that break on mobile.
6. **Document exceptions.** If a route deliberately uses a spinner (e.g., a tiny button), document why.

---

## 4. Implementation Plan

### Phase 1: Shared Skeleton Primitives

**File:** `src/components/ui/loading-skeletons.tsx`

Built as planned, with one extra primitive (`PageHeaderSkeleton`) added during implementation that is not covered by this table. Composable skeleton primitives encode the app's design tokens (card-border, rounded-xl, shadow-card, etc.):

| Component          | Purpose                                            | Props                            |
| ------------------ | -------------------------------------------------- | -------------------------------- |
| `CardSkeleton`     | Wraps children in a card-shaped skeleton container | `className?`, `children`         |
| `StatGridSkeleton` | Grid of stat chips (label + value + delta)         | `cols?: number`, `count?: number` |
| `ListRowSkeleton`  | Single row with icon + text lines                  | `lines?: number`, `withBadge?`   |
| `TabRowSkeleton`   | Horizontal tab bar                                 | `count?: number`                 |

These are thin wrappers. They encode the app's spacing and border conventions so route-level loading files stay focused on structure.

### Phase 2: Route Loading Skeleton Rewrites (completed)

Each rewrote a spinner or raw-div loading state into a layout-matching skeleton. In practice most routes did not compose the Phase 1 primitives directly - instead each got its own dedicated skeleton component (`ElectionDetailSkeleton`, `BillDetailSkeleton`, `NominationDetailSkeleton`, `AdminTabsSkeleton`, `LegislatureSkeleton`, `RegionPageSkeleton`), colocated next to the route it matches, e.g. `src/app/elections/[id]/components/ElectionDetailSkeleton.tsx` and `src/app/congress/bills/[id]/components/BillDetailSkeleton.tsx`.

#### 2.1 `admin/loading.tsx` → Skeleton

Match the admin page structure:

- Header bar (hidden on lg+) with accent line, title, subtitle
- Card with tab row + content area

```tsx
// Structure to match:
// <ClockDriftBanner /> (skip - ephemeral)
// <Header bar> (lg:hidden)
// <AdminTabs> (tab bar + tab content)
```

#### 2.2 `elections/[id]/loading.tsx` → Skeleton

Match the election detail structure:

- Back navigation
- Header card (title + phase badge + action buttons)
- Timeline strip
- Content area (card with candidate lists or upcoming view)

#### 2.3 `congress/bills/[id]/loading.tsx` → Skeleton

Match the bill detail structure:

- Back navigation link
- Header card (status badge + chamber badge + title + summary + sponsor + provisions + action buttons)
- Two-column grid: vote bars (left) + prediction panel (right)
- Tally/Votes tab bar + table area

#### 2.4 `congress/nominations/[id]/loading.tsx` → Skeleton

Match the nomination detail structure:

- Back navigation link
- Header card (position name + nominee name + status + dates + action buttons)
- Vote bar
- Vote breakdown table

#### 2.5 `congress/loading.tsx` → Reused shared skeleton

The `congress/page.tsx` is a server-side redirect to `country/[code]/legislature`. Rather than a minimal generic skeleton, the final implementation reuses the destination's own `LegislatureSkeleton` (from `@/app/country/[code]/legislature/LegislatureSkeleton`), so any flash during the redirect already matches the page the user lands on. It was not removed as dead code.

#### 2.6 `country/[code]/region/[id]/legislature/loading.tsx` → Skeleton

Replace raw `<div className="animate-pulse">` blocks with proper `Skeleton` components from `@/components/ui`. Structure:

- Legislature header card (similar to state/region hero headers)
- Tab row
- Two-column content grid

### Phase 3: Inline Loading State Fixes (completed)

Inline `"Loading…"` text and spinners in client components were replaced with skeleton components that match the loaded layout, eliminating the double-loading flash.

#### 3.1 `elections/[id]/page.tsx` (line 164-166)

Replace:

```tsx
if (loading)
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-muted">Loading election…</div>
    </div>
  );
```

With a skeleton matching the election detail layout (same structure as `elections/[id]/loading.tsx`).

#### 3.2 `congress/bills/[id]/page.tsx` (line 116-118)

Replace:

```tsx
if (loading)
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-muted text-sm">Loading…</div>
    </div>
  );
```

With a skeleton matching the bill detail layout.

#### 3.3 `congress/nominations/[id]/page.tsx`

Same pattern - find the loading state and replace with skeleton.

#### 3.4 `admin/page.tsx` (line 33-38)

Replace:

```tsx
<Suspense
  fallback={
    <div className="flex items-center justify-center py-12">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  }
>
  <AdminTabs />
</Suspense>
```

With a skeleton matching the AdminTabs layout. Also update `admin/loading.tsx` to match.

> **Coordination note:** The `<Suspense>` inside `admin/page.tsx` triggers after the initial server render, so there's a sequence: `loading.tsx` skeleton → page shell renders → `<Suspense>` triggers → spinner shows. The goal is to make all three states visually continuous so the transition is imperceptible. Use the same skeleton shape for both the `loading.tsx` and the `<Suspense>` fallback.

#### 3.5 `country/[code]/legislature/LegislatureClient.tsx` (line 8-10)

Replace:

```tsx
const LegislatureFallback = ({ name }: { name: string }) => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <p className="text-muted">Loading {name}…</p>
  </div>
);
```

With a skeleton that matches the legislature page layout.

### Phase 4: Cleanup & Validation

1. **TypeCheck:** Run `npm run typecheck` (or `tsc --noEmit`). All skeleton components must pass.
2. **Lint:** Run ESLint. No warnings on new files.
3. **Visual check:** Manually verify 3 skeleton routes against their loaded counterparts (admin, elections, bills).
4. **Mobile:** Verify all skeletons collapse correctly at mobile breakpoints.
5. **Dead code:** `congress/loading.tsx` was kept, not removed - it now reuses the shared `LegislatureSkeleton` (see 2.5), so it is not dead code even though `congress/page.tsx` redirects.
6. **Update changelog:** Log under current version.

---

## 5. Affected Files

### New Files

- `src/components/ui/loading-skeletons.tsx` - Shared skeleton primitives

### Modified Files (loading.tsx rewrites)

- `src/app/admin/loading.tsx`
- `src/app/elections/[id]/loading.tsx`
- `src/app/congress/bills/[id]/loading.tsx`
- `src/app/congress/nominations/[id]/loading.tsx`
- `src/app/congress/loading.tsx` (kept, reuses shared `LegislatureSkeleton`)
- `src/app/country/[code]/region/[id]/legislature/loading.tsx`

### Modified Files (inline loading fixes)

- `src/app/elections/[id]/page.tsx`
- `src/app/congress/bills/[id]/page.tsx`
- `src/app/congress/nominations/[id]/page.tsx`
- `src/app/admin/page.tsx`
- `src/app/country/[code]/legislature/LegislatureClient.tsx`

### Excluded (already adequate)

- `src/app/loading.tsx` ✓
- `src/app/profile/loading.tsx` ✓
- `src/app/state/[id]/loading.tsx` ✓
- `src/app/country/[code]/region/[id]/loading.tsx` ✓
- `src/app/dashboard/loading.tsx` ✓
- `src/components/ui/Skeleton.tsx` ✓
- `src/components/ui/LoadingSpinner.tsx` ✓ (keep for inline button/row usage)

---

## 6. Risks & Mitigations

| Risk                                                  | Mitigation                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Skeleton doesn't perfectly match dynamic content      | Accept 80% match; document known gaps. Dynamic data (election phase, bill status) varies - skeleton shows generic shape. |
| Increased bundle size from skeleton components        | Primitives are <15 lines each. Overall impact negligible (<1 KB gzipped).                                                |
| Mobile layout mismatch                                | Test at 375px and 768px widths. Use responsive Tailwind classes in skeletons.                                            |
| `congress/loading.tsx` removal breaks routing         | Resolved by not deleting it - it now reuses the shared `LegislatureSkeleton` instead.                                    |
| `LoadingSpinner` still used elsewhere (buttons, etc.) | Keep `LoadingSpinner` - it's the correct choice for small inline regions. Only replace page-level spinners.              |

---

## 7. Testing Checklist (verified against code 2026-08-11)

- [x] `admin/loading.tsx` renders skeleton, not spinner
- [x] `elections/[id]/loading.tsx` renders skeleton matching election detail
- [x] `congress/bills/[id]/loading.tsx` renders skeleton matching bill detail
- [x] `congress/nominations/[id]/loading.tsx` renders skeleton matching nomination detail
- [x] `country/[code]/region/[id]/legislature/loading.tsx` uses the shared `LegislatureSkeleton` component, not raw `animate-pulse` divs
- [x] Inline loading in `elections/[id]/page.tsx` uses skeleton, not text
- [x] Inline loading in `congress/bills/[id]/page.tsx` uses skeleton, not text
- [x] Inline loading in `congress/nominations/[id]/page.tsx` uses skeleton, not text
- [x] Admin `<Suspense>` fallback uses `AdminTabsSkeleton`
- [x] `LegislatureClient` Suspense fallback uses skeleton
- [x] No double-loading flash: spinner→text→content sequences are eliminated
- [ ] TypeCheck passes (`npm run typecheck` or equivalent) - not re-verified in this pass
- [ ] Lint passes - not re-verified in this pass
- [ ] Mobile breakpoints render correctly (375px, 768px) - not re-verified in this pass
- [ ] Theme switching doesn't break skeleton colors - not re-verified in this pass

---

## 8. Acceptance Criteria

1. All page-level loading states use skeleton components that match the loaded layout, unless an exception is explicitly documented in this plan.
2. No route shows only a centered spinner during loading.
3. Layout shift between loading and loaded states is visually reduced.
4. Mobile views display skeletons correctly at all breakpoints.
5. This plan document is detailed enough for another agent to continue the work later.

Last checked: 2026-10-29, version 1.18.0
