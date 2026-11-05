# Units, money and time as shipped

Reference for what every money and quantity number in the game is measured in: which currency, what time period, and whether the era changes its scale. Grounded in `origin/development` as of 2026-11-05. When this page and the code disagree, the code wins.

Related: [Currency exchange](./currency-exchange.md), [Budget calculations](./budget-calculations.md), [Commodities](./commodities.md).

## Summary

- Money is stored in the owner's own currency. The anchor unit (₳) is only used to compare or add up across countries.
- One turn is one game week. 48 turns make a game year. Budgets are annual; corporate flows are per turn.
- A 1953 world is priced in 1953 money, about 70 times smaller than 2019. Never compare raw amounts across eras.

## The three unit systems

1. **Anchor (₳).** The internal unit. It tracks the US dollar of the era. Cross-country sums, rankings and "world" numbers are in ₳.
2. **Local currency.** Most stored money is local: the country's `COUNTRY_CURRENCY_MAP` currency (US USD, UK GBP, JP JPY, DE EUR, IE IEP, BR BRL, CN CNY, and so on; SCO uses GBP). Corporate and personal money is in the owner's currency (`liquidCurrencyCode`, `currencyCode`).
3. **Era-scaled amounts.** A 1953 world is denominated in 1953 dollars, about 70x smaller nominally than 2019. Absolute ₳ constants calibrated on modern GDP are deflated by the era scale (below). Do not compare raw money across presets.

FX direction: `exchangeRates.rate` is **local currency per 1 ₳**. To get ₳, divide local by rate. To get local, multiply ₳ by rate.

## Period: turns, days, years

- 1 turn = 1 game week = 1 real hour (`MS_PER_TURN`). 48 turns = 1 game year (`TURNS_PER_YEAR`, 1 turn is also 1/48 of a fiscal year).
- Annual budget lines are stored per fiscal year. The treasury deducts them at 1/`TURNS_PER_YEAR` per turn.
- Bond coupons are quoted annual (`couponRate` %) and paid per turn as annual / `TURNS_PER_YEAR`. `maturityTurns` is in turns (48 = 1 year).
- `commodityPrices` supply and demand fields are documented as units per day, not per turn. Do not multiply by turns without checking the consumer.

## Field table

| Field / collection | Unit | Period | Era scaling |
|---|---|---|---|
| `corporationHistory` money fields (`revenue`, `income`, `marketCap`, `sharePrice`, `liquidCapital`) | Local, in the row's `currencyCode` (corp's `liquidCurrencyCode`). Rows with no `currencyCode` predate v0.2.6 and are ₳. | One snapshot per turn; flows are per turn, stocks are at snapshot | Money is already in the era's own nominal terms |
| `corporationHistory.fxRateAtWrite` | Local per ₳ at write time | Per turn | Use this to convert back to ₳, never today's rate |
| `corporationHistory.corporateTaxPaid`, `perTurnBondCouponIncome` | ₳ (typed as ₳/turn in the schema) | Per turn | None. Note the other money fields on the same row are local, so these two differ; check the schema comment before mixing them |
| `federalBudget` (`revenue`, `spending`, `surplus`, `debt`) | Country-local currency (`currencyCode` on the doc) | Annual (per fiscal year); treasury applies 1/48 per turn | Seed GDP basis varies by era, see below |
| `federalBudget.gdp` | Local currency units, sum of state GDP x 1M | Annual rate (stock of output per year) | Stored in the era seed's own denomination |
| `federalBudget.treasuryBalance` (national cash) | Local currency, signed | Stock | None |
| `federalBudgetSnapshots` | Same as `federalBudget`, frozen at fiscal year boundary. `budget.currencyCode` may be absent on old rows: derive from country | Annual | Same |
| law cost `annualCostUsd` | Local currency despite the name | Annual | Per-capita costs scale through `COST_SCALE_ANCHORS` and the GDP-indexed cost scale |
| `bonds` (`faceValue`, `totalIssued`) | Bond's `currencyCode` (sovereign: issuer country currency; corporate: issuer's `liquidCurrencyCode`). Absent `currencyCode` means pre-migration ₳. Schema comment says "dollars" for `faceValue`, ignore that | Stock | None |
| `bonds.couponRate` | Annual percent | Annual, paid per turn | None |
| `bonds.marketPrice` | Fraction of face (1.0 = par) | Spot | None |
| `bonds.maturityTurns` | Turns | n/a | None |
| `characters.wealth.personal` | Map of currency to amount, local per currency, missing key = 0 | Stock | None |
| `characters.wealth.campaign` | Character's home currency, local | Stock | None |
| `characters.wealth.savings` | Map of currency to amount, interest tied to that currency's prime rate | Stock, interest accrues per turn and credits quarterly | None |
| `exchangeRates.rate` | Local currency per 1 ₳ | Spot, one row per country | `baseRate` is the era calibration and never changes |
| `exchangeRates.buyVolume24`, `sellVolume24` | ₳ (internal units) | Trailing 24 turns | None |
| `commodityPrices.globalPrice`, `statePrices`, `nationalPrices` | ₳ per unit of the commodity | Spot per turn | Base price table is 2019 dollars. In non-2019 eras the unit basis is rescaled by `getEraUnitScale` (about 70 for 1953) |
| `commodityPrices.globalSupply`, `globalDemand`, state/national variants | Commodity units | Documented per day | Unit counts are multiplied by the era unit scale in plants math |
| `producerMarketOutcomes.clearingPrices`, `laneClearingPrices` | ₳ per unit (world book value / units) | Per turn | Same unit basis as commodity prices |

## Era and GDP scaling

- **`gdpAnchorRate`** (`getGdpAnchorRate(countryId, preset)`): ₳ per one unit of the country's stored GDP. It reads `usdExchangeRate` from the country config for the preset. It is **not** an FX quote and not the `exchangeRates` collection. It converts whatever denomination the era's seed was authored in into ₳. Example: UK 2019 stores 1.0 even though the UK FX row is about 0.75 GBP/₳, because the UK seed is in dollars. IT, JP, CN, NG 1953 seeds are authored in USD millions so their 1953 rate is 1.0. Unknown country returns 1. Always pass the world preset.
- **`getEraNominalScale(preset)`**: US national seed GDP of the era over 2019 (`US_NATIONAL_SEED_GDP_BY_ERA`: 1953 is 387B, 2019 is 27,000B), so 1953 is about 0.0143. Every other preset returns 1.
- **`getEraUnitScale(preset)`**: reciprocal of the nominal scale, about 70 for 1953, exactly 1 for every other preset. Multiply unit counts by it, or divide per-unit ₳ by it. Both legs of a stored (revenue, units) pair must use the same scale.
- **`COST_SCALE_ANCHORS`** (budget/costs): per country scaleLow/scaleHigh and the 1991 and modern GDP-per-capita anchors. Law costs ramp between them with national GDP per capita, and below the 1991 anchor shrink in proportion. Countries not in the table get scale 1 (US, UK, JP, DE, IE, CN, BR, NG are listed).
- **Sector seed floor**: `MODERN_MIN_UNOWNED_SECTOR_REVENUE` is ₳1,000,000, deflated for 1953 (`SECTOR_SEED_ERA_FLOORS`: 15,000). Keyed on the seed preset, not the current year.
- Active preset: `gameState` doc `_id: "current"`, field `preset`. Falls back to `2019-default`.

## Common mistakes

- Summing `corporationHistory` money across corps in different currencies without converting by `fxRateAtWrite`.
- Reading `federalBudget` numbers as ₳ or as dollars. They are the country's own currency, annual.
- Treating annual budget lines as per-turn, or per-turn corp flows as annual. Divide or multiply by 48 on purpose.
- Using `exchangeRates.rate` to rescale GDP. Use `gdpAnchorRate`.
- Comparing 1953-world prices or revenue with 2019 without the era scale.

