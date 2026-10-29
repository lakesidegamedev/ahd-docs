# Stock Market

Each country has a **stock exchange** hub listing corporations, bonds, commodities, wealth rankings, and market statistics.

## Routes

- **Market hub**, `/market`, all listed corporations worldwide, with an optional exchange filter (`/market?exchange=<code>`) and tab (`/market?tab=...`).
- **Legacy URLs**, `/stockmarket/[country]` and `/country/[code]/stockmarket` redirect to the market hub with the matching exchange filter (`src/lib/market/legacyStockMarketRedirect.ts`); there is no longer a separate `/stockmarket/global` page.

Active exchanges are config-driven from `COUNTRY_CONFIGS.exchangeName` (`src/lib/constants/countries.ts`, exposed via `src/lib/constants/exchangeRegistry.ts`): every country with an `exchangeName` set gets a registered venue automatically, no per-exchange wiring needed. 21 exchanges are configured as of this writing, including NYSE (US), FTSE (UK), DAX (DE), and Nikkei (JP).

## Tabs (URL `tab=`)

Tab order: **Stocks** (`stocks`), **Bonds** (`bonds`), **Commodities** (`commodities`), **Forex** (`forex`), **Wealth List** (`wealth`), **Stats** (`stats`). Legacy `?tab=listings` is accepted and treated as **Stocks**. The active tab persists in the query string so browser back/forward and shared links work correctly.

Pages typically include **market cap**, **share price**, revenue and income snapshots, CEO pointers, **sector type**, and **headquarters** location. Stock price history is displayed as **OHLC candlestick charts** showing open, high, low, and close prices per period with high data density. A **Corporate / Sovereign toggle** splits the bond table; sovereign bonds display the issuing country's flag as their logo.

The **Stats** tab summarizes equity by sector (from the current listing set), a **market-cap-by-sector pie**, **per-sector bar charts** driven by one global metric control (revenue, profit, market cap, share price, dividend rate, with mcap-weighted average dividend per sector when that metric is selected), **largest companies by sector** cards (linked to corporate pages; colors use `brandColor` or a deterministic fallback), historical **global** sector market-cap lines (from `marketCapHistory`), and compact bond and commodity snapshots. Listings from `GET /api/stock-exchange` include `brandColor` and `dividendRate` for those visuals.

## How it connects to other systems

- **Shares**, Buy/sell and limit orders are driven from corporate pages. Prices come from `computeSharePrices` (`src/lib/corporations/sharePriceFormula.ts`): `sharePrice = fundamentalValue × sentimentMultiplier × orderFlowMultiplier`, where sentiment and order flow are applied separately by the 15-minute price-update cron. `fundamentalValue` itself is a weighted sum of real modifier terms, not a simple blend:
  - **Tangible book per share**, liquid capital + sector NPV + construction-in-progress + tech asset value + a 0.75x-haircut value of held bonds/IMF receivables, minus issued bond debt, all divided by total shares (the liquidation floor).
  - **Earnings power per share**, risk-adjusted normalized earnings divided by cost of capital and total shares; bond-coupon income is split out and discounted 0.75x for interest-rate risk, with a graduated valuation penalty (down to a floor) for corps overly reliant on bond income.
  - **Growth premium per share**, a Gordon Growth Model terminal-value term on risk-adjusted earnings and the corp's capped sector growth rate.
  - **Insider-concentration discount**, a quadratic penalty (up to -30%) on public corps where the character CEO holds more than 65% of shares.
  - **Index-inclusion premium**, a bounded premium for corps with a broad passive (index fund) holder base; mirrors the concentration discount.
  - **Per-turn rate limiter**, caps the fundamental price move to ±35% of the previous price per turn (skipped during post-split smoothing, which has its own cooldown blend).
  - **IMF bailout multiplier**, a stored ×0.85 while `imfBailoutActive` (see [IMF Corporate Bailout](./imf-corporate-bailout.md)).
  (See [Corporations](./corporations.md) for the balance-sheet and earnings context behind these inputs.)
- **Bonds**, Corporate bonds link to issuer credit; sovereign bonds link to national finance ([Sovereign Bonds](./sovereign-bonds.md), [National Budget & Treasury](./national-budget.md)).
- **Commodities**, Summary and deep links into `/commodity/[type]` ([Commodities](./commodities.md)).
- **Forex**, Exchange-rate table and order-book summary from `/api/forex/exchange`, with deep links into `/country/[code]/forex/[currency]` ([Currency Exchange & Multi-Currency System](./currency-exchange.md)).

## Discord Integration

- `GET /api/discord-bot/stock-chart`, Returns corporation price history chart data. Defaults to market-wide data with optional corporation and country filters. Pre-computed snapshots at turn time eliminate expensive on-demand aggregation.

## Related pages

- [Corporations](./corporations.md), Founding, sectors, shares, CEO, corporate bonds
- [Commodities](./commodities.md), Supply, demand, and pricing
- [Sovereign Bonds](./sovereign-bonds.md), Government debt listings
- [National Budget & Treasury](./national-budget.md), Treasury context
