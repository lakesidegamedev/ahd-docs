# A House Divided - Game Design Documentation

> **Note:** These design documents were written during early planning. Some
> technical details may differ from the current implementation. The app uses a
> single Next.js stack. See the `README` and `CHANGELOG` in the
> a-house-divided app repo, and
> [technical-architecture.md](./technical-architecture.md) for the current
> state.

## Overview

A House Divided is a real-time political simulation game where players create
characters, join parties, and compete for political office across active country
simulations. The current runtime supports the US, UK, Japan, and Germany through
shared country configuration and country-specific political rules.

## Core Concept

Players control individual politicians making decisions and building coalitions.
The game operates in real time with compressed political cycles. The US baseline
uses:

- **Presidential Term**: 8 days
- **Senate Term**: 12 days (3 staggered classes)
- **House Term**: 4 days

Parliamentary countries use their own configured cycles, confidence mechanics,
snap-election rules, and vacancy handling.

## Game World

- **Scope**: Active country simulations for US, UK, JP, and DE, with
  regional/state structures where configured
- **Persistence**: Continuous server-based world
- **Player Count**: NPPs (Non-Player Politicians) fill seats, enter elections,
  and hold office; game functions meaningfully regardless of player count

## Documentation Structure

- [Units, money and time (as shipped)](./units-and-money-as-shipped.md) - Which currency, period and era scale every money and quantity number uses
- [Global Response Crises (as shipped)](./global-response-crises-as-shipped.md) - Persistent international campaigns, global tension, nuclear integration, and release seeding
- [Technical Architecture](./technical-architecture.md) - Current implementation
  (Next.js, MongoDB, cron, collections)
- [Core Systems](./core-systems.md) - Term cycles, action economy, Cabinet,
  Campaign Manager, News
- [Turn Processing](./turn-processing.md) - Ordered turn phases and processing
  invariants
- [Player Progression](./player-progression.md) - Character creation, career
  path, office benefits
- [Stats & Actions](./stats-actions.md) - Core stats, available actions, action
  economy
- [Elections](./elections.md) - Primary system, general elections, Electoral
  College, county maps, Elections Hub
- [Bills & Legislation](./bills-legislation.md) - Bill types, voting system,
  policy effects
- [Congress Leadership](./congress-leadership.md) - Speaker, House/Senate
  leadership elections, Cabinet nominations
- [Cabinet](./cabinet.md) - Presidential nominations, Senate confirmation,
  positions list
- [Campaign Manager](./campaign-manager.md) - Campaign pages, tiered access,
  operations
- [Demographics](./demographics.md) - Demographic system, policy preferences,
  voter behavior
- [Parties](./parties.md) - Party system, endorsements, party mechanics
- [Party Building](./party-building.md) - National and state party growth,
  treasury, leadership, caucuses, and Slate overview
- [Party Influence](./party-influence.md) - Party-led NPP management and
  relocation rules
- [Party Whips](./party-whips.md) - Whip Room, soft/hard player whips, and
  caucus whip behavior
- [Caucuses](./caucuses.md) - Internal party factions, caucus treasury, caucus
  whip, and NPP recruitment
- [Party Slate](./party-slate.md) - National race assignment, Slate persistence,
  and NPP filing behavior
- [NPP System](./npp-system.md) - Non-Player Politicians: election behavior,
  influence, bill voting, endorsements, and current leadership-voting scope
- [Government Approval](./government-approval.md) - State and national
  government approval driven by metrics vs averages
- [Corporations](./corporations.md) - Corporation founding, sector expansion,
  stock exchange, economic effects
- [Labour & Unions](./labour.md) - Wage economics, macro coupling, NPC/player
  unions, strikes, union-busting and union law
- [Economic Systems](./economic-systems.md) - Cross-system economic model and
  dependencies
- [Commodities](./commodities.md) - Commodity types, pricing, sector
  supply/demand
- [Stock Market](./stock-market.md) - Config-driven exchange hubs, listings,
  bonds, commodities, forex, wealth, stats
- [Currency Exchange](./currency-exchange.md) - Multi-currency wallets, forex
  rates, and currency storage rules
- [National Budget & Treasury](./national-budget.md) - Treasury panels, fiscal
  display, national corporations
- [Resources](./resources.md) - Resource economy and generation rules
- [Price Indexing & Repricing](./price-indexing-and-repricing.md) - Currency-aware
  historical repricing
- [Sovereign Bonds](./sovereign-bonds.md) - Government debt instruments
- [National Metrics](./national-metrics.md) - Socioeconomic indicators and
  aggregation
- [Player Policies](./player-policies.md) - Personal policy positions and shifts
- [Canvassing](./canvassing.md) - Turnout action mechanics
- [Relocation](./relocation.md) - Home state moves, cooldown, CEO rules
- [Japan](./japan.md) - National Diet, regions, PM formation, snap elections
- [Japan Elections](./japan-elections.md) - Shugiin/Sangiin election mechanics,
  seat allocation
- [United Kingdom](./united-kingdom.md) - Commons, regions, PM and confidence
- [Parliamentary Government](./parliamentary-government.md) - Shared
  parliamentary formation and confidence model
- [Snap Elections](./snap-elections.md) - PM-triggered dissolution, 96-turn
  vacancy auto-snap, cycle-reset math
- [Vacancy Handling](./vacancy-handling.md) - Open seats and appointments
- [Roadmap](./roadmap.md) - Feature status: working, partial, missing, planned
