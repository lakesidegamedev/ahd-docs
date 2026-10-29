# Product Roadmap

_Last updated: 2026-08-11_

> Product snapshot, not a mechanics reference. Feature counts and balance constants in this page can age quickly. Use the in-game wiki for player rules and the as-shipped engineering/design pages for current implementation details.

Status of features across the game. Working = shipped. Partial = core done, gaps remain. Missing = not built. Planned = in the roadmap.

---

## Current State

### Working

| Area                    | Features                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Turn system**         | Cron hourly, ordered phase sections (~12 groups / ~105 runPhase calls), action refresh, fund generation, election timers, coalition disband resolution                                                |
| **Elections**           | House, Senate, Governor, State Senate, President (primaries + Electoral College, running mates), UK Commons (multi-seat proportional)                                                                 |
| **NPPs**                | Entry, primaries, dropouts, federal + local bill voting, organic + arranged endorsements, whip compliance / defiance, and player-only U.S. congressional leadership voting                            |
| **Parties**             | State + national orgs, leadership elections, party actions, party influence mechanic (bonus actions from influence pool)                                                                              |
| **Coalitions**          | Cross-party alliances, invite/join request flow, disband votes, chair mechanics, party deletion cascade integration                                                                                   |
| **Congress**            | Bills (propose, vote, bicameral, presidential sign/veto), nominations, Speaker + leadership, unified UK/US bill processing                                                                            |
| **Legislation**         | v3 overhaul: LARP titles, 11-bracket tax scale, absolute cost model, immigration category, natural metric decay toward baseline                                                                       |
| **Cabinet**             | Nominate, Senate vote, confirm/reject, fire, two-phase proposed→active pattern, whippable nominations                                                                                                 |
| **Legislation effects** | Signed bills → stateMetrics → government approval → election vote accumulation, natural metric decay (0.25%/turn toward baseline)                                                                     |
| **Demographics**        | granular census-backed electorate per state, appeal scoring, polls (quick + full), admin-editable                                                                                                                       |
| **Government approval** | State + national, feeds elections                                                                                                                                                                     |
| **Achievements**        | Chunky labeled tile grid on profiles, category-organized, rarity percentages, settings highlights                                                                                                     |
| **Wiki**                | Design docs, election history, seats, parties, leadership, politician profiles, search                                                                                                                |
| **Map**                 | Governors, presidential electoral, UK constituency lean colors (Labour-red, Conservative-blue)                                                                                                        |
| **News**                | Composer, feed, leaderboard, wire ticker, post ticker, modal compose, automated election/legislation news                                                                                             |
| **Auth**                | Login, register, JWT, character creation                                                                                                                                                              |
| **Player Mail**         | Inbox, sent box, dual-sided soft-delete, mark-as-read, rate limiting, abuse reports, admin review queue, markdown-lite formatting                                                                     |
| **Corporations**        | Founding, sectors, shares, dividends, bonds, CEO elections, commodity market (27 types), config-driven exchanges (NYSE/FTSE/DAX/Nikkei), 3-mode sector production, HQ relocation, shareholder address |
| **National budgets**    | Active-country treasury panels, spending categories, fiscal costs, public enterprise revenue, sovereign bonds, heal tools                                                                             |
| **Campaigns**           | Fundraising-level income model (L0 $20k → L10 $5M/turn), party org scalar (1.0-1.6×), season multiplier (2× final 4 turns), presidential endorsements, donation tracking                              |
| **Travel**              | Presidential candidate travel to states (3, 5, 7, or 10 actions by electoral-vote tier), +1% favorability/turn passive bonus, travel state badges on electoral map                                     |
| **Admin**               | Elections, NPPs, officials, demographics, logs, wiki, feedback, setup dashboard, seed, party elections, leadership elections, legislation (country tabs), mail reports, heal tools                    |
| **Monitoring**          | Sentry error reporting across turn processor, API, UI, and cron jobs                                                                                                                                  |
| **Discord bot**         | Sync-roles, predictions, corporation lookup, /government, /autocomplete, stock-chart, country-specific game event webhooks, changelog webhook                                                         |
| **UK government**       | Government formation, confidence/no-confidence votes (seat-weighted), two-phase vote pattern, DUP + Sinn Féin parties                                                                                 |
| **Central bank**        | Chair management, resign button, auto-resign on cross-country relocation                                                                                                                              |
| **Performance**         | Turn processing parallelization, shared state data, hot-path query trimming, connection pool fix, pre-computed Discord data                                                                           |

### Partial

| Area                    | Done                                                                                               | Gap                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **President**           | Elected, VP, Cabinet, travel, auto-promote VP on vacancy, executive orders (`OrdersTab`, `WhiteHouseOrdersTab`, `EXEC_ORDER_SLOT_CAP = 2`) | No special appointments beyond Cabinet            |
| **Demographics**        | Per-state, admin edit, legislation-driven shift over time (`src/lib/demographicEffects.ts`, gated on `legislationDemographicEffectsV2Enabled`, default `true`) | Balance QA and broader coverage of the lean/turnout shift channel remain |
| **Legislation → world** | stateMetrics, approval, elections, natural decay, v2 lean/turnout shift into demographics          | v2 lean/turnout channel needs wider balance QA                    |
| **Cabinet**             | Full lifecycle; 15 positions (`src/lib/constants/cabinet.ts`); Senate confirmation; whippable       | No resign (member cannot voluntarily leave; government-transition clearing via `clearCabinetOnTransition` in `src/lib/cabinetTransition.ts` is not a voluntary resign) |
| **Mobile**              | Responsive layout, MobileSelect, modal fixes                                                       | Navbar, tables, forms need polish for 30+ min sessions            |
| **Election tests**      | Presidential engine, primary/NPP unit coverage, API integration, demographicAppeal                 | Broader full-flow E2E and DE/JP balance coverage remain           |
| **International**       | US, UK, DE, JP, IE, and CN configured with active country routes, currencies, exchanges, and turn branches (`status: "active"` in `src/lib/constants/countries.ts`) | DE, IE, and CN still need balance QA, admin polish, and broader E2E coverage |

### Missing

| Area                           | Notes                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| **Onboarding**                 | No guided tutorial; new players lack direction                             |
| **Live updates**               | SSE event bus exists (`src/lib/events.ts`, `src/app/api/events`) but is in-process (single-instance, no cross-instance fan-out) and has no client `EventSource` consumer wired up; client polling is what players actually see |
| **President actions**          | Special appointments beyond Cabinet (executive orders shipped, see Partial table) |
| **Elections testing**          | Broader full-flow E2E and cross-country balance coverage                   |
| **Cabinet resign**             | Members cannot voluntarily leave; fire-only                                |

### Planned

| Phase     | Scope                                                             |
| --------- | ----------------------------------------------------------------- |
| **0**     | Bug fixes                                                         |
| **A**     | Legislation → demographics v2 balance QA; Cabinet resign (optional) |
| **B**     | Onboarding flow                                                   |
| **C**     | Special appointments beyond Cabinet                                |
| **D**     | Mobile polish                                                     |
| **E**     | Elections testing (primaries, NPP, balance)                       |
| **F**     | Demographics: balance testing on the v2 lean/turnout channel       |
| **G**     | Durable live updates (Redis pub/sub or equivalent, replacing the in-process SSE emitter, plus a wired-up client consumer) |
| **Later** | Lobbying; expanded international                                  |

---

## Priorities

1. Bug fixes
2. Onboarding
3. Mobile
4. Legislation → demographics v2 balance QA
5. Special appointments beyond Cabinet
6. Elections testing
7. Demographics (balance QA on the v2 lean/turnout channel)
8. Live updates (Redis pub/sub + wired client consumer)

_Out of scope: real-time chat, microtransactions, PvP leaderboards._

---

## Audit Notes

**Turn pipeline.** ~12 groups / ~105 runPhase calls in ordered sections. Action refresh, fund gen, corporation turn, party influence, line of credit, NPP funds, savings interest, bond coupons, commodity prices, share-price recompute, financial snapshots, suspect scan, turnout decay, party GOTV, party elections, coalition disband votes, NPP behavior, country bill lifecycles, cabinet nominations, campaign turn, NPP action processing, activity logging, strict election resolution, parliamentary government phases, country election coverage, presidential succession, fiscal year, policy/demographic effects, regional budgets, crisis/ministerial orders, GDP growth, national metrics, trade-growth mirror, inflation, forex, central-bank chair phases, history snapshots, game health, suspicious detection, game state persist.

**Policy chain.** Legislation changes state metrics, metrics feed approval, and approval feeds elections. Natural metric decay toward baseline is implemented (0.25%/turn, see `src/lib/turn/metricDecay.ts`). Legislation-driven demographic movement now has two channels on `LegislationType.demographicEffects[]` (`src/lib/demographicEffects.ts`): a legacy population-share channel (always active) and a v2 economicLean/socialLean/turnout channel gated on the `legislationDemographicEffectsV2Enabled` game-state flag (defaults to `true`, see `src/lib/seeds/reference/featureFlagDefaults.ts`). Federal policies apply at 1/50 strength per US state and 1/12 strength per UK region; population shift caps at 0.1% per turn at full policy strength.

**NPP elections.** Entry (`nppElectionBehavior`), primary scoring (`primaryResolution`), dropout (`nppElectionBehavior`). Presidential: national influence, policy, party org. State: in-state appeal. Whip compliance: 100% for confidence votes, cabinet nominations, leadership elections.

---

## Country Expansion Status

`src/lib/constants/countries.ts` currently marks six countries `status: "active"`: US, UK, DE, JP, IE, and CN. Germany (DE) includes Bundestag/Bundesrat labels, Chancellor executive structure, AMS election config, major parties, `de_archetypes`, EUR/ECB currency mapping, DAX exchange wiring, country routes, and DE regional budget processing. Ireland (IE) and China (CN) are also live in runtime config (IE: Dáil/Taoiseach, configured Hare-quota largest-remainder allocation, Central Bank of Ireland; CN: Premier/President structure with a sector-driven State-Capitalist economic model), not just scaffolded.

The rest of `COUNTRY_ORDER` (BR, NG, HU, PL, RO, YU, BG, CS, RU, FR, IT, ES, SE, TR, GR, AT, FI, DD, plus SCO and WAL, which sit outside `COUNTRY_ORDER`) is `status: "coming-soon"`: authored but not launched.

### Germany, Ireland, and China Remaining Gaps

| Area              | Remaining work                                                                   |
| ----------------- | -------------------------------------------------------------------------------- |
| **Balance QA**    | Tune seat allocation, coalition/government-formation behavior, parties, demographics, and economy per country |
| **Coverage**      | Add broader election, government-formation, budget, and admin E2E coverage for DE, IE, and CN |
| **Admin polish**  | Continue hardening country-aware admin panels for DE/IE/CN-specific edge cases    |
| **Content depth** | Expand seeded parties, regions, demographics, and country-specific wiki content  |

### Future Countries

The `coming-soon` roster covers most of the eastern-bloc and western-European template countries plus Brazil, Nigeria, Scotland, Wales, and East Germany (DD). Canada has a reserved `CAD` currency code (`src/lib/constants/currencies.ts`) with a USD-parity fallback, but no `CountryConfig` entry at all.

---

## Later

**Lobbying.** Corporate lobbying and labor vs. business factions. Unions, collective bargaining and pensions have shipped; lobbying builds on the existing corporation, union and party systems.

**Expanded international.** Trade, sanctions, and crises between active countries affecting domestic metrics. Real trade flows and diplomacy events.

---

## Related

- [Mail](./mail.md) - Player-to-player messaging
- [Coalitions](./coalitions.md) - Cross-party alliances
- [Election Mechanics](./elections.md) - Primary scores, vote accumulation, FPTP vs proportional
- [Technical Architecture](./technical-architecture.md) - Implementation details
