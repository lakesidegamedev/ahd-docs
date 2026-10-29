# Wiki System

## Summary

The Wiki System provides in-game documentation and strategy guides. Page content is authored as TypeScript under `src/lib/seeds/wiki/` and seeded into the `wikiPages` collection. It is **not** synced live from Markdown at runtime.

This `ahd-docs` repository is a separate developer-facing documentation site. Its build imports the game's seeded wiki pages for a read-only mirror, then renders the Markdown files under `design/`, `engineering/`, and `api/`. Editing one source does not update the other: player-facing mechanics belong in the AHDGame wiki seed, while implementation and integration documentation belongs here.

Player guide: the wiki is the player guide itself, starting at [the in-game wiki](https://www.ahousedividedgame.com/wiki). There is no separate player page for the wiki system.

**Location:** `src/lib/wiki/` (runtime read/search/render), `src/lib/seeds/wiki/` (page content + seeding)

**Key files:**

- `getWikiPageData.ts` - Fetch wiki page metadata for display
- `loadContent.ts` - Load markdown content and transform wikilinks
- `wikiSearch.ts` and `wikiSearchSources.ts` - Build the unified search index (pages, politicians, seats, parties, leadership)
- `syncPriorSubmissions.ts` - Renames legacy ObjectId-embedded slugs (`player-{hex}`, `corp-{hex}`, `party-profile-{hex}`) to sequentialId-based slugs; see [Slug Migration](#slug-migration) below
- `seatData.ts` - Derive seat slugs and titles from states collection
- `partyData.ts` - Fetch party data for wiki pages
- `leadershipData.ts` - Fetch congressional leadership data
- `playerPages.ts` - Player character profile data for wiki
- `redirects.ts` - Legacy slug → canonical path mappings
- `componentRegistry.ts` - Custom markdown component registry
- `categories.ts` - Wiki page categories
- `learningPaths.ts` - Curated learning path definitions

## Rules

### Wiki page configuration

Pages are configured in `WIKI_SEED_PAGES` array (`src/lib/seeds/wiki/pages.ts`), aggregated from category files in `src/lib/seeds/wiki/pages/*.ts`:

```typescript
export const WIKI_SEED_PAGES: readonly WikiSeedPage[] = [
  ...gettingStartedPages,
  ...electionsPages,
  ...legislaturesPages,
  ...partiesPages,
  ...countriesPages,
  ...militaryPages,
  ...economyPages,
  ...advancedPages,
  ...resourcesPages,
  ...commoditiesPages,
  ...iterationsPages,
];
```

Each `WikiSeedPage` (`src/lib/seeds/wiki/types.ts`) defines:

- `slug`, URL identifier
- `title`, `description`, `content`, Display data
- `category`, Primary category (also used as first tag)
- `featured`, Highlighted on wiki home
- `difficulty`, `contentType`, `estimatedReadTime`, Metadata
- `countryId`, Optional country scoping
- `private`, Admin-only page

#### Categories

Pages are organized into categories:

| Category                                                                 | Purpose                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `getting-started`                                                        | New player onboarding and first steps                       |
| `elections`                                                              | Primaries, generals, campaigns, and election history        |
| `legislatures`                                                           | Bills, voting, chamber leadership, and government formation |
| `parties`                                                                | Parties, coalitions, endorsements, and NPP behavior         |
| `countries`                                                              | Country hubs and country-specific rules                     |
| `military`                                                               | Conflicts, armed forces, occupation, and peace              |
| `economy`                                                                | Corporations, budgets, banking, currency, and finance       |
| `commodities`                                                            | Generated commodity-market reference pages                  |
| `resources`                                                              | Deposits, extraction contracts, subsidies, and tariffs      |
| `advanced`                                                               | Strategy and detailed system references                     |
| `iterations`                                                             | Historical recaps of numbered game iterations               |
| `reference`                                                              | Miscellaneous reference material                            |
| `custom-pages`, `characters`, `corporations`, `player-parties`, `events` | Community-authored namespaces                               |

#### Featured pages

Pages with `featured: true` are highlighted on the wiki home page:

Featured flags are set per page in the category files under `src/lib/seeds/wiki/pages/`. Current featured pages include `getting-started`, `core-systems`, `strategy-guides`, `first-campaign-walkthrough`, `reference-formulas`, `glossary`, `elections-player-guide`, `election-mechanics` and `campaign-strategy`. Check the seed files for the full current set.

#### Special routes

Some slugs use custom UI instead of markdown rendering. These special live routes are handled by dedicated page components and cannot be overridden by markdown files:

- `/wiki/elections`, Election browser
- `/wiki/roadmap`, Game roadmap
- `/wiki/random-events`, Player-event browser
- `/wiki/my`, Current user's wiki submissions
- `/wiki/new`, Submission editor
- `/wiki/paths/*`, Learning paths
- `/wiki/party/[id]`, Party profile pages
- `/wiki/seat/[slug]`, Seat/office pages
- `/wiki/leadership/[role]`, Congressional leadership roles

### Content seeding

Wiki content lives as TypeScript `WikiSeedPage` objects (not markdown files) under `src/lib/seeds/wiki/pages/*.ts`, aggregated in `WIKI_SEED_PAGES` (`src/lib/seeds/wiki/pages.ts`) and written to `wikiPages` by the seeder (`src/lib/seeds/wiki/seeder.ts`, `index.ts`). Editing a page means editing its `WikiSeedPage` entry and re-seeding, there is no admin-panel "sync from docs/design" action.

### Slug migration

#### `syncPriorWikiSubmissions(db, moderatorId)`

**Purpose:** Rename legacy ObjectId-embedded wiki slugs to their current sequentialId-based form (`src/lib/wiki/syncPriorSubmissions.ts`).

**Logic:**

1. Find every `wikiPages` document whose slug matches `player-{hex}`, `corp-{hex}`, or `party-profile-{hex}` (24-hex ObjectId).
2. Resolve the embedded ObjectId to the live character/corporation/party and look up its `sequentialId`.
3. Skip (recording a reason) if the entity no longer exists, has no `sequentialId`, or the new slug is already taken.
4. Otherwise rename the page's slug to the current `playerWikiSlug()` / `corporationWikiSlug()` / `partyWikiSlug()` form.

**Returns:**

```typescript
interface SyncPriorSubmissionsResult {
  renamed: SyncPriorRenamed[]; // { oldSlug, newSlug, kind }
  skipped: SyncPriorSkipped[]; // { oldSlug, reason }
}
```

This is a one-way cleanup pass for stale slugs, not a content-sync mechanism.

### Auto-update triggers

The wiki can auto-update on game events:

#### Election results

When elections resolve, politician pages gain election-history entries (`updatePoliticianPagesAfterElection` in `src/lib/wiki/updatePoliticianPageOnElection.ts`).

#### Leadership changes

Congressional leadership pages (`/wiki/leadership/[role]`) are built live from current office data (`src/lib/wiki/leadershipData.ts`), and `markCongressLeadership.ts` records that a character has held a leadership role.

### Learning paths

Wiki pages can be organized into learning paths for new players:

Paths are defined in `LEARNING_PATHS` (`src/lib/wiki/learningPaths.ts`) and served under `/wiki/paths/*`. Pages tied to a single country are hidden from players who do not have that country enabled. The current paths are:

1. **New Player Journey** (`new-player`): `getting-started` -> `core-systems` -> `stats-actions` -> `rpg-stats` -> `relocation` -> `campaign-strategy` -> `election-mechanics` -> `multi-country-play`.
2. **Running for Office** (`running-for-office`): `election-mechanics`, `campaign-strategy`, `demographics-targeting`, `fundraising-ads`, `political-operations`, `primary-general-tactics`, `npp-elections`.
3. **Advanced Strategy** (`advanced-strategy`): congress and chamber leadership, bills, national budget, offices reference, party organization, formulas reference, power-player guide.
4. **Economy Operator** (`economy-operator`): plants, commodities, resources, household economy, stock market, sovereign bonds, central banks, interbank lending, pensions, IMF facility, market safeguards, national budget.
5. **War College** (`war-college`): conflicts, declaring war, units, conscription, generals, doctrine, commands, battles, procurement, occupation, peace, and a full war walkthrough.
6. **Cold War Operations** (`cold-war-operations`): `bloc-spheres`, `international-organizations`, `trade-system`, `embargo-and-trade-exposure`, `conflicts-overview`, `central-banks`.

### Content authoring

Wiki page content is authored as `WikiSeedPage` TypeScript objects, organized by category file under `src/lib/seeds/wiki/pages/`. Long-form text usually lives in `src/lib/seeds/wiki/content/` and is imported by its page record. The standalone docs in this repository are a separate developer-facing reference and do not propagate to the in-game wiki automatically.

### Content guidelines

#### Featured pages

Featured pages should:

- Be high-quality and well-maintained
- Cover core mechanics
- Be accessible to new players

#### Categories

Choose the most specific category:

- Use `getting-started` for new player essentials
- Use `advanced` for detailed formulas and strategy
- Reserve `reference` for uncategorized or community reference material

#### Tags

Tags enable cross-category discovery:

- `elections`, `campaigns`, `npps`, `parties`
- `economy`, `budget`, `bonds`
- `legislatures`, `legislation`, `bills`

## Data

| Collection | Access | Notes |
| --- | --- | --- |
| `wikiPages` | read, insert, update | unique `slug`; all wiki content |
| `characters`, corporations, parties, `states`, offices | read | feed player, corporation, party and seat pages and search |
| `electedOfficials`, elections | read | politician election history and leadership pages |

Fields on a `wikiPages` document (`src/lib/db/types/wikiPage.ts`):

```typescript
interface WikiPage {
  _id: ObjectId;
  slug: string; // unique index
  title: string;
  description: string;
  content: string; // markdown
  status?: "draft" | "pending_review" | "published" | "archived";
  submittedBy?: ObjectId;
  reviewedBy?: ObjectId;
  tags?: string[];
  templateType?: string;
  featured?: boolean;
  category?: string;
  contentType?: "guide" | "reference" | "mechanics" | "strategy";
  difficulty?: "beginner" | "intermediate" | "advanced";
  estimatedReadTime?: number;
  private?: boolean;
  countryId?: CountryId;
  isAutoGenerated?: boolean;
  autoGenerateConfig?: AutoGenerateConfig;
  gameIteration?: string;
  gameStartDate?: string;
  lastUpdated?: Date; // seed content date
  designDocUrl?: string;
  viewCount?: number;
  createdAt: Date;
  updatedAt: Date;
  editHistory?: EditHistoryEntry[];
}

interface EditHistoryEntry {
  userId: ObjectId;
  timestamp: Date;
  action: "created" | "edited" | "approved" | "rejected" | "archived";
  note?: string;
}
```

Player-visible: title, description, content, tags, featured flag, difficulty, read time, the "Updated" date from `lastUpdated`, and the design-doc chip from `designDocUrl`. Not shown to players: `status` drafts, `reviewedBy`, `editHistory`, and any page with `private: true` (admin only).

## Configuration

| Setting | Default | Set in |
| --- | --- | --- |
| `WIKI_CREATE_COOLDOWN_HOURS` | 12 hours between new page creations per user | `src/lib/wiki/createCooldown.ts` |
| Seed page list | `WIKI_SEED_PAGES` | `src/lib/seeds/wiki/pages.ts` |
| Per-page `featured`, `private`, `countryId`, `difficulty`, `designDocUrl`, `lastUpdated` | `featured` false | each `WikiSeedPage` entry (`src/lib/seeds/wiki/types.ts`) |
| `lastUpdated` fallback | git-derived date per slug | `src/lib/seeds/wiki/lastUpdated.generated.ts` |
| Seed options `force`, `dryRun`, `slugs` | false, false, all | `WikiSeedOptions`, `src/lib/seeds/wiki/seeder.ts` |
| `GAME_ITERATION`, `GAME_START_DATE` | env | stamped on new pages as `gameIteration`, `gameStartDate` |
| `NEXT_PUBLIC_DOCS_URL` | env | base for the design doc chip |
| Learning paths | six paths | `LEARNING_PATHS`, `src/lib/wiki/learningPaths.ts` |
| Categories | listed above | `src/lib/wiki/categories.ts` |

No era or country preset changes the wiki system; `countryId` on a page hides it from players who do not have that country enabled.

## Timing

- Seeding runs on demand, not per turn: through the seeder or `POST /api/admin/wiki/reseed`.
- Politician page updates run when an election resolves (`updatePoliticianPagesAfterElection`).
- Leadership pages are computed on request from current office data.
- The legacy-slug rename pass runs only when an admin triggers it.
- Search is built from pages, politicians, seats, parties and leadership at request time (`wikiSearch.ts`).

## Worked trace

Seeding the page `no-confidence-votes` (entry in `src/lib/seeds/wiki/pages/legislatures.ts`: `category: "legislatures"`, `extraTags: ["vonc", "parliamentary"]`, `designDocUrl: "design/uk-pm-no-confidence.html"`, `difficulty: "intermediate"`) on an empty database.

1. `seedWikiPages` finds no document with that slug, so it inserts.
2. `tags = unique([category, ...extraTags])` = `["legislatures", "vonc", "parliamentary"]`.
3. `status: "published"`, `featured: false` (not set on the seed), `isAutoGenerated: false`, `submittedBy` is the admin id.
4. `lastUpdated` comes from the seed override if present, else `WIKI_LAST_UPDATED["no-confidence-votes"]`.
5. `editHistory = [{ action: "created", note: "Reseed: initial insert" }]`.
6. Result: slug appears in `inserted`. A second run finds the document; `hasHumanEdits` is false because the only note starts with "Reseed", so it is updated, not skipped.
7. If a moderator edits it (history gains an `edited` entry without a "Reseed" note), the next non-force run puts the slug in `skipped` with the reason "Page has human edits (use --force to overwrite)".

Slug migration: a page `player-507f1f77bcf86cd799439011` whose character has `sequentialId` 42 is renamed to `player-42` (`playerWikiSlug(42)`). If `player-42` already exists, or the character is gone or has no `sequentialId`, the page lands in `skipped` with a reason.

## Edge cases and limits

- Auto-generated pages (`isAutoGenerated: true`) are never touched by the seeder.
- Pages with human edits are skipped unless `force` is set.
- Special routes (`/wiki/elections`, `/wiki/roadmap`, and the others listed under Special routes) take precedence over markdown slugs.
- Private pages are hidden from non-admins in the API (`src/app/api/wiki/[slug]/route.ts`).
- Authors cannot set `status`, `featured` or `private` on their own pages (same route).
- New page creation is limited to one per 12 hours per user; edits and admin approvals are not limited.
- Slug rename skips entities that no longer exist, lack a `sequentialId`, or collide with an existing slug.
- Country-scoped pages are hidden from players without that country enabled.
- `private` seed pages are excluded from the public index.

## Invariants

- Seeded slugs are unique. Enforced by `src/lib/seeds/wiki/navigationIntegrity.test.ts` and the unique `slug` index.
- Every compatibility redirect and every learning-path step points at a seeded page or special route. Enforced by `navigationIntegrity.test.ts`.
- Links inside seeded content use canonical seeded slugs. Enforced by `navigationIntegrity.test.ts`.
- Every seed page resolves a `YYYY-MM-DD` `lastUpdated`. Enforced by `src/lib/seeds/wiki/seeder.test.ts`.
- The seeder never overwrites human-edited or auto-generated pages without `force`. Enforced by `seeder.test.ts`.
- Docs-site content never propagates into the game wiki. By construction, nothing syncs it.

## Failure and recovery

- **Page content stale or wrong in production**: edit the `WikiSeedPage` source, deploy, and run a reseed. A page with human edits needs `force`, which overwrites those edits.
- **Seed run partly applied**: reseeding is an idempotent upsert per slug, so rerunning completes it.
- **Legacy ObjectId slugs left behind**: rerun the slug rename pass; skipped entries carry their reasons.
- **Broken link or redirect after a slug change**: caught by the navigation integrity test before release; at runtime the redirect map in `redirects.ts` is the fix point.
- **Missing game stamp on old pages**: an admin backfill route stamps `gameIteration` and `gameStartDate`.

## Connections

**Driven by:**

- Game seeds and content files under `src/lib/seeds/wiki/`.
- Election resolution (`updatePoliticianPagesAfterElection`) and live office data (`leadershipData.ts`, `seatData.ts`, `partyData.ts`).
- Character, corporation and party records through `playerPages.ts`.

**Affects:**

- Player onboarding through learning paths and featured pages.
- Search across pages, politicians, seats, parties and leadership.
- The developer docs site, which mirrors the seeded wiki pages read-only at build time (and which design docs link back to through `designDocUrl`).

Related systems:

- **Developer Docs:** this repository's `design/`, `engineering/`, and `api/` Markdown sources
- **Wiki API:** `src/app/api/wiki/` - Wiki route handlers
- **Admin Tools:** `src/app/admin/` and `src/app/api/admin/wiki/` - slug rename and moderation

## Tests

- `src/lib/seeds/wiki/seeder.test.ts`: insert, overwrite, human-edit skip, auto-generated skip, slug filter, dry run, `lastUpdated`.
- `src/lib/seeds/wiki/navigationIntegrity.test.ts`: unique slugs, redirects, learning paths, content links.
- `src/lib/seeds/wiki/glossary.test.ts`: glossary data.
- `src/lib/wiki/wikiSearch.test.ts`, `src/lib/wiki/wikiSearchSources.test.ts`, `src/lib/wiki/wikiIndexData.test.ts`: search and index.
- `src/lib/wiki/starterStub.test.ts`, `src/lib/wiki/pageClassification.test.ts`, `src/lib/wiki/__tests__/contentFilter.test.ts`: stubs, classification, content filter.
- `src/lib/wiki/officeHistoryArchive.test.ts`, `manualOfficeHistory.test.ts`, `officeIteration.test.ts`, `officeTenureDisplay.test.ts`: office history.
- Gaps: no test for `syncPriorSubmissions.ts`, `updatePoliticianPageOnElection.ts`, or the 12-hour creation cooldown.

## Known issues and history

- The reference docs and the in-game wiki are separate sources; edits to one do not reach the other, and drift between them is possible.
- The category `getting-started` guidance, featured set and path lists are maintained by hand in the seed files; this page lists the featured set only in part.
- Slug migration is a one-way cleanup, not a content sync.

Last checked: 2026-10-29, version 1.18.0
