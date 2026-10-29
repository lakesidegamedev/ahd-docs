# Stock Market

Each country has a **stock exchange** hub listing corporations, bonds, funds, commodities, wealth rankings and currencies. This page is the technical reference: how a share price is built, which constants shape it, and when it is recomputed.

Player guide: [Stock Market](https://www.ahousedividedgame.com/wiki/stock-market)

## Routes

- **Market hub**, `/market`, all listed corporations worldwide, with an optional exchange filter (`/market?exchange=<code>`) and tab (`/market?tab=...`).
- **Legacy URLs**, `/stockmarket/[country]` and `/country/[code]/stockmarket` redirect to the market hub with the matching exchange filter (`src/lib/market/legacyStockMarketRedirect.ts`); there is no longer a separate `/stockmarket/global` page.

Active exchanges are config-driven from each country's `exchangeName` (`src/lib/constants/countryClientConfig.ts`, read through `src/lib/constants/exchangeRegistry.ts`): every country with an `exchangeName` set gets a registered venue automatically, no per-exchange wiring needed. Examples are NYSE (US), FTSE (UK), DAX (DE) and Nikkei (JP). Command-economy worlds register a `stateRegister` venue (for example GOSPLAN) instead of a tradable bourse. The exact count depends on which countries are configured, so this page does not fix a number.

## Tabs (URL `tab=`)

Tab order (`src/lib/market/hubTabs.ts`): **Overview** (`overview`, the default for an unknown value), **Stocks** (`stocks`), **Bonds** (`bonds`), **Funds** (`funds`), **Sub. Groups** (`sub-groups`), **Wealth list** (`wealth`), **Sectors for sale** (`sectors`), **Commodities** (`commodities`), **Supply deals** (`supply`), **Currencies** (`currencies`). Legacy `?tab=listings` is accepted and treated as **Stocks**. The active tab persists in the query string so browser back/forward and shared links work.

The Stocks tab shows **market cap**, **share price**, revenue and income snapshots, CEO pointers, **sector type** and **headquarters** location. Price history is shown as OHLC candlestick charts (open, high, low, close per period). The Bonds table splits into Corporate and Sovereign; sovereign bonds show the issuing country's flag.

## Rules

### Share price formula

`computeSharePrices` (`src/lib/corporations/sharePriceFormula.ts`) produces the **fundamental value** for each corporation. The full displayed price is `fundamentalValue x sentimentMultiplier x orderFlowMultiplier`, where the two multipliers are applied separately by the quarter-hour market tick (see Timing).

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
| Cost of capital | prime rate + sector risk premium (for example financial 0.06, technology 0.06, agriculture 0.03) | `src/lib/constants/corporations.ts` (`SECTOR_RISK_PREMIUM`) |

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

### Worked example

A corporation has 1,000,000 shares, tangible book of 2,500,000, risk-adjusted earnings of 400,000 a year, cost of capital 0.10 and sector growth 0.04. Tangible book per share is 2.50. Earnings power per share is 400,000 / 0.10 / 1,000,000 = 4.00. With g = 0.04, growth premium per share is 400,000 x 0.04 / 0.06 / 1,000,000 = 0.2667. The fundamental is 2.50 + 0.5 x 4.00 + 0.15 x 0.2667 = 4.54. If the previous price was 3.00, the rate limiter caps the new price at 3.00 x 1.35 = 4.05, and it closes the rest of the gap over the following turns.

## Timing

- **Hourly turn:** the `recomputeSharePrices` phase (`src/lib/turn/corporation/recomputeSharePrices.ts`, registered in `src/simulation/phases/turnPhaseRegistry.ts`) re-runs the fundamental after `bondTurn` has settled coupons and maturities, so bond cash flows reach the price in the same turn. It overwrites the placeholder price written earlier by the corporation turn. `bankSolvencyTurn` runs after it so bank marking reads fresh prices.
- **Quarter-hour market tick:** `MARKET_TICK_SCHEDULE = "15,45 * * * *"` (`src/lib/cron.ts`) re-prices between turns and applies the sentiment and order-flow multipliers. The turn (:00) and the half-hour tick (:30) include the same work, so prices refresh every 15 minutes. The tick is skipped when the game is inactive or a turn is in progress.
- **Split smoothing:** counted as `currentTurn - lastShareStructureTurn`, so the blend applies on turns 0, 1 and 2 after a split.

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
- Discord charts: `GET /api/discord-bot/stock-chart` returns corporation price history chart data, market-wide by default with optional corporation and country filters, from snapshots computed at turn time.

## Related pages

- [Corporations](./corporations.md), Founding, sectors, shares, CEO, corporate bonds
- [Commodities](./commodities.md), Supply, demand, and pricing
- [Sovereign Bonds](./sovereign-bonds.md), Government debt listings
- [National Budget & Treasury](./national-budget.md), Treasury context
- [Currency Exchange & Multi-Currency System](./currency-exchange.md), Forex

Last checked: 2026-10-29, version 1.18.0
