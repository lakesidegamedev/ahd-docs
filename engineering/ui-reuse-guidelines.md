# UI reuse and consistency

This document captures **repeatable layout patterns** in the Next.js App Router frontend, **when to extract shared components**, and **what we intentionally leave local**. It complements `.claude/skills/ahd-design-system/SKILL.md` (tokens and visual rules).

## Investigation summary (2026-03)

The codebase uses a small set of **dashboard-style surfaces**: hero image + horizontal stats row, bordered cards with uppercase micro-labels, and admin widgets with grid + dividers. Duplication is highest in the **hero stats strip** wrapper (same flex + divide + border classes across many routes). Secondary duplication appears in **stat cell markup** (label + value columns), but those vary enough in padding and content that a single abstraction would fight the routes.

## Findings (with references)

### Repeated structures

| Pattern                                     | Where it appears                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Notes                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Hero + stats strip                          | `src/app/actions/components/ActionsHero.tsx`, `src/app/country/[code]/legislature/components/shared/LegislatureHeader.tsx`, `src/app/elections/page.tsx`, `src/app/country/[code]/CountryOverviewClient.tsx`, `src/app/state/[id]/page.tsx`, `src/app/congress/CongressClient.tsx`, `src/app/whitehouse/WhiteHouseClient.tsx`, `src/app/centralbank/[currency]/CentralBankClient.tsx`, `src/app/stockmarket/[country]/page.tsx`, `src/app/commodity/[type]/page.tsx`, `src/app/changelog/ChangelogClient.tsx`, `src/app/country/[code]/parties/components/PartiesHeader.tsx`, UK executive clients, etc. | Same outer flex/divide/border classes; inner cells differ.                                                                |
| Political meters (influence / favorability) | `src/app/profile/components/PoliticalStanding.tsx` (`StatMeter`, `HeatMeter` from `ProfileMeters.tsx`), `src/app/actions/components/ActionsHero.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Actions hero uses slimmer inline bars aligned with the design-system progress pattern; profile uses segmented `BarMeter`. |
| Admin task widget row                       | `src/components/admin/tasks/TasksWidget.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `grid` + `divide-x`, different layout goal than hero strip; do not force into `HeroStatsStrip`.                          |

### Inconsistencies worth knowing

- **Stats strip chrome:** Some routes use `divide-card-border`, others `divide-card-border/50` with `bg-card/50 backdrop-blur-sm` (Campaign Operations). `HeroStatsStrip` encodes this as `variant="default" | "overlay"`.
- **Hero image height:** Design standard is `h-[175px] w-full sm:h-[220px]` (see design-system skill). Most heroes match; always check when adding a new page header.

## When to generalize vs keep local

**Extract a shared primitive when:**

- The same **class string** (or trivial variation) appears in **three or more** places **and** wrapping `children` is enough, no prop explosion.
- The wrapper is **layout-only** (no domain branching). Example: `HeroStatsStrip`.

**Keep markup local when:**

- Cells differ in **min-width**, **links**, **tooltips**, **loading states**, or **country-specific** copy, a “universal stat cell” tends to accumulate optional props and become harder to read than three copies.
- The surface is **admin-only** or **one-off** (e.g. a grid dashboard) and a new abstraction would not reduce line count meaningfully.

**Prefer composition over configuration:** A thin wrapper + JSX children beats a component with twelve optional props.

## Shared primitives

### `HeroStatsStrip`

- **File:** `src/components/ui/HeroStatsStrip.tsx`
- **Export:** `@/components/ui` (`HeroStatsStrip`, `HeroStatsStripProps`, `HeroStatsStripVariant`)
- **Use for:** The horizontal row directly under a hero image with vertical dividers between cells.
- **Variants:** `default` (solid borders); `overlay` (muted strip, Campaign Operations hero).

Adopted in:

- `src/app/actions/components/ActionsHero.tsx` (`variant="overlay"`)
- `src/app/country/[code]/legislature/components/shared/LegislatureHeader.tsx`
- `src/app/elections/page.tsx`

**Deferred:** Migrating every remaining hero page to `HeroStatsStrip` is a mechanical follow-up; touch files only when those areas change for other reasons, or in a dedicated cleanup PR.

### Leader / person cells

- **Pattern:** `LeaderStatItem`-style cells (see design-system skill) live in `CountryOverviewClient.tsx` as reference. Reuse that pattern when a strip shows a **linked character** or “Vacant”, not a raw number.

### Profile meters

- **`StatMeter` / `HeatMeter` / `BarMeter`:** `src/app/profile/components/ProfileMeters.tsx`, best for **standalone panels** with tooltips. Hero strips may use **simpler** `h-2` bars to save vertical space (as on Actions).

## Admin and dashboard surfaces

- **Tasks / metrics widgets** often use **CSS grid** + `divide-x` or `divide-y` (`TasksWidget`, state metric drilldowns). Treat these separately from hero strips; grid column counts are page-specific.
- **Do not** route admin-only layout through player-facing `HeroStatsStrip` unless the visual goal truly matches (horizontal scroll row under a header).

## Validation checklist for UI changes

1. Token classes only, no raw Tailwind palette colors (see design-system skill).
2. Hero image dimensions unchanged unless the task explicitly allows it.
3. New shared component: **used in at least two call sites** or justified as the single supported API for new work.
4. Run `npm run verify` before merge.

## Remaining risks / deferred issues

- **Broad migration** of all hero pages to `HeroStatsStrip`, low risk but high diff noise; deferred.
- **Unifying** `ActionsHero` meters with `StatMeter`, would add imports and segmented bar styling inconsistent with the compact hero; deferred unless product asks for parity.
- **PartiesHeader** and similar strips use the same idea but sometimes omit `overflow-x-auto`; align when editing those files.
