# Governments and market laws

The economy runs on a business cycle, a central bank and a government that changes the rules every few years. They set your loan rates, your tax bill, how big you can grow before regulators step in, and whether you can lock rivals off a freight lane. Knowing what moves them tells you when to borrow, when to hold cash and which party you are better off under.

## How it works

### The business cycle

Output runs above or below its trend with momentum and small random shocks. Good times and cheap money build up credit, and the more credit there is, the likelier a bust that leaves borrowers paying debt down for months. Inflation rises when the economy runs hot. Household demand, loan rates, wages and import prices all follow the cycle. A collapse in world commodity prices feeds in as a demand shock (see [The commodity exchange](commodity-exchange.md)).

### The central bank

The central bank meets every 6 weeks and moves its policy rate in quarter-point steps (half a point when it is a full point or more off its target) toward a rule that weighs inflation and output. Its chair, one of the game's named characters, leans dovish or hawkish, and that tilts every decision. A hawk weighs inflation more and runs a little tighter. At the end of a four-year term the government reappoints the chair or names a new one. A chair who kept inflation within a point of target without a recession is reappointed 60 percent of the time, otherwise 25 percent.

Two rates matter to you. The **prime lending rate** is the policy rate plus 3 points plus a lending premium. The **ten-year yield** prices corporate bonds (see [Your holding company](companies.md)).

### Government and elections

Two parties compete in an election every 208 weeks (four years). The outcome is decided by the economy: approval drifts toward a level set by growth above trend, inflation above target and high interest rates, and a recession hurts most. On election week the governing party holds on with a chance equal to its approval plus 3 points, between 5 and 95 percent.

A new government announces its programme at once and it takes effect 13 weeks (a quarter) later. The programme sets:

| Law | Commerce Party | Workers' Party |
| --- | --- | --- |
| Corporate tax | 3 points lower (floor 15 percent) | 3 points higher (cap 38 percent) |
| Low-skill wage floor | Unchanged | 10 percent higher |
| Union law | Weak | Strong |
| Merger review share | 40 percent | 30 percent |
| Review of deals that buy a supplier or customer | None | From 35 percent share |
| Common carrier rules | Off | On |
| Strategic reserve | Off | On |
| Production quotas | On, in extraction states | Off |
| Failing strategic firms | Bailout loan, then privatise | Nationalise |

### Market laws, in plain terms

- **Merger review.** A deal is reviewed once the combined firm's share of a market reaches the review share (40 or 30 percent), or when the market becomes very concentrated and the deal adds notably to it. A review adds a wait before the deal can close.
- **Common carrier** (Workers' Party). Owned pipelines, rail and ships must sell spare capacity at no more than 110 percent of the base rate and may not lock more than 40 percent of a lane in contracts (see [Freight](freight.md)).
- **Production quotas** (Commerce Party). In extraction states, while a good's price is under 92 percent of its average, plants making it may run at only 80 percent of capacity. This is meant to hold prices up; it lifts the week the price recovers.
- **Strategic reserve** (Workers' Party). For goods that do not spoil, the state buys in a bust when the price falls under 85 percent of its average and sells in a spike over 120 percent, to steady prices.
- **Rescue.** A failing **strategic** firm (one that carries freight, stores goods, makes energy, or is a bank or insurer) may get help. Under the Commerce Party the state lends it enough to clear its arrears. Under the Workers' Party a sound firm gets the same loan, but a firm the court would liquidate is nationalised: the state buys every private share and the firm becomes a state firm that prices at cost plus 5 percent. A firm you control is never taken over. A firm is rescued at most once in three years, and only large or lane-critical firms with a profitable last quarter qualify.
- **Privatisation** (Commerce Party). A state firm that has run a year and earned for a quarter is sold back to outside investors.

### Key numbers

| Item | Value |
| --- | --- |
| Central bank meeting | Every 6 weeks |
| Rate step | 0.25 points (0.5 when a full point or more off) |
| Policy rate range | 0.25 to 15 percent |
| Election | Every 208 weeks |
| Law delay after an election | 13 weeks |
| Default corporate tax | 25 percent |
| Quota | 80 percent of capacity when price is under 92 percent of average |
| Reserve | Buys under 85 percent, sells over 120 percent of average |
| State firm price | Cost plus 5 percent |
| Rescue cool-down | 3 years (156 weeks) |

**Worked example.** The Commerce Party is in power with corporate tax at 25 percent, and your group earns $2,000,000 a year in profit, so you pay $500,000. The Workers' Party wins an election in week 208. The new programme is announced at once and takes effect in week 221. From then the rate is 28 percent: you pay $560,000, $60,000 more. The same win moves merger review from 40 to 30 percent of a market, raises the wage floor by 10 percent and turns on common carrier rules and the strategic reserve.

## What you can do

- **Read the economy card** in Markets. It lists the laws in force, the reserve, quotas, state firms and recent disruptions, and each rate decision with its reason. Alerts appear only when a law or incident touches your companies.
- **Prepare for a bust.** When credit has been building and the cycle runs hot, pay down floating debt and hold cash. Busts leave borrowers paying down debt for months.
- **React to a rate rise.** Loans and new bonds reprice with it, so lock in term funding before a hiking cycle if your credit allows.
- **Plan around elections.** A tax or wage change reaches you 13 weeks after the vote, and the news feed announces the programme the day it is won, so act in that window.
- **Use or avoid the laws.** Under common carrier law, do not count on locking a lane. Under quotas, do not build new extraction capacity in a capped state. If you run a strategic firm, keep profit positive, because that is what qualifies it for a rescue.

Tip: a deal that would take you near the review share waits 4 weeks for review, so plan large mergers before an election that could lower the threshold.

## Connections

**Driven by**
- [Your holding company](companies.md): your market share can trigger merger review.
- [The commodity exchange](commodity-exchange.md): a fall in world prices feeds the cycle as a demand shock, and prices trigger quotas and the reserve.
- [Rivals](rivals.md): the cast supplies the central bank chair and party leaders.
- [Regions and labour](regions-and-labour.md): wages and demand follow the cycle.

**Affects**
- [Your holding company](companies.md): taxes, bond yields, merger review and activist pressure.
- [Freight](freight.md): common carrier rules cap rates and contract shares.
- [The commodity exchange](commodity-exchange.md): quotas and the reserve change supply and prices.
- [Regions and labour](regions-and-labour.md): the wage floor and union law.
- [Rivals](rivals.md): review thresholds limit takeovers.
- [Currencies](currencies.md): central bank rates and inflation drive exchange rates.

## Status

Live in every scenario and difficulty. The starting government and the central bank chair depend on the scenario (see [Scenarios](scenarios.md)); the starting government's market laws are in force from week one. Scenario settings can change the opening laws. In Ruhr and Rhine each country has its own central bank, but the anchor country's drives the cycle.

Last checked: 2026-10-29, version 1.8.0

Technical detail: every constant, formula and source file is in [Exact rules](#exact-rules) at the end of this page.

## Exact rules

### Business cycle and central bank

Source: `crates/cw-sim/src/economy/macro_cycle.rs`.

- `MEETING_WEEKS = 6`, `RATE_FLOOR_BPS = 25`, `RATE_CEILING_BPS = 1,500`.
- At each meeting: `taylor = neutral_real + inflation + inflation_gap x (50 + stance / 2) / 100 + output_gap x (50 - stance x 3 / 10) / 100 + stance / 2`. The target is `taylor` rounded to the nearest 25. The step is 0 if the distance is under 25, 50 if 100 or more, otherwise 25, in the direction of the target.
- Chair term 208 weeks. Reappointment chance 6,000 basis points when inflation is within 100 basis points of target and no recession, otherwise 2,500. A Commerce government leans the new chair 20 points dovish (`lean = -20`).
- `prime_rate = policy_rate + 300 + lending_premium`. `ten_year_yield = (policy + 3 x (neutral_real + expected_inflation)) / 4 + 75 + max(inflation - target, 0) / 4`, in basis points.

### Politics

Source: `crates/cw-sim/src/economy/politics.rs`, `crates/cw-sim/src/state.rs`.

- `TERM_WEEKS = 208`, `LAW_DELAY_WEEKS = 13`.
- Approval target: `5,000 + output_gap x 6 - max(inflation - 200, 0) x 4 - max(rate - 500, 0) x 2`, minus 800 in recession, clamped 1,500 to 8,500. Approval moves 1/20 of the gap each week.
- Election: the governing party keeps power with probability `clamp(approval + 300, 500, 9,500)` basis points. A new government's approval resets to 5,500.
- Commerce programme: `corporate_tax - 300` (floor 1,500), `merger_review_bps = 4,000`, weak unions, no common carrier, no vertical review, no reserve, bailout then privatise, quotas on. Workers' programme: `corporate_tax + 300` (cap 3,800), wage floor x 110 / 100, `merger_review_bps = 3,000`, strong unions, `vertical_review_bps = 3,500`, common carrier, reserve, nationalise, quotas off. Default `corporate_tax_bps = 2,500` (`state.rs`).
- A government returned to office re-announces its market programme if it differs from what is in force.
- `QUOTA_BPS = 8,000`, `QUOTA_PRICE_PCT = 92`. Quota states are those that specialise in extraction. The cap is a regional supply modifier recomputed each week, lifted when the price recovers or the law is repealed.

### Merger review

Source: `crates/cw-sim/src/economy/deals.rs`. A deal is reviewed when the combined share is at least the law's `merger_review_bps`, or when post-deal concentration (HHI) exceeds `HHI_REVIEW = 2,500` with an increase above `HHI_DELTA = 200`, or when a vertical share reaches `vertical_review_bps`. `SHARE_REVIEW_BPS = 3,500` is the documented base share (the live test uses the law's value), and `REVIEW_WEEKS = 4`, `DILIGENCE_WEEKS = 2`, `OFFER_WEEKS = 4`, `TRANSACTION_FEE_BPS = 200`, `SQUEEZE_OUT_BPS = 9,000`.

### Strategic reserve

Source: `crates/cw-sim/src/economy/reserve.rs`. `BUST_PCT = 85`, `SPIKE_PCT = 120`, `PROFIT_PCT = 110`, `MIN_HISTORY = 26`, `MAX_STOCK_LOTS = 4,000`, `BUY_LOTS_PER_WEEK = 300`, `SELL_LOTS_PER_WEEK = 150`, `BUDGET_DIVISOR = 40`.

### Rescue

Source: `crates/cw-sim/src/economy/rescue.rs`. `MAX_CASH_PCT = 30`, `RESCUE_COOLDOWN_WEEKS = 156`, `HOLD_WEEKS = 52`. Strategic means a bank, insurer, or a firm with a transport, storage or energy plant. Viable means at least 13 weeks of history with non-negative operating profit, and either staff at the top quarter of firms or at least 3,000 basis points of some lane. Nationalisation applies only when the player does not control the firm and liquidation value is under 50 percent of debt. Only firms keeping books in the numeraire qualify. State firms price at cost plus 5 percent.

### Timing and edge cases

The cycle, the bank and politics each run once a week; politics checks the election date. A pending law change takes effect on or after its effective week. Laws that are per state (quotas) are stored as a bit per state in code order. The starting government's programme applies from week one.
