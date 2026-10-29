# Currency Exchange & Multi-Currency System

> **Document status, 2026-08-21:** The overview, exchange-rate model, fee routing, and canonical storage rule describe the shipped system. The later schema proposals and migration sequence are retained as implementation history, not as a current rollout checklist. For current fields and execution paths, use `src/lib/db/types/character.ts`, `src/lib/db/types/centralBank.ts`, `src/lib/currency/`, and `src/lib/turn/forexTurn.ts`.

Player guide: [Currency Exchange](https://www.ahousedividedgame.com/wiki/currency-exchange)

A dynamic foreign exchange system where each active country uses its native currency, exchange rates float based on macroeconomic conditions and player trading activity, and players can speculate on currency markets.

## Overview

- **Storage**: Entity money is stored in the entity's native currency. Cross-country aggregation and display convert values to the anchor unit when needed.
- **Per-country currencies**: Each country's currency floats independently against the internal unit. Rates are driven by each country's own economic indicators, not relative to each other.
- **Player-facing**: Players see and interact exclusively in real currencies. Fund generation, income, and spending all display in the appropriate currency.
- **Speculation**: Players can trade currencies for profit. Buy cheap yen → buy JP stocks → sell when yen strengthens → convert back to home currency.
- **No action cost**: Forex trades do not consume player action points. The spread fees provide sufficient friction, players shouldn't have to choose between political actions and financial management.

## Why Not USD-Canonical?

An earlier design considered storing everything in USD and converting at display time. The problem: if US players tank their economy through bad fiscal policy, every other country's internal values shift because the yardstick itself moved. A UK player's fund generation hasn't changed, but their displayed £ amount fluctuates because the USD anchor weakened.

The abstract internal unit solves this, each currency floats independently. US inflation spikes only affect the USD rate; other currencies are unaffected unless their own economies deteriorate.

## Exchange Rate Model

### Country Scope

`CurrencyCode` (`src/lib/constants/currencyCodes.ts`) defines 29 currency codes, one per country ever playable. Of these, `FOREX_ACTIVE_CURRENCIES` lists 28 as active in the forex system: USD, GBP, JPY, EUR, IEP, CNY, BRL, NGN, SUR, RUB, DDM, FRF, ITL, ESP, SEK, TRL, GRD, ATS, FIM, PLZ, HUF, ROL, BGL, CSK, YUD, PLN, RON, BGN. The only code not active in forex is `CAD`, reserved for a country not yet playable.

### Absolute Inflation Penalty

`computeMacroTarget()` (`src/lib/currency/rateCalculation.ts`) applies an `absoluteInflationPenalty` on top of the usual baseline-relative deviation terms: any inflation above `ABSOLUTE_INFLATION_DEPRECIATION_THRESHOLD` weakens the currency regardless of that country's own inflation baseline. This closed a carry-trade exploit, currencies with no full economic baseline (or a high one) previously acted as a fixed peg that never depreciated no matter how high inflation ran, making them a free real-yield carry vehicle. The penalty applies universally so high inflation always costs the holder.

### Internal Unit Calibration

All existing monetary values in the database are reinterpreted as internal units. Initial exchange rates are set so that existing values map cleanly:

| Country | Currency | Initial rate | Meaning                 | Status    |
| ------- | -------- | ------------ | ----------------------- | --------- |
| US      | USD      | 1.0          | 1 internal unit = $1.00 | ✅ Active |
| UK      | GBP      | 0.75         | 1 internal unit = £0.75 | ✅ Active |
| JP      | JPY      | 106.0        | 1 internal unit = ¥106  | ✅ Active |
| DE      | EUR      | 0.92         | 1 internal unit = €0.92 | ✅ Active |

Cross-country rates are derived: `USD/JPY = jpyRate / usdRate`. No separate storage needed for currency pairs.

### Rate Update Formula (Per Turn)

Rates update each turn through macro drift, player volume, random noise, and a
fourth 12-turn directional regime from `applyCyclePressure`.

#### 1. Macro Fundamental Drift

Each country's rate moves toward a target derived from macroeconomic data, measured against fixed baselines (not relative to another country).

**Data sources per country:**

- `primeRate`, `CentralBank.primeRate` (scalar field, updated by chair actions)
- `inflationRate`, `CentralBank.inflationHistory.at(-1)?.rate` (latest snapshot; no separate scalar to avoid dual source-of-truth)
- `gdpGrowth`, `CentralBank.gdpGrowthHistory.at(-1)?.rate` (latest snapshot, same reason)
- `tradeGrowth`, `CentralBank.tradeGrowth` (mirrored from `FederalBudget.economicFactors.tradeGrowth` each turn during national aggregation, before the forex phase runs)

The forex phase reads only from `centralBanks`, the budget mirror keeps it to one collection read per country.

```
macroTarget = baseRate × max(0.01, 1
  - (primeRate - baselinePrime) × 0.02          // higher rates → stronger currency (lower rate value)
  + (inflationRate - baselineInflation) × 0.015  // higher inflation → weaker currency
  - (gdpGrowth - baselineGDP) × 0.01            // higher growth → stronger currency
  - (tradeGrowth - baselineTrade) × 0.005        // trade surplus → stronger currency
)
```

Rate is "local currency per internal unit," so a lower rate means a stronger currency. Each sensitivity term above is signed so that the described real-world effect (higher rates/growth/trade surplus → stronger currency) comes out of the subtraction, not the addition.

The rate drifts toward the macro target rather than snapping to it:

```
newRate = currentRate + (macroTarget - currentRate) × DRIFT_SPEED
```

At drift speed 0.05, a rate shock takes roughly one full game year (~48 turns) to converge 90%. This creates multi-month currency trends that give players time to notice, build positions, and exit, matching real-world forex pacing.

#### 2. Player Volume Pressure

Net buy/sell volume from the past 24 turns creates a short-term offset:

```
netVolume = buyVolume24 - sellVolume24   // Sum of internal-unit values of trades, past 24 turns
organic = VOLUME_PRESSURE_CAP × netVolume / (|netVolume| + ORGANIC_VOLUME_HALF_PRESSURE_ANCHOR) × breadthFactor
intervention = clamp(syntheticNet × VOLUME_PRESSURE_SENSITIVITY, ±VOLUME_PRESSURE_CAP)   // central-bank intervention
volumePressure = clamp(organic × ORGANIC_VOLUME_DIRECTION_WEIGHT + intervention × VOLUME_DIRECTION_WEIGHT,
                       ±VOLUME_PRESSURE_CAP × VOLUME_DIRECTION_WEIGHT)

finalRate = newRate × (1 - volumePressure)
```

Source: `src/lib/currency/rateCalculation.ts` and `src/lib/constants/currencies.ts`.

Positive volume pressure (net buying) lowers the rate, since buying a currency strengthens it.

Volume pressure is calculated from the total internal-unit value of trades in the lookback (`VOLUME_LOOKBACK_TURNS = 24`, `src/lib/constants/currencies.ts`; computed in `src/lib/currency/volumeTracker.ts`). There is no per-trade cap. A single whale is held back by the saturating curve and the breadth factor below instead.

Traded flow (organic) is weighted by `ORGANIC_VOLUME_DIRECTION_WEIGHT = 0.05`. Its pressure saturates smoothly: net traded volume of `ORGANIC_VOLUME_HALF_PRESSURE_ANCHOR` (₳1,000,000,000) produces half of the cap, so everyday conversions barely register. A `breadthFactor` scales it by the number of effective traders behind the flow: one holder alone earns 1/`ORGANIC_FULL_BREADTH_TRADERS` (1/5) of the push, and 5 or more traders earn the full push. Central-bank intervention keeps the original channel, with `VOLUME_PRESSURE_SENSITIVITY = 0.0001` per internal unit and `VOLUME_DIRECTION_WEIGHT = 0.2`, so it still beats organic flow. This dampens speculative swings while still rewarding well-timed, broad volume.

The per-component pressure is capped at ±5% (`VOLUME_PRESSURE_CAP = 0.05`), and the combined pressure is clamped to the cap times `VOLUME_DIRECTION_WEIGHT` (±1%), so intervention alone sets the ceiling. The constants are tunable and can be loosened as the player base and trade volume grow.

Heavy yen buying pushes the yen rate below fundamentals temporarily (the yen strengthens more than the macro picture alone would justify). As volume normalizes, macro drift pulls it back, classic overshoot/correction cycle that rewards well-timed speculation.

#### 3. Random Noise

Small per-turn jitter (up to ±0.4%, `RATE_NOISE_MAX = 0.004`) prevents perfectly predictable rate movement.

#### 4. Directional Regime Pressure (cycle pressure)

Each currency holds one randomly rolled directional regime for `CYCLE_PRESSURE_TURNS = 12` turns, then rolls again (`rollCyclePressureRegime()` and `CYCLE_PRESSURE_BY_REGIME`, `src/lib/constants/currencies.ts`; applied by `applyCyclePressure()` in `src/lib/currency/rateCalculation.ts`). The five regimes are equally likely:

| Regime | Pressure per turn | Effect on the rate |
| ------ | ----------------- | ------------------ |
| moderate_strengthen | +0.0015 | rate x (1 - 0.0015) |
| slight_strengthen | +0.0007 | rate x (1 - 0.0007) |
| neutral | 0 | none |
| slight_weaken | -0.0007 | rate x (1 + 0.0007) |
| moderate_weaken | -0.0015 | rate x (1 + 0.0015) |

A sustained regime settles only about `pressure / DRIFT_SPEED` off the macro target (roughly 3% for moderate, 1.4% for slight), so strong fundamentals pulling the other way usually win. Pegged currencies and the euro peg skip the regime entirely (pressure 0).

#### Full per-turn pipeline

`computeRateUpdate()` runs these in order: macro target, drift, volume pressure, cycle pressure, noise, then the guardrail clamp. The top three reserve currencies by rank get a noise multiplier of 0.5, 0.75 and 0.875 (`RESERVE_CURRENCY_VOLATILITY_REDUCTIONS = [0.5, 0.25, 0.125]`).

### Baseline Economic Values (Fixed)

Each country has baseline values representing a "neutral" economic state. These anchor the rate math so no country is structurally advantaged:

| Country | Baseline prime | Baseline inflation | Baseline GDP growth | Baseline trade growth |
| ------- | -------------- | ------------------ | ------------------- | --------------------- |
| US      | 3.0%           | 2.0%               | 2.5%                | 0% (neutral)          |
| UK      | 3.0%           | 2.0%               | 1.5%                | 0% (neutral)          |
| JP      | 1.0%           | 1.0%               | 1.0%                | 0% (neutral)          |
| DE      | 3.0%           | 2.0%               | 1.5%                | 0% (neutral)          |

Prime rate and inflation baselines come from `MONETARY_BASELINES`; GDP and trade growth baselines come from a separate `ECONOMIC_BASELINES` constant (`src/lib/constants/currencies.ts`). A third module, `monetaryEra.ts`, layers era-specific overrides on top of `MONETARY_BASELINES` for pre-1999 worlds (e.g. JP's 1953-era neutral prime rate is 5.5%, not the modern 1.0%), keyed on the current in-game year so a long-lived world graduates through eras as its clock advances.

Values reflect real-world historical norms. Tunable during playtesting. The table shows the four original modeled countries; other currencies carry their own baselines in `ECONOMIC_BASELINES` and `monetaryEra.ts`. A currency with no full baseline still gets the absolute inflation penalty (threshold `ABSOLUTE_INFLATION_DEPRECIATION_THRESHOLD = 6.0` percentage points, sensitivity `ABSOLUTE_INFLATION_SENSITIVITY = 0.015` per excess point).

### CentralBank Schema Fields

The forex system uses fields already defined on the `CentralBank` document:

```typescript
tradeGrowth: number; // Mirrored from FederalBudget.economicFactors.tradeGrowth each turn
forexRevenue: number; // Accumulated intervention reserve share of spread fees
spreadFeeReserveBalances: Record<string, number>; // Currency-specific sell-defense pools
```

The `tradeGrowth` mirror write happens during national aggregation, after national metrics are current and before the forex phase runs. The budget document remains the authoritative source; this is a read-cache only.

`forexRevenue` accumulates 25% of spread fees. The 50% reserve slice is stored
under `spreadFeeReserveBalances.<currency>`, not the general `reserveBalance`.

### CountryConfig Currency Mapping

`CountryConfig` includes a `currencyCode` field in `src/lib/constants/countries.ts`:

```typescript
currencyCode: CurrencyCode; // "USD", "GBP", "JPY", etc.
```

This provides the programmatic `countryId → currencyCode` mapping needed by the abstraction helpers, migration script, display formatters, and income routing. Without this, every system would hardcode the mapping independently.

### Guardrails

- Rate floor/ceiling per currency: ±50% from base rate to prevent runaway devaluation
- When a rate hits the guardrail, trades still execute but rate pressure is dampened

### Spread Fee Revenue

Spread fees are split roughly 25/25/50 (`src/lib/currency/spreadFees.ts`):

- **25% destroyed** (`SPREAD_FEE_DESTROY_RATIO`), removed from the economy. Acts as a deflationary sink that counterbalances fund generation and constrains inflation from heavy trading.
- **25% to `forexRevenue`** (`SPREAD_FEE_FOREX_REVENUE_RATIO`), the central bank's intervention reserve.
- **50% to `spreadFeeReserveBalances.<currency>`** (`SPREAD_FEE_RESERVE_RATIO`), a currency-specific sell-defense pool.

Players also pay a size fee and a market-liquidity scaling on top of the base spread (see Player Trade Fees below). Together, `forexRevenue` and currency-specific spread-fee reserves make up the
central bank's 75% share (`SPREAD_FEE_CENTRAL_BANK_RATIO`). Flooring is handled
in `spreadFees.ts`, with the destroyed share absorbing rounding remainder. The
split applies to all three trading tiers.

### Player Trade Fees (size and liquidity)

The flat tier spreads in the Fee Schedule are the base. A player's own conversions (market maker and limit orders) pay a total of `min(FOREX_MAX_TRADE_FEE, (baseSpread + sizeFee) x liquidity)`, computed by `playerTradeFeeRate()` in `src/lib/currency/tradeFees.ts`. Conversions the game makes for the player (dividends, coupons, auto-convert shortfalls) pay the base spread only.

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

All in `src/lib/constants/currencies.ts`. The size fee is the average of a rising marginal rate `MAX x x / (x + HALF)` over the trader's new slice of volume, so ten trades of ₳1B cost the same as one of ₳10B. The liquidity multiplier is `clamp(sqrt(REFERENCE / recentVolume), 0.5, 1.5)`, taking the quieter of the two currencies.

### Turn Processing Placement

The forex phase runs after per-turn inflation recalculation and before central-bank chair phases and history snapshots. It is gated by `GameState.forexEnabled`. The phase reads `centralBanks` (primeRate, inflationHistory, gdpGrowthHistory, tradeGrowth), computes net volume from `tradeHistory`, writes updated rates and snapshots to `exchangeRates`, and processes triggered or expired limit orders.

## Multi-Currency Wallet

### Character Financial Structure

**Existing fields become internal-only:**

- `character.funds`, campaign/political funds in internal units (used by game system calculations)
- `character.cashOnHand`, personal wealth in internal units (used by game system calculations)

**New `currencyBalances`, the player-facing wallet:**

```typescript
// CurrencyCode is defined in src/lib/constants/currencyCodes.ts.
// 28 active runtime currencies (FOREX_ACTIVE_CURRENCIES): every CurrencyCode except "CAD".
// "CAD" is reserved for a country not yet playable.
type CurrencyCode = "USD" | "GBP" | "JPY" | "EUR" | "IEP" | "CNY" | "BRL" | "NGN" | "SUR" | "DDM" | "FRF" | "ITL" | "ESP" | "SEK" | "TRL" | "GRD" | "ATS" | "FIM" | "CAD" | ...;

currencyBalances: {
  // Campaign funds, always home currency only. Never holds foreign currency.
  campaign: number;
  // Personal wealth, multi-currency. Missing keys treated as 0.
  // Partial allows graceful scaling when future currencies launch, no migration needed.
  personal: Partial<Record<CurrencyCode, number>>;
}
```

**Campaign funds are strictly home-currency.** All campaign income (fund generation, party distributions) is deposited in the player's home currency. Campaign spending always deducts from this single balance. Campaign funds never participate in forex, no foreign-currency campaign balances, no cross-currency campaign spending.

**Personal wealth is multi-currency.** Foreign income (stock dividends, bond coupons, CEO salary) deposits into the corresponding personal currency slot. Players can hold and speculate with any active currency.

A US player's fund generation: `currencyBalances.campaign += generatedAmount` (in USD). A JP player's: same, in JPY. Home currency is always where players naturally accumulate wealth.

### Spending Flow

**Campaign purchases** (ads, party actions, etc.) always deduct from `currencyBalances.campaign` in the player's home currency. No forex involvement.

**Personal purchases** (stocks, bonds, foreign assets):

1. Check `currencyBalances.personal[requiredCurrency]`, if sufficient, spend directly, no fee
2. If partial, spend what they have in that currency, convert the shortfall from `currencyBalances.personal[homeCurrency]` at market-maker rate (1% spread), apply atomically
3. If none, convert the full amount from `currencyBalances.personal[homeCurrency]` at market-maker rate, apply atomically

**Shortfall Failure:** If both the target currency balance and the home currency balance are insufficient to cover the cost, the transaction is rejected. The system does not chain conversions from other foreign currencies; only the home currency is used as the automatic fallback source.

With auto-convert **on** (default), the player sees a confirmation prompt before submitting:

> "You have ¥2,300,000. This costs ¥5,000,000. Use your yen and convert ≈$25,400 (1% fee) for the remainder?"

With auto-convert **off**, insufficient foreign currency rejects the transaction with a message directing the player to the exchange. The auto-convert shortfall always draws from personal home currency, campaign funds are never touched for personal purchases.

### Foreign Income Handling

Foreign-denominated income (JP stock dividends, UK bond coupons, CEO salary from foreign corporations) has a **per-holding income preference** set by the player:

- **Receive in foreign currency** (default), income deposits directly into `currencyBalances.personal[sourceCurrency]` at no cost. The player accumulates foreign currency and converts manually when they choose.
- **Auto-convert to home currency**, income is converted at market-maker rate (1% spread) on receipt and deposited into `currencyBalances.personal[homeCurrency]`. Convenient for players who don't want to manage multiple currencies.

This preference is stored per holding (per stock position, per bond position) so a player can auto-convert UK bond coupons while accumulating JP dividends in yen. The setting is accessible from the portfolio page next to each holding.

> **Not shipped as designed (checked 2026-10-29):** no `incomeConversionPreference` field exists in the code. Live behavior is that foreign dividends are converted automatically to the home currency at the market-maker rate when forex is enabled. This section is retained as the original proposal.

Income routes based on source:

- Stock dividends, bond coupons, CEO salary → `currencyBalances.personal[sourceCurrency]`
- Party-related income, fund generation → `currencyBalances.campaign` (home currency only)

## Currency Exchange, Three-Tier System

### Fee Schedule

| Tier | Method                      | Spread | Fill guarantee              |
| ---- | --------------------------- | ------ | --------------------------- |
| 1    | Market maker (auto-convert) | 1%     | Instant, infinite liquidity |
| 2    | Public limit order          | 0.64%  | When matched or expired     |
| 3    | Direct player request       | 0.36%  | When target player accepts  |

Each step down rewards more player engagement. Auto-convert uses Tier 1 by default.

### Market Maker

System-provided liquidity at the current exchange rate ± 1% spread. Always available, always fills instantly. This is what auto-convert uses under the hood.

Player trades against the market maker still exert volume pressure on the rate, buying yen from the market maker pushes yen stronger, same as any other trade.

### Public Limit Orders

Player posts an order visible to all on the exchange: "Buy ¥5,000,000 at rate 104.5 or better." The order sits on the book until the market rate reaches the player's limit price, at which point it auto-executes against the market maker at the prevailing rate (0.64% spread). The order book is primarily a display of what rates players are waiting for, not a peer-matching engine.

**Execution Priority:**

1. **Manual Player-to-Player Fills**: If another player chooses to manually fill an order from the exchange page, this takes absolute priority.
2. **Automatic Market Maker Fills**: If no player manually fills the order, the system executes the order against the market maker once the limit price is met.

**Player-to-player fills:** A player viewing the exchange page can see open limit orders and choose to fill one directly, taking the other side at the posted rate. This is a manual, opportunistic action: the seller browses open buy orders and fills one. The 0.64% spread is split evenly, each side pays 0.32% on the filled amount. Total system take is 0.64%, equivalent to a single market-maker trade at the discounted tier.

**Partial fills:** Whether filled by the market maker or by another player manually, if less than the full order amount is covered, the matched portion executes and the remainder stays on the book unchanged. `status` transitions to `"partial"`, `filledAmount` tracks cumulative filled volume. Spread is charged proportionally on each fill tranche; `spreadCharged` accumulates across all fill events.

Optional expiry: player can set a turn-based expiry ("cancel after N turns if unfilled"). Orders without expiry persist until manually cancelled.

### Direct Player Requests

Player sends a conversion offer to a specific character: "Buy ¥2,000,000 from [CharacterName] at rate 105.0." Target receives an in-game mail notification. They can:

- **Accept**, trade executes at proposed rate + 0.36% spread
- **Decline**, order cancelled, initiator notified

No counter-offers. If the target wants different terms they decline and post their own order or direct request.

Requests expire after a configurable window (default: 24 turns / ~6 game months).

### Player Currency Visibility

Other players can see **which currencies** a character holds (e.g., "Holds JPY, GBP") but **not the amounts**. This enables informed direct trade requests without exposing exact financial positions.

## Data Model

### New Collection: `exchangeRates`

One document per country, updated each turn:

```typescript
interface ExchangeRate {
  _id: string; // CountryId
  countryId: CountryId;
  currencyCode: CurrencyCode; // "USD", "GBP", "JPY"
  rate: number; // local currency per 1 internal unit
  baseRate: number; // initial calibration (never changes)
  macroTarget: number; // current fundamental target rate
  rateHistory: TurnSnapshot[]; // per-turn snapshots for charting, pruned to last 240 turns (5 in-game years, FOREX_AND_MACRO_CHART_HISTORY_TURNS) each turn
  /** Gross buy volume for this currency over the past 24 turns, in internal units.
   *  Recomputed each turn by the forex phase from tradeHistory. */
  buyVolume24: number;
  /** Gross sell volume for this currency over the past 24 turns, in internal units.
   *  Recomputed each turn by the forex phase from tradeHistory. */
  sellVolume24: number;
  updatedAt: Date;
}
```

Net volume is derived at formula time: `netVolume = buyVolume24 - sellVolume24`. Storing gross values separately makes volume imbalances debuggable without re-querying `tradeHistory`. The forex turn phase computes these by querying `tradeHistory` for all trades in the past 24 turns, grouping by currency, and summing internal-unit amounts into buy/sell buckets per country.

### New Collection: `currencyOrders`

```typescript
interface CurrencyOrder {
  _id: ObjectId;
  characterId: ObjectId;
  characterName: string;
  countryId: CountryId;
  type: "market" | "limit" | "direct";
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  amount: number; // amount of fromCurrency to spend
  limitRate?: number; // limit orders, worst acceptable rate
  targetCharacterId?: ObjectId; // direct orders only
  targetCharacterName?: string; // direct orders only
  expiresAtTurn?: number;
  status: "open" | "filled" | "partial" | "cancelled" | "expired";
  filledAmount: number;
  filledRate?: number;
  spreadCharged: number;
  createdAt: Date;
  updatedAt: Date;
}
```

> **Note:** `balanceType` was removed, all forex trades operate on personal funds only. Campaign funds are strictly home-currency and never participate in forex.

**Indexes:** `{ status: 1, expiresAtTurn: 1 }` for the turn phase scan of open/expired orders. `{ characterId: 1, status: 1 }` for the player's open orders view.

### New Collection: `tradeHistory`

Executed trade log for volume calculations and player transaction history:

```typescript
interface TradeHistoryEntry {
  _id: ObjectId;
  buyerCharacterId: ObjectId;
  sellerCharacterId: ObjectId | null; // null = market maker
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  amount: number;
  rate: number;
  spread: number;
  turn: number;
  createdAt: Date;
}
```

**Indexes:** `{ turn: -1 }` for the forex phase's 24-turn volume lookback query. `{ buyerCharacterId: 1, turn: -1 }` for player transaction history display.

### Character Document Changes

```typescript
// New fields
currencyBalances: {
  campaign: number; // home currency only, never holds foreign currency
  personal: Partial<Record<CurrencyCode, number>>; // missing keys = 0 balance
}
displayCurrencyPreference: "local" | "home" | "USD"; // proposal; the shipped type is "local" | "home" | "internal" | CurrencyCode (src/lib/db/types/character.ts)
autoConvertEnabled: boolean; // default true
```

**New character initialization:** Characters created after forex is enabled must have `currencyBalances` initialized with `campaign: 0` and `personal: { [homeCurrency]: 0 }`. The character creation route handles this based on the forex feature flag.

### Deprecated Fields (After Migration)

```typescript
funds: number        → currencyBalances.campaign          // home currency, no conversion needed
cashOnHand: number   → currencyBalances.personal[homeCurrency]
```

## Migration

### Deployment Strategy: Abstraction Layer + Feature Flag

This is a **zero-downtime progressive deployment**, not a hard cutover. New code deploys alongside existing functionality, and an admin button triggers the migration when ready.

Rationale: a hard cutover across ~307 files requires maintenance mode and a big-bang deploy. The abstraction layer approach lets code ship incrementally while the game continues running. All fund read/write logic is funneled through a small set of helper functions that internally switch between old fields (`funds`/`cashOnHand`) and new fields (`currencyBalances`) based on a feature flag.

**Deployment sequence:**

1. **Deploy abstraction layer**, helper functions (`getCharacterFunds`, `getCampaignBalance`, `getPersonalBalance`, `deductCampaignFunds`, `depositPersonalFunds`, etc.) that read from `funds`/`cashOnHand` by default. All ~307 files migrate to use these helpers. Game continues as normal.
2. **Deploy forex system** (feature-flagged off), new types, collections, turn phase, API routes, UI. The forex turn phase and exchange UI are gated behind `GameState.forexEnabled` (default `false`).
3. **Admin clicks "Enable Forex" button**, triggers the migration:
   a. Set `GameState.isProcessing = true` (prevents turns during migration)
   b. Run migration script (see below)
   c. Set `GameState.forexEnabled = true`
   d. Set `GameState.isProcessing = false`
4. **Post-migration:** helpers now read from `currencyBalances`. Old `funds`/`cashOnHand` fields remain on documents (ignored) until a cleanup pass removes them.
5. **Cleanup PR** (later, low priority), remove the fallback branch from helpers, unset old fields from character documents.

### Feature Flag: `GameState.forexEnabled`

Added to the `GameState` document (`_id: "current"`):

```typescript
forexEnabled: boolean; // default false, gates forex turn phase, exchange UI, and helper read source
```

The abstraction helpers check this flag (cached per request, not per call) to determine whether to read from old or new fields.

### Abstraction Layer (Helper Functions)

Located in `src/lib/currency/characterFunds.ts`:

```typescript
// Campaign funds, always home currency
getCharacterCampaignFunds(character): number
deductCampaignFunds(db, characterId, amount): Promise<void>
depositCampaignFunds(db, characterId, amount): Promise<void>

// Personal wealth, currency-aware post-migration
getPersonalBalance(character, currencyCode?): number
depositPersonalFunds(db, characterId, amount, currencyCode): Promise<void>
deductPersonalFunds(db, characterId, amount, currencyCode): Promise<void>

// Display, returns formatted amount in appropriate currency
formatCharacterFunds(character, type: "campaign" | "personal"): string
```

Pre-migration: these read/write `funds` and `cashOnHand` directly.
Post-migration: these read/write `currencyBalances.campaign` and `currencyBalances.personal[currencyCode]`.

### One-Time Migration Script (Triggered by Admin Button)

1. For each character, read `countryId`, `funds`, `cashOnHand` (treat missing/undefined `cashOnHand` as 0)
2. Look up home currency from country config (US→USD, UK→GBP, JP→JPY, DE→EUR)
3. Create `currencyBalances` from existing values:
   ```
   currencyBalances: {
     campaign: funds,
     personal: {
       [homeCurrency]: cashOnHand ?? 0
     }
   }
   ```
4. Set `displayCurrencyPreference: "local"`, `autoConvertEnabled: true`
5. **Do not unset** `funds` and `cashOnHand` yet, they remain as inert data until the cleanup pass
6. Seed `exchangeRates` documents for US, UK, JP, and DE with initial rates
7. Ensure active `centralBanks` documents have `tradeGrowth`, `forexRevenue`, and `reserveBalance` initialized
8. Create indexes: `tradeHistory: { turn: -1 }`, `currencyOrders: { status: 1, expiresAtTurn: 1 }`
9. Set `GameState.forexEnabled = true`

### Code Migration (Blast Radius)

> **Scope warning:** A grep of `\.funds` and `cashOnHand` across `src/` returns ~307 files (142 in `src/lib`, 165 in `src/app/api`). This is the largest single refactor in the project. Implement in phases, abstraction layer first, then turn system, then API routes, then display components.

Every code path that reads or writes `funds` or `cashOnHand` must be updated to use the abstraction helpers. Key systems:

- **Fund generation** (`src/lib/turn/fundGeneration.ts`), `depositCampaignFunds` (home currency)
- **Campaign spending** (`src/lib/turn/campaignTurn.ts`), `deductCampaignFunds`
- **Corporation dividends** (`src/lib/turn/corporationTurn.ts`), `depositPersonalFunds` (corporation's country currency)
- **Stock trading**, escrow/settlement via `deductPersonalFunds`/`depositPersonalFunds`
- **Bond coupons** (`src/lib/turn/bondTurn.ts`), `depositPersonalFunds` (bond's country currency)
- **CEO salary**, `depositPersonalFunds` (corporation's country currency)
- **Party taxes**, `deductCampaignFunds`, deposit to party treasury
- **NPP fund generation** (`src/lib/turn/nppFundGeneration.ts`), `depositCampaignFunds` (home currency)
- **Admin/heal routes**, any route that adjusts character funds
- **API routes** reading `cashOnHand` or `funds` for display, use `getCharacterCampaignFunds` / `getPersonalBalance`

Run `grep -rn "\.funds\b\|cashOnHand" src/` before starting to generate the full touchpoint list. Do not rely solely on the list above.

## UI

### Currency Exchange Page

**Nav placement:** World dropdown → between Stock Market and News

**Page content:**

- Player's currency holdings at the top (all balances, campaign + personal)
- Live exchange rates table between all active currency pairs
- Rate trend charts with historical data (reuses `TurnSnapshot` charting pattern)
- Order book, open public limit orders for each currency pair
- Player's own open orders (limit + pending direct requests)
- Trade form: buy/sell currency with method selector (market / limit / direct)

### Player Wallet

New section on the character portfolio page:

- Balances for each currency, split by campaign/personal
- Quick-convert button per currency (market rate shortcut)

### Display Preference Toggle

Three options, stored as `displayCurrencyPreference` on the character:

| Setting             | Behavior                                       | Example (JP stock at ¥26,900) |
| ------------------- | ---------------------------------------------- | ----------------------------- |
| **Local** (default) | Prices shown in the asset's native currency    | ¥26,900                       |
| **Home**            | Everything converted to player's home currency | ≈$254                         |
| **USD**             | Everything converted to US dollars             | ≈$254                         |

The `≈` prefix indicates a converted value, distinguishing it from native prices. Accessible from the wallet section.

Note: for US players, `"home"` and `"USD"` are identical, both show USD. The `"USD"` option exists as a common reference currency for non-US players who want to benchmark everything in dollars regardless of their home currency.

### Auto-Convert Toggle

- On by default, accessible from wallet section
- When on: foreign purchases show confirmation prompt with conversion details and fee
- When off: must have sufficient foreign currency; transaction fails with redirect to exchange

### Direct Trade Flow

1. Player views another character's profile → sees "Holds JPY, GBP" (amounts hidden)
2. Clicks "Propose currency trade" → form: currency pair, amount, proposed rate
3. Target receives in-game mail notification
4. Target accepts (executes at proposed rate + 0.36%) or declines, no counter-offers
5. Expiry countdown shown on both sides

### Notifications (In-Game Mail)

- Limit order filled
- Direct trade request received
- Direct trade accepted / declined
- Order expired

### Future Enhancement (v2): Rate Alerts

Players set a watch on a currency pair: "Notify me when USD/JPY drops below 95." Receive in-game mail when the rate crosses their threshold. Useful for players who want to time currency purchases without monitoring the exchange page. **Not in v1 scope, no schema pre-created. Define the `rateAlerts` collection when v2 is actively built.**

## Constants & Configuration

```typescript
// Spread schedule
const MARKET_MAKER_SPREAD = 0.01; // 1%
const LIMIT_ORDER_SPREAD = 0.0064; // 0.64%
const DIRECT_TRADE_SPREAD = 0.0036; // 0.36%

// Rate dynamics
const DRIFT_SPEED = 0.05; // ~48 turns to 90% convergence
const RATE_NOISE_MAX = 0.004; // ±0.4% per-turn jitter
const RATE_FLOOR_MULTIPLIER = 0.5; // 50% below base rate
const RATE_CEILING_MULTIPLIER = 1.5; // 50% above base rate

// Macro sensitivity coefficients
const PRIME_RATE_SENSITIVITY = 0.02;
const INFLATION_SENSITIVITY = 0.015;
const GDP_GROWTH_SENSITIVITY = 0.01;
const TRADE_GROWTH_SENSITIVITY = 0.005;

// Baselines (neutral economic state), split across two constants in source
const MONETARY_BASELINES: Record<CountryId, MonetaryBaseline> = {
  US: { targetInflation: 2.0, neutralPrimeRate: 3.0 },
  UK: { targetInflation: 2.0, neutralPrimeRate: 3.0 },
  JP: { targetInflation: 1.0, neutralPrimeRate: 1.0 },
  DE: { targetInflation: 2.0, neutralPrimeRate: 3.0 },
};

const ECONOMIC_BASELINES: Partial<Record<CountryId, EconomicBaseline>> = {
  US: { gdpGrowth: 2.5, tradeGrowth: 0 }, // 0 = neutral
  UK: { gdpGrowth: 1.5, tradeGrowth: 0 }, // 0 = neutral
  JP: { gdpGrowth: 1.0, tradeGrowth: 0 }, // 0 = neutral
  DE: { gdpGrowth: 1.5, tradeGrowth: 0 }, // 0 = neutral
};

// Initial exchange rates (local currency per 1 internal unit)
const INITIAL_RATES: Partial<Record<CountryId, number>> = {
  US: 1.0,
  UK: 0.75,
  JP: 106.0,
  DE: 0.92,
};

// Player volume pressure
const VOLUME_PRESSURE_SENSITIVITY = 0.0001; // per internal-unit of net volume
const VOLUME_PRESSURE_CAP = 0.05; // ±5% max rate impact from volume, tunable
const VOLUME_DIRECTION_WEIGHT = 0.2; // central-bank intervention channel
const ORGANIC_VOLUME_DIRECTION_WEIGHT = 0.05; // traded flow channel
const ORGANIC_VOLUME_HALF_PRESSURE_ANCHOR = 1_000_000_000; // net ₳ for half the cap
const ORGANIC_FULL_BREADTH_TRADERS = 5; // traders for full organic push
const VOLUME_LOOKBACK_TURNS = 24; // ~6 game months of trade history

// Order expiry defaults
const DIRECT_TRADE_EXPIRY_TURNS = 24; // ~6 game months
```

## Integration with Existing Systems

### Systems That Need Currency Awareness

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

### Systems That Don't Change

| System                       | Why unchanged                                                            |
| ---------------------------- | ------------------------------------------------------------------------ |
| Election mechanics           | No monetary component                                                    |
| Vote distribution            | No monetary component                                                    |
| Turn processing order        | Forex runs after inflation recalc and before central-bank/history phases |
| Demographic effects          | Operate on non-monetary metrics                                          |
| NPP election/voting behavior | Decision logic is ideology-based, not money-based                        |

## Currency storage (v0.2.6)

The canonical storage rule for every money field in the simulation is: **stored in its owning entity's native currency, aggregated in ₳ (anchor), displayed via wallet preference.** Forex v1 (shipped earlier) established this for `Corporation.liquidCapital` and `Character.currencyBalances`. v0.2.6 extends the rule to every remaining money field.

| Domain                                                                                         | Stored in                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Corp fields (`liquidCapital`, `marketingBudget`, `logisticsBudget`, `ceoSalary`, `sharePrice`) | `corporation.liquidCurrencyCode`                                                           |
| Sector fields (`revenue`, `currentGrowthCost`)                                                 | parent corp's `liquidCurrencyCode` (not the state's currency)                              |
| Bond face value / coupon / `totalIssued`                                                       | `bond.currencyCode` (sovereign → country; corporate → issuing corp's `liquidCurrencyCode`) |
| Federal budget (`revenue`, `spending`, `taxBases`, `debt`, `gdp`, `surplus`)                   | country's `currencyCode` (stamped on `federalBudget.currencyCode`)                         |
| State budget (`revenue`, `spending`, `taxBases`, `balance`, `surplus`, `stateGdp`)             | parent country's currency                                                                  |
| `enactedLaws.annualCostUsd`                                                                    | country's currency (legacy field name; `Usd` suffix predates v0.2.6)                       |
| Cross-entity sums (global GDP, global market cap, commodity flows, rankings)                   | computed in ₳ via `sumAsAnchor` / `readCorpEconomicAnchor`; displayed via wallet pref      |
| `sharePriceFormula` intermediate                                                               | ₳ (anchor), converted to corp-local at persistence boundary                                |
| `corporationHistory`, `marketCapHistory`, `corporationPortfolioHistory`                        | corp's `liquidCurrencyCode` at time of write (`currencyCode` stamped on each row)          |
| `federalBudgetSnapshots.budget.*`                                                              | country's currency at time of write (`budget.currencyCode` stamped on each snapshot)       |
| `debtToGdpRatio`                                                                               | dimensionless, not scaled                                                                  |

**Deferred (post-v0.2.6):** `Campaign.funds`, `PoliticalParty.treasury`, `StatePartyOrg.treasury`, `DiscordBotFund`, campaign/party-side money stays ₳ for now. A future v0.2.x migration will move these too.

### Helpers (authoritative)

| Helper                                      | Module                                   | Purpose                                                        |
| ------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- |
| `readCorpEconomicAnchor(corp, rates)`       | `src/lib/currency/corpEconomyFields.ts`  | Convert any corp-local money to ₳ for aggregation              |
| `writeCorpEconomicLocal(anchor, rate)`      | `src/lib/currency/corpEconomyFields.ts`  | Convert ₳-denominated derivations back to corp-local for write |
| `resolveCountryCurrencyCode({ countryId })` | `src/lib/currency/govBudgetFields.ts`    | Country → ISO currency code                                    |
| `resolveCorpLiquidCurrencyCode(corp)`       | `src/lib/currency/corporationCapital.ts` | Corp → its `liquidCurrencyCode` (with country fallback)        |
| `fxRateForCorpFromMap(corp, rates)`         | `src/lib/currency/corporationCapital.ts` | Corp → FX rate against ₳                                       |
| `loadFxRatesByCurrency(db)`                 | `src/lib/currency/corporationCapital.ts` | Load `exchangeRates` into a `Map<currencyCode, rate>`          |
| `sumAsAnchor(items, valueFn, rateFn)`       | `src/lib/currency/anchorAggregate.ts`    | Mixed-currency sum → ₳                                         |
| `toInternalFrom(local, code, rates)`        | `src/lib/currency/` (via `useCurrency`)  | Local → ₳ (display helper)                                     |
| `formatAmount(anchor, nativeCurrencyCode)`  | `useCurrency` hook                       | Render per the user's wallet preference                        |

### History backfill (option 3)

The v0.2.6 migration rescales every historical snapshot (`corporationHistory`, `marketCapHistory`, `corporationPortfolioHistory`, `federalBudgetSnapshots`) at **today's** FX rate. Historical FX accuracy is intentionally sacrificed in favor of visually-continuous charts across the migration moment. This was evaluated against two alternatives:

- **Option 1 (leave as ₳)**, rejected: every chart would have a visible jump on the cutover turn.
- **Option 2 (per-snapshot historical rate)**, rejected: `exchangeRates` history isn't retained beyond a short window, and reconstruction produced unreliable rates.
- **Option 3 (backfill all at today's rate)**, chosen: chart continuity wins; historical snapshots become approximate post-migration.

### Migration scripts

Run in this order against a staging clone first (see `scripts/migrations/README.md`):

1. `scripts/migrations/corpEconomyToLocalCurrency.ts`
2. `scripts/migrations/bondCurrencyStamp.ts`

(No government-budget migration is shipped, federal and state budgets, snapshots, and enacted laws were already stored in each country's currency pre-v0.2.6; see `docs/design/national-budget.md`.) Each script writes a marker into the `migrationsRun` collection and exits early on re-run. Production rollout is an atomic cutover: pause turns → run both scripts → un-pause → merge the code deploy.

## Worked example

Rate drift. The US baseline prime rate is 3.0%. A chair raises it to 5.0% with everything else at baseline. The macro multiplier is `1 - (5.0 - 3.0) x 0.02 = 0.96`, so the USD target is `1.0 x 0.96 = 0.96`. From a current rate of 1.000 one turn of drift gives `1.000 + (0.96 - 1.000) x 0.05 = 0.998`. After volume pressure of zero, a neutral regime and noise, the rate is about 0.998, a 0.2% strengthening on the first turn, with about 90% of the gap closed after roughly 45 turns.

Volume pressure. Five or more traders net buy a combined ₳1,000,000,000 of yen in the lookback. Organic pressure is `0.05 x 1e9 / (1e9 + 1e9) x 1 = 0.025`, then weighted by `ORGANIC_VOLUME_DIRECTION_WEIGHT = 0.05` to 0.00125, so the yen rate falls 0.125% that turn. A single trader moving the same ₳1B gets a breadth factor of 1/5 and pushes 0.025%.

Fee. A fresh trader converts ₳1,000,000 at the market maker. Size fee is about 0.001%, so the rate is `0.01 + 0.00001 = 1.001%` (₳10,010) when both currencies trade at the reference volume of ₳100,000,000. In a quiet market (₳25,000,000 volume) the multiplier caps at 1.5 and the fee is 1.5015% (₳15,015).

## Timing

Runs inside the state-effects phase of the turn, gated by `GameState.forexEnabled` (`src/simulation/phases/stateEffectsPhase.ts`, `src/lib/turn/forexTurn.ts`). Order:

1. Trade-growth mirror from the federal budget to `centralBanks`.
2. `recalculateInflationPerTurn()` (`src/lib/turn/inflationRecalc.ts`), so forex sees fresh inflation.
3. `processForexTurn()`: recompute 24-turn volumes, macro target, drift, volume pressure, 12-turn regime pressure, noise, guardrail clamp, write rates and history, trigger or expire limit orders.
4. Central-bank chair phases and history snapshots.

Inflation recalculation uses the previous turn's settled exchange rates because it runs before the forex phase. Player trades execute immediately on request and enter the next turn's 24-turn volume.

## Edge cases and limits

- Guardrail: rates are clamped to 0.5x to 1.5x of the base rate (`RATE_FLOOR_MULTIPLIER`, `RATE_CEILING_MULTIPLIER`). At the clamp, trades still execute but the rate cannot move further.
- The macro multiplier is floored at 0.01 so the target never goes to zero or negative.
- Combined volume pressure is clamped to the cap times 0.2, so +/-1% of rate per turn at most.
- Zero net volume gives zero pressure. Non-finite breadth falls back to a factor of 1.
- Total player fee is capped at 30%, and a very large trade pays up to 20 points of size fee.
- Campaign funds never take part in forex. Auto-convert draws only from the home currency, never chains through other foreign currencies, and rejects the purchase if home currency is short.
- Planned (command) economies and any admin hard peg skip drift, volume and regime pressure; the rate holds at its anchor. The Bretton Woods float widens the guardrail band and speeds drift gradually (`src/lib/turn/brettonWoodsTurn.ts`).
- Euro-union members trade as one euro currency in the volume lookback.
- Unfilled direct requests expire after `DIRECT_TRADE_EXPIRY_TURNS = 24`.
- A limit order partly filled keeps `status: "partial"`; spread is charged per tranche.

## Connections

Driven by:

- The central bank prime rate (`CentralBank.primeRate`, set by chair actions) is a direct input to the macro target. See [Monetary system as shipped](./monetary-system-as-shipped.md).
- [National metrics](./national-metrics.md) and the national budget: inflation, GDP growth and trade growth feed `computeMacroTarget()`.
- Chair spread strength and intervention reserves (`spreadFeeReserveBalances`, `forexRevenue`), also covered in [Money supply and QE](./money-supply-and-quantitative-easing.md).

Affects:

- [Corporations](./corporations.md): corporate money is stored in the corp's currency, and cross-border sector flows pay `SECTOR_FX_SPREAD`.
- [Stock market](./stock-market.md): foreign share trades settle in the stock's currency, converting from home currency at the market maker.
- [Sovereign bonds](./sovereign-bonds.md): coupon and FX depreciation effects on demand.
- Campaign funds and the wallet: personal balances are multi-currency, campaign funds are home currency only.

Last checked: 2026-10-29, version 1.18.0
