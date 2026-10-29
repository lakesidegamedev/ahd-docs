# Stock Market

## Summary

Each country has a **stock exchange** hub listing corporations, bonds, funds, commodities, wealth rankings and currencies. This page is the technical reference: how a share price is built, which constants shape it, and when it is recomputed.

Player guide: [Stock Market](https://www.ahousedividedgame.com/wiki/stock-market)

## Rules


### Share price formula

`computeSharePrices` (`src/lib/corporations/sharePriceFormula.ts`) produces the **fundamental value** for each corporation. The full displayed price is `fundamentalValue x sentimentMultiplier x hqConfidenceMultiplier x orderFlowMultiplier`, rounded to 2 decimals (`applyPriceMultipliers`, `src/lib/corporations/applyPriceMultipliers.ts`). The multipliers are applied at turn time and again by the quarter-hour market tick (see Timing).

```
tangibleBook = liquidCapital + 0.75 x bankEquity + sectorNPV + constructionInProgress
             + techAssetValue + 0.75 x bondHoldings - issuedBondDebt
tangibleBookPerShare = max(0, tangibleBook) / totalShares

riskAdjustedEarnings = operatingEarnings + 0.75 x bondCouponEarnings
earningsPowerPerShare = riskAdjustedEarnings / costOfCapital / totalShares

gCapped = min(max(0, sectorGrowthRate), costOfCapital - 0.02)
growthPremiumPerShare = riskAdjustedEarnings x gCapped / (costOfCapital - gCapped) / totalShares

fundamental = (1.0 x tangibleBookPerShare
             + (0.5 x earningsPowerPerShare + 0.15 x growthPremiumPerShare) x bondReliancePenalty)
             x subsidiarySprawlMultiplier

multipliedFundamental = fundamental x insiderConcentrationMultiplier x indexInclusionMultiplier
```

Then the path depends on the corporation's state:

- **Normal:** `rateLimitPrice(multipliedFundamental, previousPrice)`, clamped to plus or minus 35% of the previous price.
- **Inside the post-split window:** `0.7 x previousPrice + 0.3 x multipliedFundamental`, with no rate limiter.
- **IMF bailout active:** the clamped price is multiplied by 0.85 and rounded to 2 decimals.

`normalizedEarnings` is a 3-turn rolling average of annualised after-tax income, with equity-method additions from cross-corporation holdings already applied (`src/lib/turn/corporation/earningsRollingAverage.ts`, `equityMethodEarnings.ts`). Bond coupon income is netted against interest paid as an issuer before the split into operating and bond slices, so a net debtor is never priced as a bond fund.

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| Minimum share price | 0.01 | `src/lib/constants/corporations.ts` (`MIN_SHARE_PRICE`) |
| Tangible book weight | 1.0 | `src/lib/constants/corporations.ts` (`FUNDAMENTAL_TANGIBLE_BOOK_WEIGHT`) |
| Earnings power weight | 0.5 | `src/lib/constants/corporations.ts` (`FUNDAMENTAL_EARNINGS_POWER_WEIGHT`) |
| Growth premium weight | 0.15 | `src/lib/constants/corporations.ts` (`FUNDAMENTAL_GROWTH_PREMIUM_WEIGHT`) |
| Growth cap buffer (g stays this far below cost of capital) | 0.02 | `src/lib/constants/corporations.ts` (`GROWTH_PREMIUM_CAP_BUFFER`) |
| Rolling-average window for earnings | 3 turns | `src/lib/constants/corporations.ts` (`FUNDAMENTAL_ROLLING_AVG_TURNS`) |
| Chartered-bank equity recognised in tangible book | 0.75 | `src/lib/constants/corporations.ts` (`BANK_EQUITY_VALUATION_WEIGHT`) |
| Bond holdings and bond coupon income discount | 0.75x | `src/lib/constants/corporations.ts` (`BOND_INCOME_SHARE_PRICE_DISCOUNT`) |
| Bond reliance threshold (share of earnings from coupons) | 0.75 | `src/lib/constants/corporations.ts` (`BOND_INCOME_RELIANCE_THRESHOLD`) |
| Bond reliance penalty floor at 100% reliance | 0.5x, ramping linearly from 1.0x at the threshold | `src/lib/constants/corporations.ts` (`BOND_INCOME_MAX_RELIANCE_PENALTY`) |
| Insider concentration threshold | CEO holds more than 65% | `src/lib/corporations/sharePriceFormula.ts` (`INSIDER_CONCENTRATION_THRESHOLD`) |
| Insider concentration max penalty | -30% at 100% ownership, quadratic ramp | `src/lib/corporations/sharePriceFormula.ts` (`INSIDER_CONCENTRATION_MAX_PENALTY`) |
| Index inclusion threshold | 10% held by index funds | `src/lib/corporations/indexOwnership.ts` (`INDEX_INCLUSION_THRESHOLD`) |
| Index inclusion max premium | +8%, linear ramp, flat from 35% held | `src/lib/corporations/indexOwnership.ts` (`INDEX_INCLUSION_MAX_PREMIUM`, `INDEX_INCLUSION_PREMIUM_SATURATION`) |
| Subsidiary sprawl discount | free up to 3, linear to -50% at 9 or more | `src/lib/corporations/sharePriceFormula.ts` (`SUBSIDIARY_SPRAWL_*`) |
| Per-turn rate limiter | plus or minus 35% of previous price | `src/lib/constants/corporations.ts` (`SHARE_PRICE_MAX_TURN_MOVE`) |
| Rate limiter off at or below | previous price 1.00 | `src/lib/constants/corporations.ts` (`SHARE_PRICE_RATE_LIMIT_MIN_PREV`) |
| IMF bailout multiplier | 0.85 | `src/lib/imf/constants.ts` (`IMF_BAILOUT_SHARE_PRICE_MULTIPLIER`) |
| Sentiment cap (event pulses) | plus or minus 25% | `src/lib/corporations/sentimentEngine.ts` (`SENTIMENT_CAP`) |
| HQ-state confidence sentiment cap | plus or minus 12% (0.003 per point from baseline 60) | `src/lib/corporations/sentimentEngine.ts` (`HQ_CONFIDENCE_SENTIMENT_CAP`) |
| Order flow cap | plus or minus 15% | `src/lib/corporations/orderFlowEngine.ts` (`ORDER_FLOW_CAP`) |
| Order flow mean reversion | 0.8 carry per tick | `src/lib/corporations/orderFlowEngine.ts` (`ORDER_FLOW_MEAN_REVERSION`) |
| Cost of capital | smoothed prime rate + sector risk premium (financial 0.06, media 0.05, manufacturing 0.04, chemical industries 0.05, healthcare 0.05, retail 0.04, manufacturing vehicles 0.05, technology 0.06, energy 0.06, agriculture 0.03, real estate 0.04, construction 0.04, defense 0.04, telecommunications 0.04, media entertainment 0.06, logistics 0.04, extraction 0.06, default 0.05) | `src/lib/constants/corporations.ts` (`SECTOR_RISK_PREMIUM`), `costOfCapital` assembled in `src/lib/turn/corporation/recomputeSharePrices.ts` |
| Financial risk premium easing | 0.06 ramps to 0.04 over 192 turns starting at turn 1253 | `src/lib/constants/corporations.ts` (`STOCK_BOOST_NPV_START_TURN`, `STOCK_BOOST_NPV_RAMP_TURNS`, `STOCK_BOOST_FINANCIAL_RISK_PREMIUM`), `sectorRiskPremiumAtTurn` in `src/lib/corporations/rules/marketBoost.ts` |
| Minimum float for order flow | 5% of total shares; below it the multiplier is 1.0 and execution uses the fundamental | `src/lib/corporations/marketExecution.ts` (`MIN_ORDER_FLOW_FLOAT_FRACTION`) |

### Share structure limits

| Rule | Value | Source |
| --- | --- | --- |
| Public issuance per action | up to 50% of outstanding shares | `src/lib/constants/corporations.ts` (`MAX_PUBLIC_ISSUANCE_PERCENT`) |
| CEO self-issuance per action | up to 20% of outstanding shares, at a 15% premium | `src/lib/constants/corporations.ts` (`MAX_SELF_ISSUANCE_PERCENT`, `CEO_SELF_ISSUANCE_PREMIUM`) |
| Forward split | up to 100x total shares | `src/lib/constants/corporations.ts` (`MAX_FORWARD_SHARE_SPLIT_MULTIPLIER`) |
| Reverse split floor | 1,000,000 total shares | `src/lib/constants/corporations.ts` (`SHARE_CONSOLIDATION_MIN_TOTAL_SHARES`) |
| Cooldown between structure changes | 48 turns | `src/lib/constants/corporations.ts` (`SHARE_STRUCTURE_COOLDOWN_TURNS`) |
| Post-split smoothing | split turn plus 2 more (3 turns), previous-price weight 0.7 | `src/lib/constants/corporations.ts` (`STOCK_SPLIT_PRICE_SMOOTHING_TURNS`, `STOCK_SPLIT_SMOOTHING_PREV_WEIGHT`) |
| Previous-price anchor clamp during smoothing | within 3x of the new fundamental | `src/lib/constants/corporations.ts` (`STOCK_SPLIT_PREV_ANCHOR_MAX_RATIO`) |
| Execution price band | within 5x of the fundamental price | `src/lib/constants/corporations.ts` (`SHARE_EXECUTION_PRICE_BAND_MAX_RATIO`) |
| Issuance cooldown | 24 hours between public or self issuances (shared) | `src/app/api/corporations/[id]/shares/issue/route.ts` (`ISSUANCE_COOLDOWN_MS`) |
| Pool sell pacing | the equity pool buys at most 5% of a company's value per turn from all sellers; sales under 25,000,000 anchor per company per turn are never paced | `src/lib/equities/blockPacing.ts` (`EQUITY_POOL_SELL_SHARE_PER_TURN`, `EQUITY_POOL_SELL_FLOOR_ANCHOR`) |
| Issue pacing | the pool places at most 10% of outstanding shares per turn, floored at 50,000,000 anchor | `src/lib/equities/blockPacing.ts` (`EQUITY_PRIMARY_PLACE_SHARE_PER_TURN`, `EQUITY_PRIMARY_PLACE_FLOOR_ANCHOR`) |
| Equity pool half-spread | 1% each side of the midpoint, before the cash skew (cap 3%) | `src/lib/equities/marketPoolQuotes.ts` (`EQUITY_POOL_HALF_SPREAD`, `EQUITY_POOL_CASH_SKEW_CAP`) |
| Dividend rate | CEO sets 0 to 25% of after-tax income; a change is allowed once per 24 hours; suspended during an IMF restructuring | `src/lib/constants/corporationsClient.ts` (`MAX_DIVIDEND_RATE`), `src/app/api/corporations/[id]/dividends/route.ts` (`DIVIDEND_COOLDOWN_MS`) |
| Hostile takeover | at 75% ownership, minority paid 125% of market price | `src/lib/corporations/corporateOwnershipConstants.ts` (`HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT`, `HOSTILE_TAKEOVER_PREMIUM_RATE`) |

### Order flow and sentiment

- **Order flow** (`computeOrderFlowMultiplier`, `src/lib/corporations/orderFlowEngine.ts`): `carry = (prev - 1) x 0.8`; `netPressure = (windowBuy - windowSell) / (publicFloat x sharePrice)`, windows floored at 0; `liquidityFactor = 1 / (1 + sqrt(publicFloat / totalShares))`; `multiplier = 1 + clamp(carry + netPressure x liquidityFactor, -0.15, +0.15)`.
- **Event sentiment** (`computeSentimentMultiplier`, `src/lib/corporations/sentimentEngine.ts`): each pulse contributes `initialImpact x decayRate^intervals` (intervals are 15-minute steps since the pulse was created); pulses under 0.001 are skipped; the sum is clamped to plus or minus 0.25.
- **HQ-state confidence** (`getHqConfidenceSentiment`): `1 + clamp((investorConfidence - 60) x 0.003, -0.12, +0.12)`, with confidence read from `macroMetrics` `economic.investorConfidence.value` for the corporation's headquarters state; neutral 1.0 when unknown.
- **Execution price** (`resolveShareExecutionPrice`, `src/lib/corporations/marketExecution.ts`): trades use the live price clamped into [fundamental / 5, fundamental x 5], and fall back to the fundamental when the float is under 5%.

### Market boost (code-set ramp)

A turn-ramped lift to sector revenue and valuation sits in the same code: revenue x1.2 (financial sectors a further x1.1) ramping over 192 turns from turn 1213, sector NPV x1.3 and bank NPV x1.5 ramping over 192 turns from turn 1253 (`STOCK_BOOST_*`, `src/lib/constants/corporations.ts`; ramp maths in `src/lib/corporations/rules/marketBoost.ts`). It reaches the share price through sector NPV, bank NPV and the financial risk premium above.

### Routes

- **Market hub**, `/market`, all listed corporations worldwide, with an optional exchange filter (`/market?exchange=<code>`) and tab (`/market?tab=...`).
- **Legacy URLs**, `/stockmarket/[country]` and `/country/[code]/stockmarket` redirect to the market hub with the matching exchange filter (`src/lib/market/legacyStockMarketRedirect.ts`); there is no longer a separate `/stockmarket/global` page.

Active exchanges are config-driven from each country's `exchangeName` (`src/lib/constants/countryClientConfig.ts`, read through `src/lib/constants/exchangeRegistry.ts`): every country with an `exchangeName` set gets a registered venue automatically, no per-exchange wiring needed. Examples are NYSE (US), FTSE (UK), DAX (DE) and Nikkei (JP). Command-economy worlds register a `stateRegister` venue (for example GOSPLAN) instead of a tradable bourse. The exact count depends on which countries are configured, so this page does not fix a number.

### Tabs (URL `tab=`)

Tab order (`src/lib/market/hubTabs.ts`): **Overview** (`overview`, the default for an unknown value), **Stocks** (`stocks`), **Bonds** (`bonds`), **Funds** (`funds`), **Sub. Groups** (`sub-groups`), **Wealth list** (`wealth`), **Sectors for sale** (`sectors`), **Commodities** (`commodities`), **Supply deals** (`supply`), **Currencies** (`currencies`). Legacy `?tab=listings` is accepted and treated as **Stocks**. The active tab persists in the query string so browser back/forward and shared links work.

The Stocks tab shows **market cap**, **share price**, revenue and income snapshots, CEO pointers, **sector type** and **headquarters** location. Price history is shown as OHLC candlestick charts (open, high, low, close per period). The Bonds table splits into Corporate and Sovereign; sovereign bonds show the issuing country's flag.

## Data

| Collection | Fields | Access | Player-visible |
| --- | --- | --- | --- |
| `corporations` | Read: `totalShares`, `shareholders` (`fundId`, `passiveIndexEligible`), `publicFloat`, `isPrivate`, `type`, `countryId`, `headquartersState`, `lastShareStructureTurn`, `imfBailoutActive`, `orderFlowWindowBuyValue`, `orderFlowWindowSellValue`, `liquidCapital`. Written: `sharePrice`, `fundamentalSharePrice`, `orderFlowMultiplier`, `orderFlowWindowBuyValue` and `orderFlowWindowSellValue` (reset to 0 each pass), `updatedAt` | Read and write | `sharePrice`, market cap and float yes; the multipliers are internal |
| `corporationHistory` | Read: `sectorNPV`, `incomePreDividends`, `perTurnBondCouponIncome`, `perTurnBondDragOnNetIncome`, `sharePrice` of the prior 3 turns. Written at turn time: `sharePrice` (raw formula price, no sentiment), `marketCap`, `liquidCapital` | Read and write | Yes, as price history and candlesticks |
| `corporateSectors` | Revenue, growth rate, construction in progress, operating sector keys | Read | Yes |
| `sentimentPulses` | `scope`, `countryId`, `sectorType`, `corpId`, `hqRelation`, `initialImpact`, `decayRate`, `createdAt` | Read | No |
| `macroMetrics` | `economic.investorConfidence.value` per state | Read | Partly, as a state metric |
| `gameState` | `lastMarketTickAt` (written), `currentTurn`, `isActive`, `isProcessing`, `currentYear` (read) | Read and write | No |
| `stockExchangeSnapshots` | Pre-computed exchange listings, rebuilt each turn and each tick | Written | Yes (the hub reads it) |
| `marketCapTicks` | 15-minute market cap point per exchange | Written by snapshot rebuild | Yes (market cap chart) |

## Configuration

- **No `gameConfig` field changes the share-price formula.** Every weight, cap and cooldown is a code constant (see Rules).
- **`gameConfig.marketSystemMode`** (`_id: "default"`, default `off`, resolved by `src/lib/market/featureFlag.ts`): at `plants` and above the growth input is the trailing annualized growth of sector NPV (`annualizedTrailingGrowthRate`, 3-turn window) instead of the revenue-weighted sector growth rate.
- **Prime rate input:** the smoothed prime rate per country (`primeRateSmoothedByCountry`), falling back to spot and then to the country's `centralBank.defaultPrimeRate`, then to 5% for an unrecognized country (`FALLBACK_PRIME_RATE_PERCENT`).
- **Exchanges:** each country's `exchangeName` in `src/lib/constants/countryClientConfig.ts` creates a venue; `kind: "stateRegister"` in `src/lib/constants/exchangeRegistry.ts` marks command-economy registers.
- **`corporations.imfBailoutActive`** is per corporation and set by the IMF corporate bailout flow; while true the 0.85 multiplier applies.
- **Market boost ramp** turns are code constants (see Market boost); they are not per-world settings.

## Timing

- **Hourly turn:** the `recomputeSharePrices` phase (`src/lib/turn/corporation/recomputeSharePrices.ts`, registered in `src/simulation/phases/turnPhaseRegistry.ts`) re-runs the fundamental after `bondTurn` has settled coupons and maturities, so bond cash flows reach the price in the same turn. It overwrites the placeholder price written earlier by the corporation turn. `bankSolvencyTurn` runs after it so bank marking reads fresh prices.
- **Quarter-hour market tick:** `MARKET_TICK_SCHEDULE = "15,45 * * * *"` (`src/lib/cron.ts`) re-prices between turns and applies the sentiment and order-flow multipliers. The turn (:00) and the half-hour tick (:30) include the same work, so prices refresh every 15 minutes. The tick is skipped when the game is inactive or a turn is in progress.
- **Split smoothing:** counted as `currentTurn - lastShareStructureTurn`, so the blend applies on turns 0, 1 and 2 after a split.

Order of writes in one hourly turn: `corporationHistory` row (placeholder price) written by the corporation phase, then `bondTurn`, then `recomputeTurnSharePrices` (fundamental recompute, then `applyPriceMultipliers`), then `bankSolvencyTurn`. The turn writes raw formula price to `corporationHistory` and the multiplied price to `corporations.sharePrice`. Between turns, `runMarketTick` (`src/lib/turn/subhour/marketTick.ts`) reprices only the live corporation price against the last completed turn's history row, then applies multipliers and rebuilds `stockExchangeSnapshots`.

## Worked trace

Inputs for one manufacturing corporation (hypothetical round numbers, all in anchor currency): 1,000,000 shares; liquid capital 1,000,000; sector NPV 1,500,000; bond holdings 200,000; issued bond debt 100,000; no bank, no tech assets, no construction; normalized earnings 400,000 a year of which 100,000 is net bond coupon income; sector growth 0.04; smoothed prime rate 6% plus manufacturing premium 0.04; 2 subsidiaries; CEO holds 70%; index funds hold 20%; previous price 3.80; public float 30%.

1. Tangible book: `1,000,000 + 1,500,000 + 0.75 x 200,000 - 100,000 = 2,550,000`. Per share 2.55.
2. Earnings split: bond portion 100,000, operating 300,000. Risk-adjusted earnings `300,000 + 0.75 x 100,000 = 375,000`. Reliance `100,000 / 400,000 = 0.25`, under the 0.75 threshold, so the penalty is 1.0.
3. Cost of capital: `0.06 + 0.04 = 0.10`. Earnings power per share `375,000 / 0.10 / 1,000,000 = 3.75`.
4. Growth: `gCapped = min(0.04, 0.10 - 0.02) = 0.04`. Premium per share `375,000 x 0.04 / 0.06 / 1,000,000 = 0.25`.
5. Fundamental: `(1.0 x 2.55 + 0.5 x 3.75 + 0.15 x 0.25) x 1.0 = 2.55 + 1.875 + 0.0375 = 4.4625`. Sprawl multiplier is 1.0 (2 is under the free count of 3).
6. Insider concentration: `t = (0.70 - 0.65) / 0.35 = 0.1429`, multiplier `1 - 0.3 x 0.1429^2 = 0.9939`.
7. Index inclusion: `t = (0.20 - 0.10) / 0.25 = 0.4`, multiplier `1 + 0.08 x 0.4 = 1.032`.
8. Multiplied fundamental `4.4625 x 0.9939 x 1.032 = 4.577`.
9. Rate limiter: previous price 3.80 allows 2.47 to 5.13, so 4.577 passes. Stored `fundamentalSharePrice` is 4.58.
10. Multipliers: sentiment pulses sum to +0.04 (1.04); HQ investor confidence 70 gives `(70 - 60) x 0.003 = +0.03` (1.03); order flow with no trades and a prior multiplier of 1.05 gives `1 + 0.05 x 0.8 = 1.04`. Live price `4.58 x 1.04 x 1.03 x 1.04 = 5.10234`, stored as `sharePrice` 5.10.
11. History: `corporationHistory.sharePrice` keeps 4.58 (no sentiment); `marketCap` is `round(price x 1,000,000)`.

Limiter variant: with a previous price of 3.00 the ceiling is `3.00 x 1.35 = 4.05`, so the stored fundamental would be 4.05 and the gap closes over the following turns.

Split variant: one turn after a split with prior 3.00, the blend is `0.7 x 3.00 + 0.3 x 4.577 = 3.473` with no limiter; the prior is first clamped into [4.577 / 3, 4.577 x 3] = [1.526, 13.731] and 3.00 is inside.

Original worked example kept: a corporation with 1,000,000 shares, tangible book 2,500,000, risk-adjusted earnings 400,000 a year, cost of capital 0.10 and sector growth 0.04 has tangible book per share 2.50, earnings power 4.00 and growth premium `400,000 x 0.04 / 0.06 / 1,000,000 = 0.2667`, giving a fundamental of `2.50 + 0.5 x 4.00 + 0.15 x 0.2667 = 4.54`. With a previous price of 3.00 the limiter caps the new price at 4.05.

## Edge cases and limits

- **Zero or negative equity:** tangible book is floored at 0 before dividing by shares. When issued bond debt approaches total assets, equity flips through zero and the raw fundamental can swing sharply; the 35% limiter exists to bound that to a few turns of convergence.
- **Penny stocks:** the rate limiter is off while the previous price is 1.00 or lower, so a recovering corporation is not pinned near the floor. The absolute floor is 0.01.
- **Zero shares or non-positive cost of capital:** the earnings and growth components return 0 rather than dividing by zero.
- **Growth premium:** zero when the capped growth rate is not positive; growth is a trailing estimate of sector NPV growth (`annualizedTrailingGrowthRate`), not the CEO growth slider, and returns 0 with missing history.
- **Insider discount:** applies only to public corporations with a character CEO. Private corporations, NPC-run corporations and national corporations are exempt, as are private corporations from the index premium.
- **Bond income:** a net debtor (interest paid at least equal to coupons received) has no bond reliance and no penalty.
- **IMF bailout:** the 0.85 multiplier applies after the clamp and only to the corporation's own restructuring, not to any country's sovereign IMF facility.
- **Splits:** open share orders are cancelled and refunded when a split happens, and the 48-turn cooldown blocks a second structure change.
- **Command economies:** `stateRegister` venues list enterprises rather than trade shares.
- **Order flow floor:** a float under 5% of shares disables the order-flow multiplier and trades execute at the fundamental price.
- **Unknown country:** a corporation with an unrecognized country is repriced with a 5% prime rate instead of aborting the phase.
- **No same-turn history row:** the corporation is skipped and keeps the placeholder price.

## Invariants

- **Price floor:** every stored fundamental is at least 0.01 (`MIN_SHARE_PRICE`), enforced in `computeSharePrices`.
- **No per-turn move beyond 35%** outside the split cooldown and when the previous price is above 1.00: enforced by `rateLimitPrice`, tested in `src/lib/corporations/sharePriceFormula.test.ts`.
- **Multipliers bounded:** sentiment plus or minus 0.25, HQ confidence plus or minus 0.12, order flow plus or minus 0.15; each clamped in its engine and tested in `sentimentEngine.test.ts` and `orderFlowEngine.test.ts`.
- **Tick never rewrites history:** intra-hour ticks do not write `corporationHistory` and use a compare-and-set on `fundamentalSharePrice`; tested in `recomputeSharePrices.test.ts`.
- **A concurrent writer wins:** both the tick and `applyPriceMultipliers` filter on the fundamental they read, so a split or issuance write is never clobbered; tested.
- **Execution band:** trades price within 5x of the fundamental (`isWithinShareExecutionBand`, `marketExecution.test.ts`).
- **Cost of capital positive:** not enforced upstream; the formula returns 0 for the earnings and growth parts if it is not.

## Failure and recovery

- **Stale placeholder price:** if a corporation's turn snapshot is missing, the recompute skips it and the placeholder from the corporation phase stands until the next turn.
- **Price knife-edge:** when bond debt nears assets, tangible book flips through zero and the raw fundamental can jump. The 35% limiter bounds this and the price converges over turns with no repair needed.
- **Manipulated live price near a split:** the split anchor clamp keeps a poisoned previous price from dominating the blend. If a price is wrong after a structure change, a repair sets `fundamentalSharePrice` and `sharePrice` and the next turn recomputes from fundamentals.
- **Tick skipped:** while a turn is processing, or the world is inactive, the market tick returns without writing; the next tick or turn restores fresh prices.
- **Snapshot lag:** if `stockExchangeSnapshots` is stale, the hub shows older listings until the next rebuild, which runs every turn and tick.

## Connections

**Driven by:**

- [Corporations](./corporations.md): liquid capital, sector NPV, earnings and share counts feed `computeSharePrices` through `recomputeSharePrices.ts`.
- [Sovereign Bonds](./sovereign-bonds.md) and corporate bonds: bond holdings and coupons enter tangible book and earnings (`bondTurn` runs before the recompute).
- [IMF Corporate Bailout](./imf-corporate-bailout.md): sets `imfBailoutActive`, which applies the 0.85 multiplier.
- [Subsidiary Corporations](./subsidiary-corporations.md): the formalised subsidiary count drives the sprawl discount.
- Interest rates (prime rate in `costOfCapital`) and event sentiment pulses (`sentimentEngine.ts`).

**Affects:**

- Shareholder wealth, dividends and takeover cost (market cap is price times shares).
- [Commodities](./commodities.md) and [Currency Exchange](./currency-exchange.md) panels share the hub but do not feed the share price.
- [National Budget & Treasury](./national-budget.md): sovereign bond listings link to national finance.
- Discord charts: `GET /api/discord-bot/stock-chart` returns corporation price history chart data, market-wide by default with optional corporation and country filters, from `corporationHistory` rows written at turn time (`src/app/api/discord-bot/stock-chart/route.ts`).

Related pages:

- [Corporations](./corporations.md), Founding, sectors, shares, CEO, corporate bonds
- [Commodities](./commodities.md), Supply, demand, and pricing
- [Sovereign Bonds](./sovereign-bonds.md), Government debt listings
- [National Budget & Treasury](./national-budget.md), Treasury context
- [Currency Exchange & Multi-Currency System](./currency-exchange.md), Forex

## Tests

- `src/lib/corporations/sharePriceFormula.test.ts`: bond reliance on net income, split-anchor clamp, trailing growth, sprawl discount, rate limiter in post-multiplier space, concentration multiplier.
- `src/lib/turn/corporation/sharePriceFormula.test.ts` (formula shape, bond reliance penalty, rate limiter) and `src/lib/turn/corporation/recomputeSharePrices.test.ts`: recompute after bondTurn, split cooldown prior, plants growth input, intra-hour tick with compare-and-set, history left raw.
- `src/lib/corporations/applyPriceMultipliers.test.ts`, `sentimentEngine.test.ts`, `orderFlowEngine.test.ts`, `orderFlowWashGuard.test.ts`, `indexOwnership.test.ts`, `marketExecution.test.ts`, `shareConsolidation.test.ts`.
- `src/lib/turn/subhour/marketTick.test.ts`, `src/lib/cron.test.ts`, `src/lib/turn/stockExchangeSnapshot.test.ts`.
- `src/lib/market/hubTabs.test.ts`, `src/lib/market/legacyStockMarketRedirect.test.ts`, `src/lib/corporations/rules/marketBoost.test.ts`.
- Gaps: no end-to-end test of the full chain from formula through sentiment and HQ confidence to the stored live price, and no test of the Discord stock-chart route output.

## Known issues and history

- The formula replaced an earlier 12-iteration cross-holdings convergence loop; cross-corporation holdings now enter through equity-method earnings (code comment).
- A 2026-08-15 misfire priced a leveraged operator as a bond fund; reliance is now measured on net coupon income (code comment, tested).
- A 2026-08-20 incident let a manipulated live price flow into the split blend; the anchor clamp (`STOCK_SPLIT_PREV_ANCHOR_MAX_RATIO`) was added (code comment, tested).
- The concentration and index multipliers were moved inside the rate limiter's price space after a corporation decayed each turn toward the 1.00 limiter floor (code comment).
- The sector risk premium for financial, energy and extraction was trimmed from 0.07 to 0.06 (code comment).
- Market boost values are marked as judgment-call magnitudes in code and have not been re-tuned since.

Last checked: 2026-10-29, version 1.18.0
