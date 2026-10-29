# Technical Architecture

## Technology Stack

| Layer        | Technology                                    | Version    |
| ------------ | --------------------------------------------- | ---------- |
| Framework    | Next.js (App Router)                          | 16.4       |
| UI           | React                                         | 19.3       |
| Language     | TypeScript                                    | 6.0        |
| Styling      | Tailwind CSS                                  | 4          |
| Database     | MongoDB native driver                         | 7.4        |
| Auth         | Custom JWT via `jose`                         | 6.2        |
| Testing      | Vitest (unit/integration) + Playwright (E2E)  | 5.0 / 1.64 |
| Deployment   | Railway (Nixpacks build, `next start`)        | n/a        |
| File Storage | Cloudflare R2 (prod) / local filesystem (dev) | n/a        |

## Architecture Pattern

### Request Flow

- **Next.js App Router** handles all UI (React Server Components + client components) and API routes. No separate backend server.
- All game logic lives in API routes (`src/app/api/`). Domain logic is extracted into service modules under `src/lib/`.
- **Client-server communication** is primarily HTTP. The active client hook polls `/api/game/turn/status` and synthesizes turn events; `src/lib/events.ts` provides a lightweight in-process event emitter for turn/theme events, but it is not a durable cross-instance push bus.

### Turn Processor

- `processTurn()` in `src/lib/turnSystem.ts` is the single entry point. It is fired in-process by `node-cron` (`src/lib/cron.ts`), scheduled from `instrumentation.ts` at server boot, not by an external cron service. Schedule is `0 * * * *` (hourly, or `30 * * * *` when the `TURN_CRON_MINUTE` environment variable is 30), or `0,30 * * * *` when `GameState.fastMode` is on (schedule helpers in `src/lib/cron/turnCronMinute.ts`). `GET /api/cron/turn` also exists as an HTTP-triggerable fallback (protected by `requireCron()`/`CRON_SECRET`) with a backup fire half an hour after the primary (`30 * * * *` by default) that only runs if the primary missed its slot.
- The phase list now lives in a registry (`src/simulation/phases/turnPhaseRegistry.ts`, phase names enumerated in `src/simulation/phases/turnPhaseNames.ts`) rather than being inlined in `turnSystem.ts`. `BASE_TURN_PHASE_NAMES` currently has **151 phases**, plus per-country election phases from `COUNTRY_ELECTION_PHASES`. Each phase runs through the shared turn-phase runtime (`src/simulation/engine/turnPhaseRuntime.ts`), failures log to Sentry but don't halt subsequent phases.
- **Election-resolution ordering is critical:** primaries must resolve before vote accumulation; votes must accumulate before timers advance; timers must advance before elections resolve. The table below groups phases by concern; it is illustrative, not an exhaustive phase-by-phase listing (see the registry files for the full current set, which also includes governor/SCOTUS, extraction/prospecting, decolonization, spheres of influence, impeachment, by-elections, and ledger-reconciliation phases not shown below).

| Section                    | Phases                                                                                                                                                                                                                                                                       | Key constraint                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1. Resources & finance     | `actionRefresh`, `fundGeneration`, `corporationTurn`, `partyInfluenceTurn`, `lineOfCreditTurn`, `nppFundGeneration`, `savingsInterestTurn`, `bondTurn`, `commodityPrices`, `recomputeSharePrices`, portfolio/corp/exchange/investor/wealth snapshots, `financialSuspectScan` | Share-price recompute must precede market snapshots |
| 2. Demographics            | `turnoutDecay` -> `partyGOTV` -> `partyOrgTurn`                                                                                                                                                                                                                              | Sequential (decay before GOTV)                      |
| 3. Party elections         | `statePartyElections`, `nationalPartyElections`, `nationalCommitteeElections`, `partyActionGeneration`, `emptyPartyCleanup`                                                                                                                                                  | Parallel election processors, then cleanup          |
| 4. NPP & coalitions        | `coalitionDisbandVotes`, `nppBehavior`                                                                                                                                                                                                                                       | NPP behavior runs after party processing            |
| 5. Bills & cabinets        | `billLifecycle`, country bill lifecycles from `COUNTRY_BILL_PHASES`, `stateBillTimers`, `cabinetNominations`                                                                                                                                                                 | Parallel-safe                                       |
| 6. Campaigns & actions     | `campaignTurn`, `nppActionProcessing`, `activityLogging`                                                                                                                                                                                                                     | Activity summary after action phases                |
| 7. Election resolution     | `candidatePartySweep` -> `primaryResolution` -> `voteAccumulation` -> `campaignSpendReset` -> `electionTimers` -> `primarySnapshots` -> `electionResolution` -> `clearResolvedSupport` -> `leadershipVacate`                                                                 | **Strictly sequential; ordering is load-bearing**   |
| 8. Parliamentary govt      | `parliamentaryGovernmentFormation`, `parliamentaryGovernmentPhases`, `parliamentaryVacancyWatcher`                                                                                                                                                                           | After election resolution                           |
| 9. Election coverage       | `perpetualElections`, country election phases from `COUNTRY_ELECTION_PHASES`, `leadershipElections`, `staleCandidateCleanup`, `presidentialSuccession`                                                                                                                       | Parallel-safe coverage before succession            |
| 10. Fiscal year            | `fiscalYear` (turn 40 of 48, October)                                                                                                                                                                                                                                        | Conditional                                         |
| 11. Effects & regional ops | `policyEffects`, `demographicEffects`, `policyReactionDecay`, `archetypeApprovalDecay`, `unownedSectorGrowth`, `metricDecay`, `subsidyBudget`, `regionalBudgetProcessing`, `jpRegionalBudgetProcessing`, `deRegionalBudgetProcessing`, `crisisTurn`, `ministerialOrders`     | Parallel-safe state/regional updates                |
| 12. National aggregation   | `gdpGrowth`, `nationalMetrics`, `tradeGrowthMirror`, `inflationRecalc`, `forexTurn`, `centralBankChairTurn`, `centralBankChairSelection`                                                                                                                                     | Ordered; forex is gated by `GameState.forexEnabled` |
| 13. History & health       | `metricHistory`, `approvalSnapshot`, `interestRateSnapshot`, `partyHistorySnapshot`, `gameHealthSnapshot`, `suspiciousDetection`                                                                                                                                             | After metrics and central-bank updates              |
| 14. Persistence            | `GameState` update, `TurnLog` insert, in-process event emit                                                                                                                                                                                                                  | **Critical, not wrapped in try/catch**              |

- Server-enforced `lastTurnProcessed` timestamp prevents clock drift. `getGameTime()` (`src/lib/time/gameTime.ts`) uses this as `effectiveNow`, not `new Date()`, so election phase display stays correct even after batch turns.
- `src/lib/cabinetTransition.ts` (`clearCabinetOnTransition`), clears all cabinet members when a new president takes office; called from election resolution, not the turn loop directly.

### Multi-Country Support

- 29 country configs in `COUNTRY_CONFIGS` (`src/lib/constants/countries.ts`), covering the US, UK, and Ireland/Scotland/Wales alongside a broader eastern-bloc and western-Europe roster (Japan, China, Nigeria, Brazil, France, Italy, Spain, Sweden, Turkey, Greece, Austria, Finland, and the RU/DD/PL/CS/HU/RO/BG/YU/UKR/BLR/BAL one-party-bloc set). Raw string literals (`"US"`, `"UK"`, etc.) are banned by a custom ESLint rule (`local/no-country-literals`), use `CountryId`/`COUNTRY_CONFIGS`.
- Each country has its own legislature type (Congress / House of Commons / National Diet / etc.), election schedule, and regional structure, driven by per-country config rather than hardcoded branching.
- UK: House of Commons (650 seats, 480-turn cycles); constituency MPs stored in `electedOfficials`.
- JP: National Diet (Shugiin 465 seats + Sangiin 248 seats); full bill lifecycle via `jpBillLifecycle`; snap elections supported.
- Germany: active configuration with Bundestag/Bundesrat labels, Chancellor executive, EUR/ECB currency mapping, DAX exchange, and DE regional budget processing.

## Communication & Notifications

### Notifications

- Stored in MongoDB `notifications` collection; surfaced on next page load.
- 146 notification types (`NOTIFICATION_TYPES` in `src/lib/db/types/notifications.ts`): election results, leadership events, bill lifecycle, cabinet, party events, NPP influence, achievements, and more.
- UI: paginated list, type filter, search, bulk delete, mark-all-read, URL-based filters, date grouping.

### Hero Image System

- Tall gradient banners served through `/api/images/hero/[slug]`, which answers with a 307 redirect to the hosted image for the slug (no server-side proxying, so it costs no function time).
- Slug set covers government/institution banners per country (`white-house`, `house-of-commons`, `downing-street`, `national-diet`, `bank-of-england`, `federal-reserve`, `great-hall-of-the-people`, etc.) plus one banner per commodity sector (`commodity-steel`, `commodity-oil`, `commodity-software`, ...). See `HERO_URLS` in `src/app/api/images/hero/[slug]/route.ts` for the current list.
- Component: `<HeroImage>` (`src/components/HeroImage.tsx`) wraps Next.js `<Image>` with the proxy URL.

### Toast Notifications

- Client-side feedback via `useToast()` from `@/contexts/ToastContext`.
- Usage: `showToast("Message", "success" | "error" | "info")`.

## Database Schema (High-Level)

### Core Collections

| Collection                     | Purpose                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| `users`                        | Auth credentials, ban status, fingerprints                              |
| `characters`                   | Player stats, funds, actions, office, policy positions, bio             |
| `npps`                         | AI politicians with personality traits, cooldowns, influence state      |
| `elections`                    | Active/upcoming/completed races (all types)                             |
| `electionCandidates`           | Per-candidate rows; status active/withdrawn                             |
| `electionVoteTallies`          | General-phase vote totals, turn snapshots, seats estimate               |
| `primarySnapshots`             | Hourly primary standings for trend display                              |
| `electedOfficials`             | Current office holders (players + NPPs); canonical post-election source |
| `politicalParties`             | Party data, treasury, action pool, leadership IDs                       |
| `statePartyOrg`                | Per-state-party org level, treasury, leadership, tax rate               |
| `statePartyElections`          | Leadership elections for Chair/VC/Treasurer                             |
| `statePartyVotes`              | Votes cast in state party leadership elections                          |
| `statePartyElectionCandidates` | Candidates in state party leadership elections                          |

### Legislation

| Collection             | Purpose                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `bills`                | Full bill lifecycle with chamber tallies and timeline timestamps           |
| `billVotes`            | Per-member votes on bills                                                  |
| `legislationTypes`     | Policy domains, legislation types, policy options (economic/social scores) |
| `committeeAssignments` | Committee positions (Chair, Ranking Member) per legislation type           |
| `statePolicies`        | Base policy per legislation type for nation and each state                 |

### Elections & Leadership

| Collection                    | Purpose                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `speakerElections`            | Speaker election state (12h voting window; `_id: "current"`)                   |
| `speakerNominations`          | Active House Speaker candidacies and votes                                     |
| `houseLeadershipElections`    | Majority/Minority Leader elections (`_id: majority_leader \| minority_leader`) |
| `houseLeadershipNominations`  | Candidacies and votes for House Majority/Minority Leader                       |
| `senateLeadershipElections`   | Pro Tempore/Majority/Minority Leader elections                                 |
| `senateLeadershipNominations` | Candidacies and votes for Senate leadership                                    |

### Cabinet

| Collection           | Purpose                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `cabinetNominations` | Pending and resolved cabinet nominations; status active/confirmed/rejected |
| `cabinetMembers`     | Confirmed cabinet members (position → character mapping)                   |

### Campaigns & Economy

| Collection           | Purpose                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `campaigns`          | Campaign state: resource allocation, manager assignment              |
| `campaignOperations` | Log of campaign spending, upgrades, activities                       |
| `countyElectionData` | County-level partisan lean and population for election visualization |

### Geography & Metrics

| Collection              | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `states`                | Population, GDP, lean, house districts               |
| `stateDemographics`     | Per-state demographic groups, category weights       |
| `demographicCategories` | Category definitions (race, gender, etc.) and groups |
| `stateMetrics`          | 9-category metrics per state                         |

### Social & Content

| Collection      | Purpose                                              |
| --------------- | ---------------------------------------------------- |
| `newsPosts`     | News posts created by players                        |
| `newsReactions` | Reactions and comments on news posts                 |
| `notifications` | Per-player notification queue (146 types, paginated) |
| `feedback`      | Bug reports and suggestions (with captured context)  |

### NPP Relations

| Collection             | Purpose                        |
| ---------------------- | ------------------------------ |
| `nppInfluenceAttempts` | Records of influence attempts  |
| `nppRelationships`     | Player-NPP relationship scores |
| `nppEndorsements`      | NPP endorsements of candidates |
| `playerEndorsements`   | Player endorsements            |

### Admin & System

| Collection          | Purpose                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `adminLogs`         | Admin activity audit trail                                                 |
| `actionLogs`        | Records of player action execution                                         |
| `gameConfig`        | Turn config, action costs, office bonuses, starting stats                  |
| `gameState`         | Current turn number, pause state, `lastTurnProcessed`, next scheduled turn |
| `roadmapItems`      | Admin-managed roadmap entries with phase, category, status                 |
| `roadmapCategories` | Category/subcategory groupings for roadmap items                           |

## Deployment Considerations

### Hosting

- **App**: Deployed on Railway (`railway.toml`, Nixpacks build, `next start`). Any Node.js-compatible host would work in principle, but the boot path (`instrumentation.ts` starting `node-cron`, `NODE_OPTIONS=--max-old-space-size` heap cap, `/api/health` healthcheck) is tuned for Railway specifically.
- **Database**: MongoDB Atlas or self-hosted.
- **Cron**: `node-cron` (`src/lib/cron.ts`) runs inside the Next.js process, started from `instrumentation.ts` at boot, the same in every environment, not just locally. `GET /api/cron/turn` exists as an HTTP-triggerable fallback protected by `CRON_SECRET`, but the primary turn cron is in-process, not an external scheduler.

### Scaling

- **DB indexes**: managed via versioned migration entries under `src/lib/migrations/entries/` and the index seeder (`src/lib/admin/seed/seedIndexes.ts`); too many to enumerate here.
- **Turn processor**: Single-threaded sequential; `/api/cron/turn` allows up to `maxDuration = 800` seconds for the full phase pipeline, well above the old 60-second target.
- **Game time cache**: `getGameTime()` (`src/lib/time/gameTime.ts`) caches for 5 seconds; invalidated explicitly by `sync-date`.

## Testing

| Layer       | Tool       | Command            | Notes                                                                             |
| ----------- | ---------- | ------------------ | --------------------------------------------------------------------------------- |
| Unit        | Vitest     | `npm test`         | `src/**/*.test.ts`                                                                |
| Integration | Vitest     | `npm test`         | API route tests with mocked MongoDB                                               |
| E2E         | Playwright | `npm run test:e2e` | `e2e/*.spec.ts`; requires `npm run dev`; set `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` |

## Security & Fairness

- All game logic validated server-side. Client actions verified before execution.
- Server-enforced `lastTurnProcessed` timestamps prevent clock manipulation.
- Rate limiting on sensitive endpoints (elections, Congress, feedback).
- Custom ESLint rule `local/no-country-literals` prevents hardcoded country ID comparisons.
- Admin routes require `requireAdmin()`; cron routes require `requireCron()` with `Authorization: Bearer ${CRON_SECRET}`.

## Notable API Routes

| Route                                                | Method              | Purpose                                                                                     |
| ---------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `/api/cron/turn`                                     | GET                 | Hourly turn processor (in-process `node-cron`; this route is the HTTP-triggerable fallback) |
| `/api/cron/fog-update`                               | GET                 | Campaign fog-of-war visibility update                                                       |
| `/api/auth/me`                                       | GET                 | Current user + character                                                                    |
| `/api/elections`                                     | GET                 | All elections (filter by type/state/status)                                                 |
| `/api/elections/[id]`                                | GET                 | Single election with candidates and tally                                                   |
| `/api/elections/[id]/state/[stateId]/county-results` | GET                 | County-level vote distribution                                                              |
| `/api/elections/[id]/state/[stateId]/cd-results`     | GET                 | Congressional district seat assignments                                                     |
| `/api/country/[code]/legislature/members`            | GET                 | Chamber composition by country (e.g. UK Commons: 650 seats, party breakdown)                |
| `/api/country/[code]/legislature/bills`              | GET/POST            | Bills list for the country's legislature; propose a bill (member/admin)                     |
| `/api/country/[code]/legislature/leaders`            | GET                 | Presiding officer / head of government / opposition leader for the country                  |
| `/api/whitehouse/cabinet`                            | GET                 | All cabinet positions with member + nomination data                                         |
| `/api/whitehouse/cabinet/nominations`                | POST                | President nominates a character                                                             |
| `/api/whitehouse/cabinet/nominations/[id]/vote`      | POST                | Senator votes on a nomination                                                               |
| `/api/whitehouse/cabinet/fire`                       | POST                | President fires a cabinet member                                                            |
| `/api/campaigns/[id]`                                | GET                 | Campaign detail (owner/party/public access tiers)                                           |
| `/api/campaigns/mine`                                | GET                 | Current user's campaign                                                                     |
| `/api/news`                                          | GET/POST            | News feed and post creation                                                                 |
| `/api/country/[code]/approval`                       | GET                 | National government approval, per country                                                   |
| `/api/country/[code]/budget/federal`                 | GET                 | Federal budget data, per country                                                            |
| `/api/images/hero/[slug]`                            | GET                 | Hero banner redirect (307 to the image URL)                                                           |
| `/api/roadmap`                                       | GET                 | Public roadmap data for wiki page                                                           |
| `/api/admin/seed`                                    | GET/POST            | Universal game seeder (admin only)                                                          |
| `/api/admin/roadmap`                                 | GET/POST/PUT/DELETE | Roadmap item management (admin only)                                                        |
| `/api/admin/roadmap/categories`                      | GET/POST/PUT/DELETE | Roadmap category management (admin only)                                                    |
| `/api/admin/law-types`                               | POST                | Create custom legislation type (admin only)                                                 |
| `/api/performance`                                   | GET                 | Game performance metrics                                                                    |

## Implementation Status

| System                                                                             | Status         |
| ---------------------------------------------------------------------------------- | -------------- |
| Authentication + characters                                                        | ✅ Complete    |
| Turn system (modular, 150+ phases via a phase registry)                            | ✅ Complete    |
| Elections (all 5 types, perpetual, Electoral College)                              | ✅ Complete    |
| NPP system (entry, dropout, influence, Speaker/leadership auto-vote)               | ✅ Complete    |
| Bill lifecycle (two chambers + President)                                          | ✅ Complete    |
| Party system (national + state, leadership elections)                              | ✅ Complete    |
| Cabinet (nomination → Senate vote → confirm/fire)                                  | ✅ Complete    |
| Congress leadership (Speaker + House/Senate leaders, auto-trigger after elections) | ✅ Complete    |
| Campaign fund generation + taxes                                                   | ✅ Complete    |
| Campaign manager pages (3-tier access, dedicated `/campaign/[id]`)                 | ✅ Complete    |
| Campaign song (YouTube embed, autoplay controls)                                   | ✅ Complete    |
| Demographics + state metrics (9 categories)                                        | ✅ Complete    |
| County/district election maps                                                      | ✅ Complete    |
| News / posts system                                                                | ✅ Complete    |
| Admin panel (fully modularised, Law Types, Universal Seeder)                       | ✅ Complete    |
| Map view (real geographic paths, Political Lean mode)                              | ✅ Complete    |
| Player bio + profile page                                                          | ✅ Complete    |
| Achievements system (rarity tiers; `src/lib/achievements/`)                                | ✅ Complete    |
| Notifications (146 types, pagination, filtering)                                   | ✅ Complete    |
| Discord integration                                                                | ✅ Complete    |
| Multi-country support (29 configured countries)                                    | ✅ Complete    |
| UK House of Commons (composition, bills, leadership)                               | ✅ Complete    |
| Roadmap system (admin-managed, public wiki page)                                   | ✅ Complete    |
| Public + developer changelog page                                                  | ✅ Complete    |
| API validation (Zod schemas, admin + key routes)                                   | ✅ Complete    |
| API testing (Vitest integration + Playwright E2E)                                  | ✅ Complete    |
| API hardening (rate limiting, request logging)                                     | ✅ Complete    |
| Legislative amendments                                                             | 🔲 Placeholder |
| US Senate filibuster / cloture and veto override                                   | ✅ Complete    |
| Policy effects on state metrics and granular demographics                          | ✅ Complete    |
| Presidential and regional executive orders                                         | ✅ Complete    |
| Special executive appointments beyond the existing cabinet and succession systems  | 🔲 Planned     |

Last checked: 2026-10-29, version 1.18.0
