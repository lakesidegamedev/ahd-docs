# Naming and Organization

> Guidelines for maintainability and discoverability in A House Divided.
> Last updated: 2026-03-23

> **Accuracy note, 2026-08-21:** Section 2 records the files and directories
> that existed during the original audit. Some of those internal docs and skill
> trees are not present in the current public AHDGame checkout. Sections 3 to 5
> describe the current naming conventions.

---

## 1. Summary

This document captures naming conventions, explains confusing directory pairs, and guides where to put new code. It complements [`repo-operating-map.md`](./repo-operating-map.md) and [`architecture-boundaries.md`](./architecture-boundaries.md).

**Audit focus:** File names, module names, folder structure, and domain clarity, not behavioral changes.

---

## 2. Key Findings from Audit

### 2.1 Documented (No Rename, Value vs Churn)

| Issue                                           | Resolution                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **`electionEngine/` vs `elections/`**           | Both stay. Distinction documented below in §3.1. Renaming would require 20+ import updates with minimal clarity gain.                      |
| **`corporation/` vs `corporations/`**           | Intentional: `/corporations` = list page, `/corporation/[id]` = detail page. Common REST-style pattern.                                    |
| **`constants.ts` vs `constants/`**              | Intentional: `constants.ts` re-exports US visual assets + barrel; `constants/` holds modular config. See header in `src/lib/constants.ts`. |
| **`shared/constants/` vs `src/lib/constants/`** | Different purposes: `shared/` = scripts + app; `src/lib/constants/` = app-only. See `architecture-boundaries.md` §1.                       |

### 2.2 Corrected in This Audit

| Location                                    | Change                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `claude.md`                                 | Updated `election/` → `electionEngine/` + `elections/` in project structure and vote-distribution path                |
| `docs/engineering/prompts/fix-bug.md`       | Fixed `election/voteDistribution.ts` → `electionEngine/voteDistribution.ts`                                           |
| `docs/design/demographics.md`               | Fixed stale `elections/electionEngine.ts` → `seeds/stateDemographics.ts` for `computeLiveGroupTurnouts`               |
| `docs/archive/wiki-content/demographics.md` | Same fix as above                                                                                                     |
| `docs/engineering/repo-operating-map.md`    | Marked P1 item 3 (stale root debug files) as resolved, the files were removed; no `scripts/archive/` directory exists |

### 2.3 Deferred (Low Confidence or High Churn)

| Item                              | Reason                                                                                                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dual `candidateEnrichment.ts`** | One in `electionEngine/` (DB-fetch for vote calc), one in `elections/` (in-memory for API). Different roles; clarifying comment in each file is preferable to rename.                                                                   |
| **Seed script naming**            | `seedBudgets.ts` (camelCase, lives in `src/lib/admin/seed/`) vs `seed-*.ts` (kebab-case in `scripts/`). Low impact.                                                                                                        |
| **`src/lib/data/`**               | 8 files of historical election-results reference data (`1952ElectionResults.ts` through `2024ElectionResults.ts`, plus `historicalPresidentialMargins.ts`). Could move to `constants/` but is reference data, not tunables. Low impact. |

---

## 3. Naming Patterns (Going Forward)

### 3.1 Election Logic, Two Directories

| Path                      | Purpose                                                                                       | When to Use                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/lib/electionEngine/` | Vote-calculation pipeline: distribution, tally management, candidate enrichment for vote math | Vote distribution, primary resolution, accumulation, tally cleanup       |
| `src/lib/elections/`      | API and route helpers: phases, param resolution, electoral votes, vote tally service          | Election API routes, phase display, param parsing, electoral math for UI |

**Entry points:**

- Vote distribution: `@/lib/electionEngine` (barrel at `electionEngine.ts`) or `@/lib/electionEngine/voteDistribution`
- Phase/param/electoral helpers: `@/lib/elections/phases`, `@/lib/elections/electionParamResolution`, etc.

### 3.2 App Route Conventions

| Pattern                        | Example                                       | Notes                            |
| ------------------------------ | --------------------------------------------- | -------------------------------- |
| List page: plural              | `/corporations`, `/politicians`, `/elections` | Index of entities                |
| Detail page: singular + `[id]` | `/corporation/[id]`, `/politicians/[id]`      | Single entity view               |
| Admin route group              | `/api/admin/<domain>/`                        | Admin-only; use `requireAdmin()` |

### 3.3 File Naming

| Context              | Convention                                        | Example                                    |
| -------------------- | ------------------------------------------------- | ------------------------------------------ |
| Route handlers       | `route.ts` (Next.js App Router)                   | `src/app/api/elections/[id]/campaigns/route.ts`      |
| Turn phases          | camelCase                                         | `electionResolution.ts`, `campaignTurn.ts` |
| DB types             | camelCase, matches collection                     | `electionCandidate.ts`                     |
| Test files           | co-located `*.test.ts` or `*.integration.test.ts` | `electionResolution.test.ts`               |
| Scripts (DB seeding) | `seed.ts`, `seed-<domain>.ts`                     | `seed-demographics.ts`, `seed-uk.ts`       |
| Shared schemas       | camelCase                                         | `objectId.ts`, `achievementGrant.ts`       |

### 3.4 Folder Naming

| Location          | Convention                        | Example                                    |
| ----------------- | --------------------------------- | ------------------------------------------ |
| `src/lib/`        | camelCase for domain modules      | `electionEngine`, `partyOrg`, `turnSystem` |
| `src/app/`        | kebab-case for URL routes         | `stockmarket`, `central-bank`, `campaign`  |
| `src/components/` | camelCase by feature              | `elections`, `budget`, `demographics`      |
| `scripts/`        | kebab-case for standalone scripts | `seed-demographics`, `migrations/`         |

### 3.5 Constants and Tunables

| Location               | Use                                                         | Example                                      |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| `src/lib/constants/`   | App-only config, labels, tunables                           | `countries.ts`, `partyOrg.ts`, `turnTime.ts` |
| `shared/constants/`    | Values needed by both `scripts/` and `src/`                 | `formulas.ts`, `legislation.ts`              |
| `src/lib/constants.ts` | Barrel + US visual assets (STATE_IMAGES, PARTY_LOGOS, etc.) | 47+ import sites, do not move                |

---

## 4. Hard-to-Discover Utilities

| Utility              | Location                                                                          | Purpose                                             |
| -------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------- |
| Mock DB for tests    | `src/lib/test-utils/mockDb.ts`                                                    | Vitest mock with chainable collection API           |
| Auth helpers         | `src/lib/api/requireAuth.ts`, `requireAdmin.ts`, etc.                             | See [API Route Checklist](./api-route-checklist.md) |
| Parse JSON body      | `src/lib/api/validate.ts` → `parseJsonBody`                                       | Zod validation for route bodies                     |
| Country config       | `src/lib/constants/countries.ts` → `getCountryConfig`, `getMajorPartiesForRegion` | No hardcoded country literals                       |
| Script DB connection | `scripts/utils/db.ts` → `connectDb`, `closeDb`                                    | For scripts only, not `getDb()`                     |

---

## 5. Names That Obscure Domain Meaning

### 5.1 Resolved or Documented

- **`electionEngine` vs `elections`**, See §3.1.
- **`npp` vs `npps`**, `npp/` = turn/NPP behavior modules; `npps` = collection/API group. Consistent.

### 5.2 Avoid These Patterns

- **Generic names for domain logic**, Prefer `electionResolution.ts` over `resolve.ts`.
- **`lib` under API routes**, `src/app/api/admin/npps/lib/` holds route-specific helpers; avoid confusing with top-level `src/lib/`.
- **Ambiguous plurals**, `elections` (API helpers) vs `electionEngine` (vote pipeline), document in comments when adding.

---

## 6. Validation Performed

- `npx tsc --noEmit`, Pass
- `npx eslint .`, Pass (excluding unrelated pre-existing)
- Import paths verified for corrected docs

---

## 7. Remaining Risks / Deferred Issues

| Risk                                                               | Mitigation                                                                                               |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| New contributors may still confuse `electionEngine` vs `elections` | Point to this doc and `repo-operating-map.md` §5 Quick Reference                                         |
| Seed data split (`scripts/seeds/` vs `src/lib/seeds/`)             | Documented in `repo-operating-map.md` P1 #1, boundary: scripts = DB seeding; src/lib = runtime constants |
| Plan sprawl (the design archive, `docs/superpowers/plans/`)        | Active work: `docs/superpowers/plans/`; archive: the design archive                                      |

---

## 8. Related References

| Topic                  | Location                     |
| ---------------------- | ---------------------------- |
| Project structure      | AHDGame `AGENTS.md`          |
| Blast radius and zones | `repo-operating-map.md`      |
| Layering and imports   | `architecture-boundaries.md` |
| Design specs           | ahd-docs `design/`           |
