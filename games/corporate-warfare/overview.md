# Corporate Warfare overview

Corporate Warfare is an offline, single-player economic strategy game. You are an investor at the head of a holding company. You build plants, open divisions, float subsidiaries, sign joint ventures, ship goods over a freight network and fight named rival firms for every market, while business cycles, central banks, elections and world commodity prices move under you.

The game is free while in development and needs no account. It runs on Windows, Linux and Android today. iPhone, iPad and Mac versions are waiting on App Store approval. There is no multiplayer: every rival is run by the game.

## What you do

- **Run a group of companies.** Your companies hold divisions, one per sector in each region, and each division runs plants. You choose what to build, where, and how to price what it makes. See [Your holding company](companies.md) and [Regions and labour](regions-and-labour.md).
- **Play the corporate game.** Carve a division out into a subsidiary, list part of it on the exchange, spin it off, borrow in the bond market, or co-own a division with another group as a joint venture. See [Your holding company](companies.md).
- **Move goods.** Every input your plants need is bought on a commodity exchange that spans the whole map, priced as delivered. Freight runs over trucking, rail, pipeline and lake and sea lanes that you can own, reserve and contest. See [The commodity exchange](commodity-exchange.md) and [Freight](freight.md).
- **Fight rivals.** Dozens of rival firms per scenario, each run by a chief executive with a temperament, compete for share, raid your divisions, bid for your companies and remember who wronged them. See [Rivals](rivals.md).
- **Live with the economy.** Booms and busts, a central bank that sets rates, governments that change market laws after an election, and world prices for oil, steel, grain and more that follow history or your game's seed. See [Governments and market laws](governments.md). In Ruhr and Rhine you also deal with several currencies: [Currencies](currencies.md).

One tick is one game week. You can play a week at a time or let the clock run at 1, 2 or 4 weeks a second, and the game pauses when a decision needs you.

## How the systems connect

Plants need workers and inputs. Workers come from regional labour pools (regions and labour). Inputs come from the commodity exchange, priced as delivered, so freight decides who can sell to whom. What you make sells on the same exchange to other plants and to households. The business cycle and the central bank set demand, loan rates and wages. Governments change the rules on tax, mergers, freight and prices. Rivals compete for the same pools, lanes and markets, and your group structure decides how much control, tax and risk you carry.

## How long a game is and how you score

A career has no fixed end. In five-year mode the game pauses at week 260 (five years) and records a score from 0 to 100, then lets you play on. The score is about what you built over your starting position, so holding your starting company alone scores low (under 40).

| Part | Weight | What counts |
| --- | --- | --- |
| Growth | 45 percent | Your personal net worth against the start: 20 if flat, rising to 100 at double |
| Expansion | 25 percent | 20 for each division beyond the first, 10 for each state beyond the first |
| Leadership | 10 percent | 25 for each region and sector where you have the largest capacity |
| Resilience | 10 percent | Share of weeks without past-due bills |
| Conduct | 10 percent | 100 minus 10 per unresolved regulatory breach and 5 per failed worker settlement |

Each part is capped at 100. A score reached after an insolvency recovery contract is marked as assisted (see [Your holding company](companies.md)). You compare careers by the score and by net worth.

## Scenarios

Four scenarios are playable: [Great Lakes 2000, Texas Oil Patch 1981, Silicon Valley 1995 and Ruhr and Rhine 1991](scenarios.md). Each has its own map, regions, rival firms, starting position and world price history. Start with Great Lakes 2000.

## Where to go next

- [Getting started](getting-started.md): download, install and your first career.
- [Scenarios](scenarios.md): the four starting worlds.
- [Your holding company](companies.md), [Regions and labour](regions-and-labour.md), [The commodity exchange](commodity-exchange.md), [Freight](freight.md), [Rivals](rivals.md), [Governments and market laws](governments.md) and [Currencies](currencies.md): how each part of the economy works.
- [Changelog](changelog.md): what changed in each release.

## Status

Corporate Warfare is in active development and releases often. Big releases can change the economy enough that older saves do not load; the [changelog](https://github.com/lakesidegamedev/corporate-warfare/blob/main/CHANGELOG.md) says when. The source is public on [GitHub](https://github.com/lakesidegamedev/corporate-warfare).

Last checked: 2026-10-29, version 1.8.0

Sources for the numbers above: `crates/cw-sim/src/economy/score.rs` (score weights and components), `crates/cw-session/src/lib.rs` (the week 260 pause), `compose/shared/src/jvmShared/kotlin/net/lakesidegames/corporatewarfare/GameStore.kt` (speeds 1, 2 and 4 weeks a second).
