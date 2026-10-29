# Currency Exchange & Multi-Currency System

> **Document status, 2026-08-21:** The overview, exchange-rate model, fee routing, and canonical storage rule describe the shipped system. The later schema proposals and migration sequence are retained as implementation history, not as a current rollout checklist. For current fields and execution paths, use `src/lib/db/types/character.ts`, `src/lib/db/types/centralBank.ts`, `src/lib/currency/`, and `src/lib/turn/forexTurn.ts`.

## Summary

Player guide: [Currency Exchange](https://www.ahousedividedgame.com/wiki/currency-exchange)

A dynamic foreign exchange system where each active country uses its native currency, exchange rates float based on macroeconomic conditions and player trading activity, and players can speculate on currency markets.

- **Storage**: Entity money is stored in the entity's native currency. Cross-country aggregation and display convert values to the anchor unit (₳) when needed.
- **Per-country currencies**: Each country's currency floats independently against the internal unit. Rates are driven by each country's own economic indicators, not relative to each other.
- **Player-facing**: Players see and interact exclusively in real currencies. Fund generation, income, and spending all display in the appropriate currency.
- **Speculation**: Players can trade currencies for profit. Buy cheap yen, buy JP stocks, sell when yen strengthens, convert back to home currency.
- **No action cost**: Forex trades do not consume player action points. The spread fees provide sufficient friction, players shouldn't have to choose between political actions and financial management.

## Rules

### Why Not USD-Canonical?

An earlier design considered storing everything in USD and converting at display time. The problem: if US players tank their economy through bad fiscal policy, every other country's internal values shift because the yardstick itself moved. A UK player's fund generation hasn't changed, but their displayed pound amount fluctuates because the USD anchor weakened.

The abstract internal unit solves this, each currency floats independently. US inflation spikes only affect the USD rate; other currencies are unaffected unless their own economies deteriorate.

### Country scope

`CurrencyCode` (`src/lib/constants/currencyCodes.ts`) defines 29 currency codes. Of these, `FOREX_ACTIVE_CURRENCIES` (same file) lists 28 as active in the forex system: USD, GBP, JPY, EUR, IEP, CNY, BRL, NGN, SUR, RUB, DDM, FRF, ITL, ESP, SEK, TRL, GRD, ATS, FIM, PLZ, HUF, ROL, BGL, CSK, YUD, PLN, RON, BGN. The only code not active in forex is `CAD`, reserved for a country not yet playable. `FOREX_ACTIVE_COUNTRIES` (same file) lists 18 countries that own an `exchangeRates` row in any preset; which of them are processed in a given world comes from `getPresetMonetaryScope(preset).forexCountries` (`src/lib/monetaryPolicy/presetMonetaryScope.ts`). Several countries can share one currency (UK, Scotland and Wales share GBP, with UK as the anchor; `CURRENCY_ANCHOR_COUNTRY` in `src/lib/constants/currencyCodes.ts`).

### Internal unit calibration

All existing monetary values in the database are reinterpreted as internal units. Initial exchange rates (`INITIAL_RATES`, `src/lib/constants/currencies.ts`) are set so that existing values map cleanly:

| Country | Currency | Initial rate | Meaning                 |
| ------- | -------- | ------------ | ----------------------- |
| US      | USD      | 1.0          | 1 internal unit = $1.00 |
| UK      | GBP      | 0.75         | 1 internal unit = £0.75 |
| JP      | JPY      | 106.0        | 1 internal unit = ¥106  |
| DE      | EUR      | 0.92         | 1 internal unit = €0.92 |

Other modern defaults in the same table: IE 0.92, BR 5.0, CN 7.2, NG 1550. Historical presets use their own tables (`INITIAL_RATES_1953`, `_1979`, `_1991`, `_2019_TRANSITION`, `_2027`), chosen by `getInitialRates(preset)`; start years with no authored table interpolate geometrically between the authored anchors (`getInitialRatesForYear`).

Cross-country rates are derived: `USD/JPY = jpyRate / usdRate`. No separate storage needed for currency pairs. A cross rate is `toRate / fromRate` (units of `to` per 1 unit of `from`; `getCrossRate`, `src/lib/currency/marketMaker.ts`).

### Rate update formula (per turn)

Rates update each turn through macro drift, player volume, a 12-turn directional regime, and random noise. `computeRateUpdate()` (`src/lib/currency/rateCalculation.ts`) runs them in this order: macro target, drift, volume pressure, cycle pressure, noise, then the guardrail clamp.

#### 1. Macro fundamental drift

Each country's rate moves toward a target derived from macroeconomic data, measured against fixed baselines (not relative to another country).

**Data sources per country** (`extractMacroInputs`, `src/lib/turn/forexTurn.ts`; each falls back to 0 and rejects NaN):

- `primeRate`: `CentralBank.primeRate` (scalar field, updated by chair actions)
- `inflationRate`: `CentralBank.inflationHistory.at(-1)?.rate` (latest snapshot; no separate scalar to avoid dual source-of-truth)
- `gdpGrowth`: `CentralBank.gdpGrowthHistory.at(-1)?.rate` (latest snapshot, same reason)
- `tradeGrowth`: `CentralBank.tradeGrowth` (mirrored from `FederalBudget.economicFactors.tradeGrowth` each turn by `mirrorTradeGrowth`, `src/lib/turn/tradeGrowthMirror.ts`, before the forex phase runs)

The forex phase reads only from `centralBanks`, the budget mirror keeps it to one collection read per country.

```
excessInflation = max(0, inflationRate - ABSOLUTE_INFLATION_DEPRECIATION_THRESHOLD)
absoluteInflationPenalty = excessInflation x ABSOLUTE_INFLATION_SENSITIVITY

macroTarget = baseRate x max(0.01, 1
  - (primeRate - neutralPrimeRate) x PRIME_RATE_SENSITIVITY        // higher rates: stronger currency (lower rate value)
  + (inflationRate - targetInflation) x INFLATION_SENSITIVITY       // higher inflation: weaker currency
  + absoluteInflationPenalty                                        // baseline-independent weakening
  - (gdpGrowth - baselineGDP) x GDP_GROWTH_SENSITIVITY              // higher growth: stronger currency
  - (tradeGrowth - baselineTrade) x TRADE_GROWTH_SENSITIVITY        // trade surplus: stronger currency
)
```

Sensitivities: `PRIME_RATE_SENSITIVITY = 0.02`, `INFLATION_SENSITIVITY = 0.015`, `GDP_GROWTH_SENSITIVITY = 0.01`, `TRADE_GROWTH_SENSITIVITY = 0.005`, `ABSOLUTE_INFLATION_DEPRECIATION_THRESHOLD = 6.0` percentage points, `ABSOLUTE_INFLATION_SENSITIVITY = 0.015` per excess point (all `src/lib/constants/currencies.ts`).

Rate is "local currency per internal unit," so a lower rate means a stronger currency. Each sensitivity term above is signed so that the described real-world effect (higher rates/growth/trade surplus: stronger currency) comes out of the subtraction, not the addition.

The absolute inflation penalty closed a carry-trade exploit: currencies with no full economic baseline (or a high one) previously acted as a fixed peg that never depreciated no matter how high inflation ran, making them a free real-yield carry vehicle. For a currency with no `ECONOMIC_BASELINES` row the target is `baseRate x max(0.01, 1 + absoluteInflationPenalty)`.

The rate drifts toward the macro target rather than snapping to it:

```
newRate = currentRate + (macroTarget - currentRate) x DRIFT_SPEED
```

At `DRIFT_SPEED = 0.05`, a rate shock takes roughly one full game year (48 turns, `TURNS_PER_YEAR` in `src/lib/constants/calendar.ts`) to converge 90%. This creates multi-month currency trends that give players time to notice, build positions, and exit, matching real-world forex pacing.

#### 2. Player volume pressure

Net buy/sell volume from the past 24 turns creates a short-term offset:

```
netVolume = buyVolume24 - sellVolume24   // Sum of internal-unit values of trades, past 24 turns
organic = VOLUME_PRESSURE_CAP x netVolume / (|netVolume| + ORGANIC_VOLUME_HALF_PRESSURE_ANCHOR) x breadthFactor
intervention = clamp(syntheticNet x VOLUME_PRESSURE_SENSITIVITY, +/-VOLUME_PRESSURE_CAP)   // central-bank intervention
volumePressure = clamp(organic x ORGANIC_VOLUME_DIRECTION_WEIGHT + intervention x VOLUME_DIRECTION_WEIGHT,
                       +/-VOLUME_PRESSURE_CAP x VOLUME_DIRECTION_WEIGHT)

finalRate = newRate x (1 - volumePressure)
```

Source: `src/lib/currency/rateCalculation.ts` and `src/lib/constants/currencies.ts`.

Positive volume pressure (net buying) lowers the rate, since buying a currency strengthens it.

Volume pressure is calculated from the total internal-unit value of trades in the lookback (`VOLUME_LOOKBACK_TURNS = 24`; computed in `computeCurrencyVolumes`, `src/lib/currency/volumeTracker.ts`). There is no per-trade cap. A single whale is held back by the saturating curve and the breadth factor instead.

Traded flow (organic) is weighted by `ORGANIC_VOLUME_DIRECTION_WEIGHT = 0.05`. Its pressure saturates smoothly: net traded volume of `ORGANIC_VOLUME_HALF_PRESSURE_ANCHOR` (₳1,000,000,000) produces half of the cap, so everyday conversions barely register. `breadthFactor = min(1, max(1/ORGANIC_FULL_BREADTH_TRADERS, effectiveTraders / ORGANIC_FULL_BREADTH_TRADERS))` scales it by the number of effective traders behind the flow: one holder alone earns 1/5 of the push, and 5 or more traders earn the full push (`ORGANIC_FULL_BREADTH_TRADERS = 5`). Effective traders is the inverse Herfindahl index of each trader's net contribution in the net direction (`effectiveTraderCount`, `volumeTracker.ts`). Central-bank intervention keeps the original channel, with `VOLUME_PRESSURE_SENSITIVITY = 0.0001` per internal unit and `VOLUME_DIRECTION_WEIGHT = 0.2`, so it still beats organic flow.

The per-component pressure is capped at +/-5% (`VOLUME_PRESSURE_CAP = 0.05`), and the combined pressure is clamped to the cap times `VOLUME_DIRECTION_WEIGHT` (+/-1%), so intervention alone sets the ceiling. The constants are tunable and can be loosened as the player base and trade volume grow.

Heavy yen buying pushes the yen rate below fundamentals temporarily (the yen strengthens more than the macro picture alone would justify). As volume normalizes, macro drift pulls it back, a classic overshoot/correction cycle that rewards well-timed speculation.

**Volume normalisation.** Each trade in the lookback adds `internalValue = trade.amount / rate(fromCurrency)` to the `from` currency's sell bucket and the `to` currency's buy bucket. Trades whose `from` and `to` resolve to the same currency (euro members) are skipped. Both legs get the same internal value so `netVolume` is a real directional signal.

#### 3. Random noise

Small per-turn jitter (up to +/-0.4%, `RATE_NOISE_MAX = 0.004`, uniform) prevents perfectly predictable rate movement: `rate x (1 + noise x volatilityMultiplier)`. The top three reserve currencies by rank (ranked by `spreadFeeReserveBalances` held across all central banks, valued in ₳; `rankReserveCurrencies`, `src/lib/centralBank/reserveCurrencyRanking.ts`) get a noise multiplier of 0.5, 0.75 and 0.875 (`RESERVE_CURRENCY_VOLATILITY_REDUCTIONS = [0.5, 0.25, 0.125]`). The home lending `reserveBalance` is deliberately excluded from the ranking.

#### 4. Directional regime pressure (cycle pressure)

Each currency holds one randomly rolled directional regime for `CYCLE_PRESSURE_TURNS = 12` turns, then rolls again (`rollCyclePressureRegime()` and `CYCLE_PRESSURE_BY_REGIME`, `src/lib/constants/currencies.ts`; applied by `applyCyclePressure()` in `src/lib/currency/rateCalculation.ts`). The five regimes are equally likely:

| Regime | Pressure per turn | Effect on the rate |
| ------ | ----------------- | ------------------ |
| moderate_strengthen | +0.0015 | rate x (1 - 0.0015) |
| slight_strengthen | +0.0007 | rate x (1 - 0.0007) |
| neutral | 0 | none |
| slight_weaken | -0.0007 | rate x (1 + 0.0007) |
| moderate_weaken | -0.0015 | rate x (1 + 0.0015) |

A sustained regime settles only about `pressure / DRIFT_SPEED` off the macro target (roughly 3% for moderate, 1.4% for slight), so strong fundamentals pulling the other way usually win. Pegged currencies and euro followers skip the regime entirely (pressure 0).

#### 5. Guardrail clamp

`clampRate(rate, baseRate, band)`: the rate is clamped to `[baseRate x (1 - band), baseRate x (1 + band)]`. Default `band = 1 - RATE_FLOOR_MULTIPLIER = 0.5` (`RATE_FLOOR_MULTIPLIER = 0.5`, `RATE_CEILING_MULTIPLIER = 1.5`). At the clamp, trades still execute but the rate cannot move further in that direction. There is no extra dampening of pressure at the clamp; the rate is simply held.

### Baseline economic values (fixed)

Each country has baseline values representing a "neutral" economic state. These anchor the rate math so no country is structurally advantaged:

| Country | Baseline prime | Baseline inflation | Baseline GDP growth | Baseline trade growth |
| ------- | -------------- | ------------------ | ------------------- | --------------------- |
| US      | 3.0%           | 2.0%               | 2.5%                | 0% (neutral)          |
| UK      | 3.0%           | 2.0%               | 1.5%                | 0% (neutral)          |
| JP      | 1.0%           | 1.0%               | 1.0%                | 0% (neutral)          |
| DE      | 3.0%           | 2.0%               | 1.5%                | 0% (neutral)          |
| IE      | 3.0%           | 2.0%               | 3.5%                | 2.5%                  |
| CN      | 4.0%           | 2.0%               | 5.0%                | 4.0%                  |
| BR      | 8.0%           | 4.0%               | 2.5%                | 2.0%                  |
| NG      | 12.0%          | 6.0%               | 3.0%                | 2.5%                  |

Prime rate and inflation baselines come from `MONETARY_BASELINES`; GDP and trade growth baselines come from `ECONOMIC_BASELINES` (both in `src/lib/constants/currencies.ts`, each row sourced from `src/lib/countries/<id>/economy.ts`). `ECONOMIC_BASELINES` has rows only for US, UK, JP, DE, IE, BR, CN and NG. A third module, `monetaryEra.ts` (`getEraMonetaryBaseline`, `src/lib/constants/monetaryEra.ts`), layers era-specific overrides on top of `MONETARY_BASELINES` for pre-1999 worlds (e.g. JP's 1953-era neutral prime rate is 5.5%, not the modern 1.0%), keyed on the current in-game year (`gameState.currentYear`) so a long-lived world graduates through eras as its clock advances. At 1999 or later, or when no year is passed, the global table applies.

Values reflect real-world historical norms. Tunable during playtesting. A currency with no full baseline still gets the absolute inflation penalty.

**Anchor asymmetry.** `baseRate` (the macro-target anchor and the guardrail centre) is the world's own seeded calibration, read from the persisted `exchangeRates.baseRate` and never re-keyed to the current year's era table. Re-keying would snap every currency's anchor and guardrail the moment a world crossed an era boundary. Era graduation flows through the monetary deviation terms instead.

### Spread fee revenue

Spread fees are split 25/25/50 (`src/lib/currency/spreadFees.ts`, `distributeSpreadFee`):

- **25% destroyed** (`SPREAD_FEE_DESTROY_RATIO`), removed from the economy. Acts as a deflationary sink that counterbalances fund generation and constrains inflation from heavy trading. It is the remainder: `destroyed = totalFee - toCentralBank`, so it absorbs rounding.
- **25% to `forexRevenue`** (`SPREAD_FEE_FOREX_REVENUE_RATIO`), the source currency's central bank intervention reserve.
- **50% to `spreadFeeReserveBalances.<currency>`** (`SPREAD_FEE_RESERVE_RATIO`), a sell-defense pool keyed by the currency that was sold. It accrues to the destination currency's central bank as a foreign reserve (the `destinationCountryId` bank), while `forexRevenue` stays with the source bank. Same-bank trades write both fields to one document.

Each slice is `Math.round(totalFee x ratio)`. Together, `forexRevenue` and currency-specific spread-fee reserves make up the central bank's 75% share (`SPREAD_FEE_CENTRAL_BANK_RATIO`). The split applies to all three trading tiers. Market-maker and peer-fill legs use `distributeSpreadFee` (with idempotency stamps in `centralBanks.settledKeys`, capped at 200); limit-order market fills in `src/lib/turn/forexLimitOrders.ts` book the reserve slice as `floor(spread x 0.5)` and forexRevenue as the rest of the central-bank share (so rounding differs slightly from the other tiers).

### Player trade fees (size and liquidity)

The flat tier spreads in the Fee Schedule are the base. A player's own conversions (market maker and limit-order market fills) pay a total of `min(FOREX_MAX_TRADE_FEE, (baseSpread + sizeFee) x liquidity)`, computed by `playerTradeFeeRate()` in `src/lib/currency/tradeFees.ts`. Conversions the game makes for the player (dividends, coupons, auto-convert shortfalls) pay the base spread only (`isPlayerTradeSource`, `src/lib/currency/traderForexVolume.ts`: only `manual`, `api`, `limit_order` and legacy rows with no source count as player trades).

| Constant | Value | Meaning |
| -------- | ----- | ------- |
| `FOREX_SIZE_FEE_MAX` | 0.2 | Extra fee rate a very large trade approaches |
| `FOREX_SIZE_FEE_HALF_ANCHOR` | 10,000,000,000 | Trader volume (₳, over the lookback) at which the size fee is half its maximum |
| `FOREX_LIQUIDITY_REFERENCE_VOLUME` | 100,000,000 | Gross ₳ in a currency over the lookback that earns a neutral 1x fee |
| `FOREX_LIQUIDITY_FEE_MIN` / `FOREX_LIQUIDITY_FEE_MAX` | 0.5 / 1.5 | Fee multiplier in a busy / quiet market |
| `FOREX_MAX_TRADE_FEE` | 0.3 | Ceiling on the total fee rate |
| `FOREX_SPREAD_STRENGTH_MIN` / `MAX` / `DEFAULT` | 0.5 / 1.5 / 1.0 | Chair multiplier on the spread when their currency is sold |
| `FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS` | 48 | Turns between chair spread-strength changes |
| `SECTOR_FX_SPREAD` | 0.005 | Spread on cross-currency corporate sector flows |

All in `src/lib/constants/currencies.ts`. The size fee is the average of a rising marginal rate `MAX x x / (x + HALF)` over the trader's new slice of volume: `sizeFee = MAX x (trade - HALF x ln(1 + trade / (prior + HALF))) / trade`, so ten trades of ₳1B cost the same as one of ₳10B. The prior volume is the trader's own `anchorAmount` total over the last 24 turns (`loadTraderRecentForexAnchor`). The liquidity multiplier is `clamp(sqrt(REFERENCE / max(recentVolume, 1)), 0.5, 1.5)` per currency, and the larger of the two currencies' multipliers is used (the quieter market sets the scale). Missing volume data is neutral (1). `recentVolume` is `buyVolume24 + sellVolume24` from the stored rate document.

The chair's spread strength scales the market-maker base: `feeRate = MARKET_MAKER_SPREAD x clampForexSpreadStrength(fromRate.forexSpreadStrength)`. Limit-order market fills use `LIMIT_ORDER_SPREAD` without spread strength.

### Fee schedule: three-tier system

| Tier | Method                      | Spread | Fill guarantee              |
| ---- | --------------------------- | ------ | --------------------------- |
| 1    | Market maker (auto-convert) | 1%     | Instant, infinite liquidity |
| 2    | Public limit order          | 0.64%  | When matched or expired     |
| 3    | Direct player request       | 0.36%  | When target player accepts  |

Constants: `MARKET_MAKER_SPREAD = 0.01`, `LIMIT_ORDER_SPREAD = 0.0064`, `DIRECT_TRADE_SPREAD = 0.0036`. Each step down rewards more player engagement. Auto-convert uses Tier 1 by default.

#### Market maker

System-provided liquidity at the current cross rate less the spread. Always available, fills instantly (`executeMarketMakerTrade`, `src/lib/currency/marketMaker.ts`, reached from `POST /api/forex/exchange`). The spread is deducted from the source amount before conversion:

```
spreadFee = round(spend x feeRate)
netAmount = spend - spreadFee
toAmount  = round(netAmount x toRate / fromRate)
```

Spend is clamped to the available balance when the request exceeds it by no more than a display tolerance (1 for JPY, 0.02 otherwise); a bigger overshoot is rejected. The debit uses a `$gte` filter on the balance so two racing requests cannot overspend. Rate documents that are non-finite or non-positive are rejected before any balance is touched.

Player trades against the market maker still exert volume pressure on the rate, buying yen from the market maker pushes yen stronger, same as any other trade.

#### Public limit orders

Player posts an order visible to all on the exchange: "Buy 5,000,000 yen at rate 104.5 or better." The `fromCurrency` amount is escrowed (deducted) at creation. The order sits on the book until the cross rate meets the limit, at which point the turn phase fills it against the market maker at the prevailing rate. Posting needs `direction` ("buy" default or "sell"), a positive `limitRate`, and an optional `expiresInTurns` (integer, 1 to 480; no value means no expiry).

Fill test (`processTriggeredLimitOrders`, `src/lib/turn/forexLimitOrders.ts`): `crossRate = toRate / fromRate`; a buy fills when `crossRate >= limitRate`, a sell fills when `crossRate <= limitRate`. Orders are scanned oldest first. A market fill takes the whole remaining amount at the prevailing cross rate, with fee rate `playerTradeFeeRate({ baseSpread: LIMIT_ORDER_SPREAD, ... })` (so it also pays the size and liquidity fee), and ends the order as `filled`.

**Execution priority:**

1. **Manual player-to-player fills**: If another player chooses to fill an order from the exchange page (`POST /api/forex/orders/[orderId]/fill`), this takes effect immediately and does not wait for the turn.
2. **Automatic market-maker fills**: If no player fills the order, the turn phase executes it against the market maker once the limit price is met.

**Player-to-player fills:** A player viewing the exchange page can see open limit orders and fill one directly, taking the other side at the posted `limitRate` (not the market rate). The filler pays `fillAmount x limitRate` in the order's `toCurrency` plus a half-spread, and receives `fillAmount` of `fromCurrency` less the poster's half-spread. Each side pays `LIMIT_ORDER_SPREAD / 2 = 0.32%` in its own currency; total system take is 0.64%. Players cannot fill their own order. A filler may fill part of the order (`amount` in the request, capped at the remainder).

**Partial fills:** The `partial` status arises from peer fills that cover less than the full remainder: the matched portion executes and the remainder stays on the book. `status` becomes `"partial"`, `filledAmount` tracks cumulative filled volume, and `spreadCharged` accumulates the poster's spread across fills. A turn-phase market fill always takes the whole remainder.

Optional expiry: player can set a turn-based expiry ("cancel after N turns if unfilled"). Orders without expiry persist until manually cancelled. Cancelling or expiring refunds the unfilled escrow (`amount - filledAmount`) in `fromCurrency`.

#### Direct player requests

Player sends a conversion offer to a specific character: "Buy 2,000,000 yen from [CharacterName] at rate 105.0." The `fromCurrency` amount is escrowed at creation. Target receives an in-game mail notification. They can:

- **Accept**: trade executes at the proposed rate with a total spread of `DIRECT_TRADE_SPREAD = 0.36%`, split evenly (`DIRECT_TRADE_SPREAD / 2 = 0.18%` in each party's own currency). The target pays `amount x proposedRate` plus its half-spread in `toCurrency` and receives `amount` less the sender's half-spread.
- **Decline**: order cancelled, escrow refunded, initiator notified.

No counter-offers. If the target wants different terms they decline and post their own order or direct request.

Requests expire after `DIRECT_TRADE_EXPIRY_TURNS = 24` turns by default (about half a game year; the request may set `expiresInTurns`, 1 to 480). New characters cannot create or accept direct trades or post/fill limit orders for their first `NEW_CHARACTER_TRANSFER_BARRIER_TURNS = 24` turns (`src/lib/character/newCharacterTransferBarrier.ts`), because a skewed-rate trade is otherwise a disguised money transfer.

### Multi-currency wallet

#### Character financial structure

`currencyBalances` is the player-facing wallet (`src/lib/db/types/character.ts`):

```typescript
currencyBalances?: {
  campaign: number;                                  // home currency only
  personal: Partial<Record<CurrencyCode, number>>;   // missing keys = 0
  savings?: Partial<Record<CurrencyCode, number>>;   // per currency, see savings docs
  // plus savingsHolder, interestEarned, pendingSavingsInterest
}
```

The legacy `funds`, `cashOnHand` and `savingsOnHand` fields are deprecated and unset in production by the 2026-05-18 migration.

**Campaign funds are strictly home-currency.** All campaign income (fund generation, party distributions) is deposited in the player's home currency. Campaign spending always deducts from this single balance. Campaign funds never participate in forex, no foreign-currency campaign balances, no cross-currency campaign spending.

**Personal wealth is multi-currency.** Foreign income (stock dividends, bond coupons, CEO salary) deposits into the corresponding personal currency slot, or is auto-converted (see Foreign income handling). Players can hold and speculate with any active currency.

#### Spending flow

**Campaign purchases** (ads, party actions, etc.) always deduct from `currencyBalances.campaign` in the player's home currency. No forex involvement.

**Personal purchases** (stocks, bonds, foreign assets) go through `autoConvertForPurchase` (`src/lib/currency/autoConvert.ts`):

1. Check `currencyBalances.personal[requiredCurrency]`. If sufficient, spend directly, no fee.
2. If `autoConvertEnabled` is not `false`, first consolidate: other forex wallets are converted into the required currency via the market maker, in `FOREX_ACTIVE_CURRENCIES` order, up to 48 iterations, until the balance covers the cost (`topUpPersonalBalanceInCurrency`).
3. If still short, convert the shortfall from `currencyBalances.personal[homeCurrency]` at the market-maker base spread (`purchaseConversionRequired` reverses the formula: `home needed = shortfall / ((1 - 0.01 x spreadStrength) x crossRate)`, plus a rounding buffer of `max(1, ceil(1 / crossRate))` capped at the balance).
4. If the home balance is below the needed amount the purchase is rejected.

With auto-convert **on** (default), the player sees a confirmation prompt before submitting:

> "You have 2,300,000 yen. This costs 5,000,000 yen. Use your yen and convert about $25,400 (1% fee) for the remainder?"

With auto-convert **off** (`autoConvertEnabled === false`), insufficient foreign currency rejects the transaction with a message directing the player to the exchange. Campaign funds are never touched for personal purchases. All auto-convert trades are stamped `source: "auto_purchase"`, so they pay the base spread only.

#### Foreign income handling

Live behaviour: foreign dividends and bond coupons are converted automatically to the holder's home currency at the market-maker base spread when forex is enabled (trade sources `auto_dividend` and `auto_coupon`, `src/lib/db/types/tradeHistory.ts`). CEO salary is paid in the corporation's currency and deposited into the matching personal slot with no conversion. Party-related income and fund generation go to `currencyBalances.campaign`.

> **Not shipped as designed (checked 2026-10-29):** the proposal for a per-holding income preference ("receive in foreign currency" or "auto-convert") was never built. No `incomeConversionPreference` field exists in the code.

#### Player currency visibility

Other players can see which currencies a character holds without amounts: this part of the original design is not implemented. The public holders listing, `GET /api/forex/[currency]/holders` (`src/app/api/forex/[currency]/holders/route.ts`), returns the largest holders of a currency (characters, corporations and central-bank reserves) with display name and amount. See Known issues.

### Exchange page and wallet UI

- **Nav placement:** World dropdown, between Stock Market and News.
- **Page content:** player holdings at the top (campaign and personal), live rates table between active pairs, rate trend charts from `rateHistory`, order book of open public limit orders, the player's own open orders and pending direct requests, and a trade form with method selector (market, limit, direct).
- **Wallet:** a section on the character portfolio page with per-currency balances split campaign/personal and a quick-convert shortcut.
- **Display preference toggle** (`displayCurrencyPreference`): the shipped type is `"local" | "home" | "internal" | CurrencyCode`. "Local" (default) shows the asset's native currency, "home" converts to the player's home currency, "internal" shows ₳, and a specific currency code converts to that currency. A converted value is prefixed with the approximately sign to distinguish it from native prices.
- **Auto-convert toggle** (`autoConvertEnabled`): on by default, in the wallet section.
- **Notifications (in-game mail):** limit order filled, direct request received, accepted or declined, order expired.
- **Future (v2), rate alerts:** players set a watch on a currency pair and get mail when the rate crosses a threshold. Not in v1 scope, no schema pre-created. Define a `rateAlerts` collection when v2 is actively built.

## Data

### Collections

| Collection | Role | Written by | Read by players |
| ---------- | ---- | ---------- | --------------- |
| `exchangeRates` | One document per country (`_id` = CountryId), updated each turn | `processForexTurn`, `src/lib/turn/subhour/forexHalfStep.ts`, chair actions | Yes (rates, history chart, band status, spread strength via `GET /api/forex/rates`) |
| `currencyOrders` | Limit and direct orders, escrowed | `POST /api/forex/orders`, `POST /api/forex/direct`, fill/accept/cancel routes, forex turn | Own orders, public open limit book |
| `tradeHistory` | Executed trade log (volume lookback, size-fee basis, transaction history) | market maker, limit-order fill, peer fill, direct accept | Own transactions (`GET /api/forex/transactions`) |
| `centralBanks` | Macro inputs; `forexRevenue`, `spreadFeeReserveBalances`, `reserveBalance`, `settledKeys` | forex turn (reads), spread distribution (writes), intervention | Reserve holdings appear in the holders listing |
| `characters` | `currencyBalances`, `autoConvertEnabled`, `displayCurrencyPreference` | trade, escrow, refund and fill routes | Own wallet |
| `gameState` | `forexEnabled`, `preset`, `currentYear`, `euroMonetaryUnion` | admin | No |
| `gameConfig` | `commandEconomyEnabled` | admin | No |

### `exchangeRates` document

Interface `ExchangeRate` in `src/lib/db/types/exchangeRate.ts`:

```typescript
interface ExchangeRate {
  _id: string;                 // CountryId
  countryId: CountryId;
  currencyCode: CurrencyCode;
  rate: number;                // local currency per 1 internal unit
  baseRate: number;            // initial calibration (never changes)
  macroTarget: number;         // current fundamental target rate
  rateHistory: TurnSnapshot[]; // { turn, rate }, pruned to FOREX_AND_MACRO_CHART_HISTORY_TURNS
  buyVolume24: number;         // gross buy volume, internal units, recomputed each turn
  sellVolume24: number;        // gross sell volume, internal units, recomputed each turn
  hardPeg?: number | null;     // admin or command-economy peg; drift skipped while set
  cyclePressureRegime?: CurrencyCyclePressureRegime | null;
  cyclePressureUntilTurn?: number | null;
  interventionPolicy?: InterventionPolicy | null;  // chair FX band
  forexSpreadStrength?: number;                    // chair multiplier 0.5 to 1.5
  forexSpreadStrengthLastChangedTurn?: number;
  monetaryRegime?: ...;        // Bretton Woods regime
  subhourStep?: ...;           // :30 half-step stamp
  updatedAt: Date;
}
```

`FOREX_AND_MACRO_CHART_HISTORY_TURNS = TURNS_PER_YEAR x 5 = 240` turns (`src/lib/constants/turnTime.ts`). Net volume is derived at formula time: `netVolume = buyVolume24 - sellVolume24`. Storing gross values separately makes imbalances debuggable without re-querying `tradeHistory`. There are further fields for the declared exchange-rate regime (`fxRegime`, `pegTarget`, `capitalControls`) documented in the type file.

### `currencyOrders` document

Interface `CurrencyOrder` in `src/lib/db/types/currencyOrder.ts`:

```typescript
interface CurrencyOrder {
  _id: ObjectId;
  characterId: ObjectId;
  characterName: string;
  countryId: CountryId;
  type: "market" | "limit" | "direct";
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  amount: number;                       // amount of fromCurrency escrowed
  limitRate?: number;                   // limit orders: worst acceptable rate; direct: proposed rate
  direction?: "buy" | "sell";
  targetCharacterId?: ObjectId;         // direct only
  targetCharacterName?: string;         // direct only
  expiresAtTurn?: number;
  status: "open" | "processing" | "filled" | "partial" | "cancelled" | "expired";
  filledAmount: number;
  processingFillKey?: string;           // peer-fill crash-recovery intent
  processingFill?: ProcessingFillIntent;
  expiryRefundState?: "pending" | "credited";
  filledRate?: number;
  spreadCharged: number;                // cumulative across fills
  createdAt: Date;
  updatedAt: Date;
}
```

`balanceType` was removed: all forex trades operate on personal funds only. `processing` is a transient claim state used to make fills idempotent (see Failure and recovery).

### `tradeHistory` document

Interface `TradeHistoryEntry` in `src/lib/db/types/tradeHistory.ts`: `buyerCharacterId`, `sellerCharacterId` (null = market maker), `fromCurrency`, `toCurrency`, `amount` (in `fromCurrency`), `receivedAmount?`, `rate`, `spread`, `anchorAmount?` (trade size in ₳, used by the size fee), `turn`, `createdAt`, `source?` (`manual`, `direct`, `limit_order`, `auto_purchase`, `auto_dividend`, `auto_coupon`, `api`), `sourceRef?` (paying corporation or bond id for income conversions).

### Indexes

Seeded in `src/lib/admin/seed/indexes/performance.ts` and `turnHotPath.ts`: `currencyOrders_type_createdAt_status` (`{ type, createdAt, status }`), `currencyOrders_char_status_createdAt` (`{ characterId, status, createdAt: -1 }`), `currencyOrders_expiry_refund` (`{ status, expiryRefundState }`), `exchangeRates_countryId` (`src/lib/admin/seed/indexes/slowQuery.ts`). The one-time forex migration also created `tradeHistory { turn: -1 }` (`src/lib/currency/migration.ts`).

### `centralBanks` fields used by forex

```typescript
tradeGrowth: number;                                  // mirrored from FederalBudget.economicFactors.tradeGrowth each turn
forexRevenue: number;                                 // accumulated 25% share of spread fees
spreadFeeReserveBalances: Record<string, number>;     // currency-specific sell-defense pools (50% share)
```

The `tradeGrowth` mirror write happens during national aggregation, after national metrics are current and before the forex phase runs. The budget document remains the authoritative source; this is a read-cache only. `forexRevenue` accumulates 25% of spread fees. The 50% reserve slice is stored under `spreadFeeReserveBalances.<currency>`, not the general `reserveBalance`.

### CountryConfig currency mapping

`COUNTRY_CURRENCY_MAP` and `CURRENCY_ANCHOR_COUNTRY` (`src/lib/constants/currencyCodes.ts`) provide the programmatic `countryId` to `currencyCode` mapping used by the helpers, display formatters and income routing. Without this, every system would hardcode the mapping independently. `getSeedCurrencyCode(countryId, preset)` overrides it for euro adopters, RUB, PLN, RON and BGN in later presets.

### Currency storage rule (v0.2.6)

The canonical storage rule for every money field in the simulation is: **stored in its owning entity's native currency, aggregated in ₳ (anchor), displayed via wallet preference.** Forex v1 (shipped earlier) established this for `Corporation.liquidCapital` and `Character.currencyBalances`. v0.2.6 extends the rule to every remaining money field.

| Domain                                                                                         | Stored in                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Corp fields (`liquidCapital`, `marketingBudget`, `logisticsBudget`, `ceoSalary`, `sharePrice`) | `corporation.liquidCurrencyCode`                                                           |
| Sector fields (`revenue`, `currentGrowthCost`)                                                 | parent corp's `liquidCurrencyCode` (not the state's currency)                              |
| Bond face value / coupon / `totalIssued`                                                       | `bond.currencyCode` (sovereign: country; corporate: issuing corp's `liquidCurrencyCode`)   |
| Federal budget (`revenue`, `spending`, `taxBases`, `debt`, `gdp`, `surplus`)                   | country's `currencyCode` (stamped on `federalBudget.currencyCode`)                         |
| State budget (`revenue`, `spending`, `taxBases`, `balance`, `surplus`, `stateGdp`)             | parent country's currency                                                                  |
| `enactedLaws.annualCostUsd`                                                                    | country's currency (legacy field name; `Usd` suffix predates v0.2.6)                       |
| Cross-entity sums (global GDP, global market cap, commodity flows, rankings)                   | computed in ₳ via `readCorpEconomicAnchor` and the anchor rate map; displayed via wallet pref      |
| `sharePriceFormula` intermediate                                                               | ₳ (anchor), converted to corp-local at persistence boundary                                |
| `corporationHistory`, `marketCapHistory`, `corporationPortfolioHistory`                        | corp's `liquidCurrencyCode` at time of write (`currencyCode` stamped on each row)          |
| `federalBudgetSnapshots.budget.*`                                                              | country's currency at time of write (`budget.currencyCode` stamped on each snapshot)       |
| `debtToGdpRatio`                                                                               | dimensionless, not scaled                                                                  |

**Deferred (post-v0.2.6):** `Campaign.funds`, `PoliticalParty.treasury`, `StatePartyOrg.treasury`, `DiscordBotFund`, campaign/party-side money stays ₳ for now. A future v0.2.x migration will move these too.

#### Helpers (authoritative)

| Helper                                      | Module                                   | Purpose                                                        |
| ------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| `readCorpEconomicAnchor(corp, rates)`       | `src/lib/currency/corpEconomyFields.ts`  | Convert any corp-local money to ₳ for aggregation              |
| `writeCorpEconomicLocal(anchor, rate)`      | `src/lib/currency/corpEconomyFields.ts`  | Convert ₳-denominated derivations back to corp-local for write |
| `resolveCountryCurrencyCode({ countryId })` | `src/lib/currency/govBudgetFields.ts`    | Country to ISO currency code                                   |
| `resolveCorpLiquidCurrencyCode(corp)`       | `src/lib/currency/corporationCapital.ts` | Corp to its `liquidCurrencyCode` (with country fallback)       |
| `fxRateForCorpFromMap(corp, rates)`         | `src/lib/currency/corporationCapital.ts` | Corp to FX rate against ₳                                      |
| `loadFxRatesByCurrency(db)`                 | `src/lib/currency/corporationCapital.ts` | Load `exchangeRates` into a `Map<currencyCode, rate>`          |
| `toInternalFrom(local, code, rates)`        | `src/lib/currency/` (via `useCurrency`)  | Local to ₳ (display helper)                                    |
| `formatAmount(anchor, nativeCurrencyCode)`  | `useCurrency` hook                       | Render per the user's wallet preference                        |

The wallet helpers actually in `src/lib/currency/characterFunds.ts` are `getPersonalBalance`, `getSavingsBalance`, `getHomeCurrency`, `buildPersonalBalanceInc` and the other `build*` write builders.

#### History backfill (option 3)

The v0.2.6 migration rescales every historical snapshot (`corporationHistory`, `marketCapHistory`, `corporationPortfolioHistory`, `federalBudgetSnapshots`) at **today's** FX rate. Historical FX accuracy is intentionally sacrificed in favor of visually-continuous charts across the migration moment. This was evaluated against two alternatives:

- **Option 1 (leave as ₳)**, rejected: every chart would have a visible jump on the cutover turn.
- **Option 2 (per-snapshot historical rate)**, rejected: `exchangeRates` history isn't retained beyond a short window, and reconstruction produced unreliable rates.
- **Option 3 (backfill all at today's rate)**, chosen: chart continuity wins; historical snapshots become approximate post-migration.

## Configuration

### Constants

All in `src/lib/constants/currencies.ts` unless noted. None are read from `gameConfig`; changing them is a code change.

```typescript
// Spread schedule
const MARKET_MAKER_SPREAD = 0.01; // 1%
const LIMIT_ORDER_SPREAD = 0.0064; // 0.64%
const DIRECT_TRADE_SPREAD = 0.0036; // 0.36%
const SECTOR_FX_SPREAD = 0.005; // cross-currency corporate sector flows

// Rate dynamics
const DRIFT_SPEED = 0.05; // ~48 turns to 90% convergence
const RATE_NOISE_MAX = 0.004; // +/-0.4% per-turn jitter
const RATE_FLOOR_MULTIPLIER = 0.5; // 50% below base rate
const RATE_CEILING_MULTIPLIER = 1.5; // 50% above base rate
const CYCLE_PRESSURE_TURNS = 12;
const RESERVE_CURRENCY_VOLATILITY_REDUCTIONS = [0.5, 0.25, 0.125];

// Macro sensitivity coefficients
const PRIME_RATE_SENSITIVITY = 0.02;
const INFLATION_SENSITIVITY = 0.015;
const GDP_GROWTH_SENSITIVITY = 0.01;
const TRADE_GROWTH_SENSITIVITY = 0.005;
const ABSOLUTE_INFLATION_DEPRECIATION_THRESHOLD = 6.0;
const ABSOLUTE_INFLATION_SENSITIVITY = 0.015;

// Player volume pressure
const VOLUME_PRESSURE_SENSITIVITY = 0.0001; // per internal unit of intervention volume
const VOLUME_PRESSURE_CAP = 0.05; // +/-5% max rate impact from volume
const VOLUME_DIRECTION_WEIGHT = 0.2; // central-bank intervention channel
const ORGANIC_VOLUME_DIRECTION_WEIGHT = 0.05; // traded flow channel
const ORGANIC_VOLUME_HALF_PRESSURE_ANCHOR = 1_000_000_000; // net ₳ for half the cap
const ORGANIC_FULL_BREADTH_TRADERS = 5; // traders for full organic push
const VOLUME_LOOKBACK_TURNS = 24;

// Spread fee split
const SPREAD_FEE_DESTROY_RATIO = 0.25;
const SPREAD_FEE_FOREX_REVENUE_RATIO = 0.25;
const SPREAD_FEE_RESERVE_RATIO = 0.5;

// Order expiry
const DIRECT_TRADE_EXPIRY_TURNS = 24;
```

Player trade fee constants and chair spread-strength constants are listed in the Rules tables above. Intervention constants (same file): `INTERVENTION_AGGRESSIVENESS = 20_000_000`, `INTERVENTION_POLICY_COOLDOWN_TURNS = 6`, `INTERVENTION_FAILURE_INFAMY = 15`, `TREASURY_TRANSFER_MAX_PER_TURN_FRACTION = 0.005`, `INTERVENTION_HISTORY_MAX = 24`. Bretton Woods constants (`src/lib/monetary/brettonWoods.ts`): `BW_PEGGED_BAND = 0.5`, `BW_FLOATING_BAND = 0.8`, `BW_FLOATING_DRIFT_MULTIPLIER = 1.5`, `BW_SUSPENSION_TURNS = 90`, `BW_EARLIEST_EXIT_YEAR = 1968`.

### Per-world and per-document settings

| Setting | Default | Where set | Effect |
| ------- | ------- | --------- | ------ |
| `GameState.forexEnabled` | set at world creation | `gameState` document | Gates `tradeGrowthMirror` and `forexTurn` in `src/simulation/phases/stateEffectsPhase.ts`. API routes use `isForexEnabled()` (`src/lib/currency/featureFlag.ts`), which always returns true. |
| `GameState.preset` | world preset | `gameState` | Selects the seeded rate table (`getInitialRates`) and the forex country scope |
| `GameState.currentYear` | advances with the clock | `gameState` | Selects the era monetary baselines |
| `gameConfig.commandEconomyEnabled` | `false` | `gameConfig` document `_id: "default"` | When on, command-era currencies are pinned to their anchor rate and cannot be traded on the open market |
| `exchangeRates.hardPeg` | unset | Seed (`getSeedHardPeg`: IE in the 1953 preset), admin, or the command-economy phase | Rate held fixed; drift, volume, cycle pressure and intervention skipped |
| `exchangeRates.forexSpreadStrength` | 1.0 | Chair action, 48-turn cooldown | Scales the market-maker spread when this currency is sold |
| `exchangeRates.interventionPolicy` | null | Chair action | FX band defence funded from reserves |
| `exchangeRates.monetaryRegime` | pegged | Bretton Woods exit phase | Widens the guardrail band and speeds drift |
| `Character.autoConvertEnabled` | true (undefined counts as on) | Wallet toggle | Whether purchases auto-convert |
| `Character.displayCurrencyPreference` | "local" | Wallet toggle | Display only |

## Timing

Runs inside the state-effects phase of the turn, gated by `GameState.forexEnabled` (`src/simulation/phases/stateEffectsPhase.ts`, `src/lib/turn/forexTurn.ts`). One turn is one real hour (`MS_PER_TURN` in `src/lib/constants/calendar.ts`); 48 turns make a game year.

| Order | Phase | What runs |
| ----- | ----- | --------- |
| 1 | `nationalMetrics`, `fiscalBaseGrowth`, `economicModel` | fresh inflation, GDP growth and trade growth |
| 2 | `tradeGrowthMirror` | copy `FederalBudget.economicFactors.tradeGrowth` to `centralBanks.tradeGrowth` (`src/lib/turn/tradeGrowthMirror.ts`), forex gate |
| 3 | `inflationRecalc` | `recalculateInflationPerTurn()` (`src/lib/turn/inflationRecalc.ts`), so forex sees fresh inflation |
| 4 | `commandEconomy`, `brettonWoodsTurn` | command-economy state; Bretton Woods regime that forex reads the same turn |
| 5 | `ledgerPreForexSnapshot` | shadow-ledger checkpoint, when enabled |
| 6 | `forexTurn` | `processForexTurn()`: recompute 24-turn volumes, macro target, drift, volume pressure, regime pressure, noise, guardrail clamp, intervention, write rates and history; then fill triggered limit orders and expire stale ones |
| 7 | `centralBankChairTurn` | central-bank chair phases and history snapshots |

```
:30 half tick (halfHourTick.ts, forexHalfStep.ts)
    each floating currency applies HALF_TICK_FRACTION = 0.5 of the coming turn's rate step
        |
turn start
    mirror trade growth -> inflation recalc -> Bretton Woods
        |
    forexTurn:
      volumes (tradeHistory, last 24 turns)
        -> per currency: macro target -> drift -> volume -> regime -> noise -> clamp
        -> intervention re-run (if policy set and rate out of band)
        -> write exchangeRates (rate, history, volumes, regime)
        -> euro members copy the anchor rate
        -> limit orders fill (FIFO) -> stale orders expire and refund
        |
    central-bank chair phases and history snapshots
```

A `:30` half step (`src/lib/turn/subhour/forexHalfStep.ts`, called from `halfHourTick.ts`) moves only the rate by half of the coming turn's step and stamps the document; the hourly turn applies the remainder (`computeFractionalRateUpdate`). Interventions, limit-order fills and expiry, the regime roll, the `rateHistory` append, `centralBanks` writes and the volume fields stay on the hourly turn, so charts stay hourly and orders fill once an hour at the turn's rate. Noise is scaled by the square root of the fraction so the two halves' variances add to one full step.

Inflation recalculation uses the previous turn's settled exchange rates because it runs before the forex phase. Player trades execute immediately on request and enter the next turn's 24-turn volume. The 12-turn regime window is checked per currency each turn: a new regime is rolled when none is stored or `currentTurn >= cyclePressureUntilTurn`.

## Worked trace

### Rate update for GBP

Setup: modern default rates, UK `baseRate = 0.75`, current rate 0.75. Inputs this turn: prime rate 5.0, inflation 2.0, GDP growth 1.5, trade growth 0. Baselines: prime 3.0, inflation 2.0, GDP 1.5, trade 0. Five or more traders have net bought ₳1,000,000,000 of GBP in the lookback (`effectiveTraders = 5`, no intervention). The regime is `moderate_strengthen`. The noise draw is +0.002 (+0.2%), volatility multiplier 1.

1. Absolute inflation penalty: `max(0, 2.0 - 6.0) = 0`, so the penalty is 0.
2. Multiplier: `1 - (5.0 - 3.0) x 0.02 + (2.0 - 2.0) x 0.015 + 0 - (1.5 - 1.5) x 0.01 - (0 - 0) x 0.005 = 0.96`.
3. Macro target: `0.75 x 0.96 = 0.72`.
4. Drift: `0.75 + (0.72 - 0.75) x 0.05 = 0.75 - 0.0015 = 0.7485`.
5. Volume: `saturating = 1e9 / (1e9 + 1e9) = 0.5`; `breadthFactor = min(1, max(0.2, 5 / 5)) = 1`; `organic = 0.05 x 0.5 x 1 = 0.025`; `combined = 0.025 x 0.05 + 0 = 0.00125`; cap is `0.05 x 0.2 = 0.01`, not reached. Rate: `0.7485 x (1 - 0.00125) = 0.747564375`.
6. Regime: `0.747564375 x (1 - 0.0015) = 0.7464430284375`.
7. Noise: `0.7464430284375 x 1.002 = 0.747935914494375`.
8. Clamp: band `[0.375, 1.125]`, the rate is inside, so it stays.

Stored: `exchangeRates.rate = 0.747935914494375`, `macroTarget = 0.72`, a `{ turn, rate }` snapshot appended to `rateHistory`, `cyclePressureRegime = "moderate_strengthen"`, `cyclePressureUntilTurn = turn + 12` when newly rolled. The net effect is a 0.29% strengthening in one turn. A single trader supplying the same ₳1B would have `breadthFactor = 0.2`, so `organic = 0.005`, `combined = 0.00025`.

### Volume entry

A trade of 150,000,000 JPY with the JPY rate at 106 has `internalValue = 150,000,000 / 106 = 1,415,094.34` ₳, added to JPY's sell bucket and to the buy bucket of the currency bought.

### Market-maker fee and fee split

A player (no recent trades, prior volume 0) converts 1,000,000 USD to GBP at the market maker with USD rate 1.0, GBP rate 0.75, chair spread strength 1.0, and both currencies at the reference volume of ₳100,000,000.

1. Trade anchor: `1,000,000 / 1.0 = 1,000,000` ₳.
2. Size fee: `0.2 x (1,000,000 - 10,000,000,000 x ln(1 + 1,000,000 / 10,000,000,000)) / 1,000,000`. `ln(1.0001) = 0.0000999950003`, times 1e10 is 999,950.003, so the bracket is 49.997 and the size fee is `0.2 x 49.997 / 1,000,000 = 0.00000999933` (about 0.001%).
3. Liquidity multiplier: `sqrt(100,000,000 / 100,000,000) = 1` for both currencies, so 1.
4. Fee rate: `min(0.3, (0.01 + 0.00000999933) x 1) = 0.01000999933`.
5. Spread fee: `round(1,000,000 x 0.01000999933) = 10,010`. Net: `1,000,000 - 10,010 = 989,990`.
6. Cross rate `0.75 / 1.0 = 0.75`; received: `round(989,990 x 0.75) = round(742,492.5) = 742,493` GBP.
7. Fee split: reserve `round(10,010 x 0.5) = 5,005`, forexRevenue `round(10,010 x 0.25) = round(2,502.5) = 2,503`, central-bank total 7,508, destroyed `10,010 - 7,508 = 2,502`. The 2,503 goes to `centralBanks.forexRevenue` for the USD bank; the 5,005 goes to `spreadFeeReserveBalances.USD` on the GBP (destination) bank.
8. Stored: the character's USD slot is debited 1,000,000 and GBP credited 742,493; a `tradeHistory` row has `amount = 1,000,000`, `receivedAmount = 742,493`, `rate = 0.75`, `spread = 10,010`, `anchorAmount = 1,000,000`, `source = "manual"`.

In a quiet market where each currency traded ₳25,000,000, the liquidity multiplier is `min(1.5, sqrt(4)) = 1.5` (the cap), the fee rate is `0.01000999933 x 1.5 = 0.0150149990`, and the fee is `round(15,014.999) = 15,015`.

## Edge cases and limits

- Guardrail: rates are clamped to 0.5x to 1.5x of the base rate (`RATE_FLOOR_MULTIPLIER`, `RATE_CEILING_MULTIPLIER`). At the clamp, trades still execute but the rate cannot move further. The Bretton Woods float widens the band gradually from 0.5 to 0.8 over `BW_SUSPENSION_TURNS = 90` turns and speeds drift by 1.5x (`src/lib/monetary/brettonWoods.ts`, `src/lib/turn/brettonWoodsTurn.ts`).
- The macro multiplier is floored at 0.01 so the target never goes to zero or negative.
- Combined volume pressure is clamped to the cap times 0.2, so +/-1% of rate per turn at most.
- Zero net volume gives zero pressure. Non-finite breadth falls back to a factor of 1. Breadth never drops below 1/5.
- Total player fee is capped at 30% (`FOREX_MAX_TRADE_FEE`), and a very large trade pays up to 20 points of size fee.
- Every forex input passes a finite-or-default guard (`finiteOr`); a NaN rate falls back to the current rate and a NaN macro target to the base rate. The market maker and limit-order fill refuse to run on a non-finite or non-positive rate rather than debit without crediting.
- Campaign funds never take part in forex. Auto-convert consolidates other foreign wallets first, then draws the remainder from the home currency, and rejects the purchase if home currency is short.
- Planned (command) economies and any admin hard peg skip drift, volume, regime pressure and intervention; the rate holds at its anchor (`hardPeg` or `baseRate`). Non-convertible command currencies cannot be traded by limit order or direct trade.
- Euro-union members trade as one euro currency in the volume lookback. Members follow the anchor's rate and macro target with no independent drift. Conversions between euro denominations use a fixed cross rate with no spread (rounded down), and limit orders or direct trades between them are refused.
- Unfilled direct requests expire after `DIRECT_TRADE_EXPIRY_TURNS = 24` turns by default; any order can ask for 1 to 480 turns.
- A limit order partly filled by a peer keeps `status: "partial"`; the poster's spread is charged per tranche.
- A character deleted between order creation and fill: the order is marked `expired`, the escrow is unrecoverable, and the trade is still logged.
- A currency with no `exchangeRates` row: some helpers fall back to the authored era rate (`eraRateForCurrency`) rather than 1.0. The Warsaw Pact members are deliberately budget-only and get no row.
- A tiny euro-area conversion that rounds to zero ledger units is rejected.

## Invariants

- Escrow is conserved. Limit and direct orders deduct `amount` at creation; every fill credits the counterparty the amount less the poster's spread, and the spread goes to `distributeSpreadFee`, so debits equal credits. Covered by `src/app/api/forex/__tests__/forex-peer-routes.test.ts` and `src/lib/currency/spreadFees.test.ts`.
- A spread fee is fully allocated: `destroyed + forexRevenue + reserve = totalFee`, with destroyed as the remainder (`src/lib/currency/spreadFees.test.ts`).
- Splitting a conversion does not change the size fee (`src/lib/currency/tradeFees.test.ts`).
- Total player fee never exceeds `FOREX_MAX_TRADE_FEE`; combined volume pressure never exceeds `VOLUME_PRESSURE_CAP x VOLUME_DIRECTION_WEIGHT` (`src/lib/currency/rateCalculation.test.ts`).
- Two half rate steps equal one full step when inputs match (`src/lib/currency/rateCalculation.fractional.test.ts`).
- Rates stay finite and positive: enforced at runtime by `finiteOr` and the market-maker guards, not by a database constraint.
- Each fill is applied at most once: the `open/partial` to `processing` claim is atomic; peer fills carry a durable intent and idempotency stamps (`src/lib/forex/__tests__/fillRecovery.test.ts`).
- Stamped spread-fee and refund writes make retries safe (`settledKeys` on `centralBanks`, `forexExpiryRefunds` on characters).
- Campaign funds hold only the home currency: not enforced by a schema; enforced by the routes that write `currencyBalances.campaign`.
- The `tradeGrowth` mirror keeps the budget document authoritative: covered by `src/lib/turn/tradeGrowthMirror.test.ts`.

## Failure and recovery

- **Poisoned rate (NaN or non-positive).** A past incident cascaded a NaN growth figure into exchange rates and then into balances through a conversion. Now `finiteOr` guards the inputs, the final rate falls back to the current rate, and trades are refused on an invalid rate. Repair: correct the upstream value, then the next turn rewrites a sane rate; any damaged balances are repaired with a data heal.
- **Crash during a limit-order fill.** The order is left in `processing`. Fills that carry no peer intent are reset to `open` after 2 turns (`2 x MS_PER_TURN`) at the start of the next forex phase. Peer fills carry a `processingFill` intent and are finished or undone by `recoverStaleFillClaims` (`src/lib/forex/fillRecovery.ts`); an admin recovery route exists for the same purpose.
- **Crash during expiry refund.** The order carries `expiryRefundState` (`pending` then `credited`) and the wallet write is stamped, so the next turn's `expireStaleOrders` completes the refund exactly once.
- **Spread-fee distribution partly applied.** Completed legs are reversed (`reverseSpreadFee`); if the reversal also fails, an aggregate error is raised for manual repair.
- **Intervention fails.** If reserves are exhausted and the rate stays outside the posted band, the chair is charged infamy once per breach cycle (`INTERVENTION_FAILURE_INFAMY = 15`) and mailed; the commitment stays posted until reserves are restored or the policy is changed.
- **Stale rate row after a preset or era problem.** The persisted `baseRate` is authoritative and is never silently re-anchored, because a past re-anchor moved naira valuations about 100x in one turn. A damaged anchor is repaired by reseeding or healing the row.
- **Skipped phase.** If the forex phase is skipped or fails, rates simply hold for that turn and trades continue to settle at the stored rate; the turn diagnostics record the phase result.

## Connections

Driven by:

- The central bank prime rate (`CentralBank.primeRate`, set by chair actions) is a direct input to the macro target (`extractMacroInputs` in `src/lib/turn/forexTurn.ts`). See [Monetary system as shipped](./monetary-system-as-shipped.md).
- [National metrics](./national-metrics.md) and the national budget: inflation, GDP growth and trade growth feed `computeMacroTarget()` via `centralBanks` and `mirrorTradeGrowth`.
- Chair spread strength and intervention reserves (`spreadFeeReserveBalances`, `forexRevenue`), also covered in [Money supply and QE](./money-supply-and-quantitative-easing.md); the spread strength is read in `executeMarketMakerTrade`.
- Bretton Woods and command-economy phases set the regime and pegs that `processForexTurn` reads.
- Player trading volume from `tradeHistory` (`computeCurrencyVolumes`).

Affects:

- [Corporations](./corporations.md): corporate money is stored in the corp's currency, and cross-border sector flows pay `SECTOR_FX_SPREAD` (`src/lib/currency/sectorFxSpread.ts`).
- [Stock market](./stock-market.md): foreign share trades settle in the stock's currency, converting from home currency at the market maker (`autoConvertForPurchase`).
- [Sovereign bonds](./sovereign-bonds.md): coupon and FX depreciation effects on demand.
- Campaign funds and the wallet: personal balances are multi-currency, campaign funds are home currency only.
- Central banks: spread fees fund `forexRevenue` and `spreadFeeReserveBalances`, which fund intervention and rank reserve currencies (the leading reserve currencies trade calmer).
- Inflation: `inflationRecalc` reads the settled exchange rates.
- Mail: order fills, direct requests and intervention failure send system mail.

### Systems that need currency awareness

| System                 | Change required                                                       |
| ---------------------- | --------------------------------------------------------------------- |
| Fund generation        | Deposit to `currencyBalances.campaign` (home currency)                |
| Campaign spending      | Read/write from `currencyBalances.campaign` (home currency only)      |
| Corporation financials | Dividends/salary deposit in corporation's country currency            |
| Stock exchange         | Trades settle in the stock's country currency; auto-convert if needed |
| Bond system            | Coupons/maturity payments in the bond's country currency              |
| Party treasury         | Taxes collect in party's country currency                             |
| Budget system          | Already has `currencyCode` field, minimal changes                     |
| NPP funds              | Deposit to home currency                                              |
| Formatters             | All currency formatters accept `currencyCode` parameter               |
| Display components     | Thread `countryId`/`currencyCode` through ~60+ component files        |

### Systems that don't change

| System                       | Why unchanged                                                            |
| ---------------------------- | ------------------------------------------------------------------------ |
| Election mechanics           | No monetary component                                                    |
| Vote distribution            | No monetary component                                                    |
| Turn processing order        | Forex runs after inflation recalc and before central-bank/history phases |
| Demographic effects          | Operate on non-monetary metrics                                          |
| NPP election/voting behavior | Decision logic is ideology-based, not money-based                        |

## Tests

- Rate math: `src/lib/currency/rateCalculation.test.ts`, `src/lib/currency/rateCalculation.fractional.test.ts`.
- Volume: `src/lib/currency/volumeTracker.test.ts`.
- Fees: `src/lib/currency/tradeFees.test.ts`, `src/lib/currency/spreadFees.test.ts`.
- Market maker and auto-convert: `src/lib/currency/marketMaker.test.ts`, `src/lib/currency/autoConvert.test.ts`, `src/lib/currency/rules/purchaseConversion.test.ts`, `src/lib/currency/purchaseAffordability.test.ts`.
- Turn phase: `src/lib/turn/forexTurn.test.ts`, `src/lib/turn/forexTurn.euroPeg.test.ts`, `src/lib/turn/tradeGrowthMirror.test.ts`.
- Routes: `src/app/api/forex/__tests__/forex-routes.test.ts`, `src/app/api/forex/__tests__/forex-peer-routes.test.ts`, `src/app/api/forex/exchange/route.test.ts`, `src/app/api/forex/rates/route.test.ts`.
- Recovery: `src/lib/forex/__tests__/fillRecovery.test.ts`.
- Euro, intervention and regime: `src/lib/currency/euro/rules.test.ts`, `src/lib/currency/euro/service.test.ts`, `src/lib/currency/intervention/rules.test.ts`, `src/lib/currency/interventionCalculator.test.ts`, `src/lib/currency/exchangeRateRegime.test.ts`.
- Wallet and feature flag: `src/lib/currency/characterFunds.test.ts`, `src/lib/currency/featureFlag.test.ts`, `src/lib/currency/migration.test.ts`.

Gaps: no test pins the cycle-regime probabilities or the 12-turn window rollover on its own; the limit-order market-fill rounding (floor on the reserve slice) differs from `distributeSpreadFee` and has only one covering case in `forexTurn.test.ts`; the public holders route has no test asserting what it exposes.

## Known issues and history

### Open issues

- **Holder amounts are public.** The design says other players see which currencies a character holds but not amounts. The code exposes the largest holders with name and amount through `GET /api/forex/[currency]/holders`, cached publicly. The "Holds JPY, GBP" profile line is not implemented.
- **Two forex gates disagree.** `isForexEnabled()` always returns true (so routes are always open), but the turn phases still read `gameState.forexEnabled` (`src/simulation/phases/stateEffectsPhase.ts`). A world with the stored flag off would accept trades but never update rates.
- **Rounding differs between tiers.** Market-maker and peer fills use `Math.round` slices through `distributeSpreadFee`; limit-order market fills use unrounded spreads with `floor` on the reserve slice.
- **Stale code comments.** `executeMarketMakerTradeInner` still describes the split as "50% destroy, 50% central bank", and `forexLimitOrders.ts` says the same; the real split is 25/25/50. `src/lib/currency/featureFlag.ts` and the `CurrencyCode` comment still describe a phased launch.
- **Spread strength asymmetry.** Limit orders ignore the chair's spread strength; only the market-maker path applies it.

### Contradictions between code and the player wiki

- The wiki says other players filling a limit order early pay "a direct player trade fee" (0.36%). The code charges `LIMIT_ORDER_SPREAD / 2 = 0.32%` to each side, 0.64% in total (`src/app/api/forex/orders/[orderId]/fill/route.ts`).
- The wiki says the auto-convert shortfall comes from the home currency. The code first consolidates any other foreign balances into the required currency (`topUpPersonalBalanceInCurrency`) and only then converts from home.
- The wiki key-numbers table lists a flat 0.64% for limit orders; a market-maker fill of a limit order also pays the size and liquidity fee (the wiki prose does say this).

### Corrections made to this page on 2026-10-29

- The macro target formula now includes the absolute inflation penalty term inside the multiplier.
- Guardrails no longer claim that pressure is "dampened" at the clamp; the code only clamps.
- The auto-convert description no longer says other foreign currencies are never used; the code consolidates them first.
- Partial limit-order fills are described as arising only from peer fills; market fills take the whole remainder.
- Direct trade spread is described as 0.18% per side (total 0.36%).
- The original helper names in the migration section (`getCharacterCampaignFunds`, `deductCampaignFunds`, `depositPersonalFunds` and similar) do not exist; the shipped helpers are listed under Currency storage rule.

### Migration (implementation history)

#### Deployment strategy: abstraction layer + feature flag

This was a **zero-downtime progressive deployment**, not a hard cutover. New code deployed alongside existing functionality, and an admin button triggered the migration. The rationale: a hard cutover across about 307 files requires maintenance mode and a big-bang deploy. Fund read/write logic was funneled through a small set of helpers that switched between old fields (`funds`/`cashOnHand`) and new fields (`currencyBalances`) on a feature flag.

**Deployment sequence (as designed):**

1. Deploy the abstraction layer; all files migrate to helpers; game continues as normal.
2. Deploy the forex system behind `GameState.forexEnabled` (default `false`).
3. Admin clicks "Enable Forex": set `GameState.isProcessing = true`, run the migration script, set `GameState.forexEnabled = true`, set `isProcessing = false`.
4. Post-migration: helpers read from `currencyBalances`; old fields stayed on documents (ignored) until cleanup.
5. Cleanup pass: remove the fallback branch and unset old fields. Done: the legacy fields are deprecated and unset in production by the 2026-05-18 migration.

#### One-time migration script (as designed)

1. For each character, read `countryId`, `funds`, `cashOnHand` (missing `cashOnHand` is 0).
2. Look up home currency from country config.
3. Create `currencyBalances: { campaign: funds, personal: { [homeCurrency]: cashOnHand ?? 0 } }`.
4. Set `displayCurrencyPreference: "local"`, `autoConvertEnabled: true`.
5. Do not unset `funds` and `cashOnHand` yet.
6. Seed `exchangeRates` documents with initial rates.
7. Ensure active `centralBanks` documents have `tradeGrowth`, `forexRevenue`, and `reserveBalance` initialized.
8. Create indexes `tradeHistory: { turn: -1 }` and the `currencyOrders` indexes.
9. Set `GameState.forexEnabled = true`.

New characters created after forex is enabled are initialized with `campaign: 0` and `personal: { [homeCurrency]: 0 }`.

#### Code migration (blast radius)

> **Scope warning:** a grep of `\.funds` and `cashOnHand` across `src/` returned about 307 files (142 in `src/lib`, 165 in `src/app/api`). This was the largest single refactor in the project, implemented in phases: abstraction layer, turn system, API routes, display components.

Key systems moved: fund generation (`src/lib/turn/fundGeneration.ts`), campaign spending (`src/lib/turn/campaignTurn.ts`), corporation dividends (`src/lib/turn/corporationTurn.ts`), stock trading escrow and settlement, bond coupons (`src/lib/turn/bondTurn.ts`), CEO salary, party taxes, NPP fund generation (`src/lib/turn/nppFundGeneration.ts`), admin and heal routes, and display routes.

#### v0.2.6 migration scripts

Run in this order against a staging clone first (see `scripts/migrations/README.md`):

1. `scripts/migrations/corpEconomyToLocalCurrency.ts`
2. `scripts/migrations/bondCurrencyStamp.ts`

(No government-budget migration is shipped, federal and state budgets, snapshots, and enacted laws were already stored in each country's currency pre-v0.2.6; see `docs/design/national-budget.md`.) Each script writes a marker into the `migrationsRun` collection and exits early on re-run. Production rollout was an atomic cutover: pause turns, run both scripts, un-pause, merge the code deploy.

### History

- 2026-04-15: volume units fixed so `buyVolume24` and `sellVolume24` are both in internal units (previously mixed denominations biased USD pressure).
- 2026-05-18: legacy `funds`, `cashOnHand` and `savingsOnHand` removed from production data.
- 2026-10: organic volume pressure reworked (smooth saturation, breadth factor, 0.05 weight) after a loop in which one holder moved a whole fortune through a currency; player size and liquidity fees added around the same time.
- A 12-turn directional regime and reserve-currency noise reduction were added after the original design; the original spread tiers were scaled up 3.64 times so the headline spread is 1%.

Last checked: 2026-10-29, version 1.18.0
