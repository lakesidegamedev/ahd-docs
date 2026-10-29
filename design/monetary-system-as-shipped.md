# Monetary System (as shipped)

Player guides: [Central Banks](https://www.ahousedividedgame.com/wiki/central-banks), [The FOMC](https://www.ahousedividedgame.com/wiki/fomc), [Currency Exchange](https://www.ahousedividedgame.com/wiki/currency-exchange), [Savings Interest](https://www.ahousedividedgame.com/wiki/savings-interest) and [Line of Credit](https://www.ahousedividedgame.com/wiki/line-of-credit).

Money in A House Divided runs on four connected systems: a central bank per currency that sets a prime rate through a voting committee, a forex market where every active currency floats against an internal anchor, savings that pay a real (inflation adjusted) rate, and a line of credit whose price is that same prime rate plus a credit spread. This page describes what is actually in the code today, with the real constants and the files they live in. One turn is one real hour (`MS_PER_TURN = 60 * 60 * 1000`) and a game year is 48 turns (`TURNS_PER_YEAR = 48`), both in `src/lib/constants/turnTime.ts`. Every rate and accrual below is expressed against that clock.

## Central banking: who holds the rate

Each currency has exactly one bank behind it. The mapping is explicit, not derived: `COUNTRY_CURRENCY_MAP` gives every country its home currency, and `CURRENCY_ANCHOR_COUNTRY` names the single country whose `exchangeRates` document and central bank are authoritative for that currency (both in `src/lib/constants/currencies.ts`). Scotland and Wales are sterlingized: they use GBP with the UK as anchor. The Soviet ruble (SUR) is anchored on RU and shared by BLR, UKR and BAL. EUR is anchored on DE, and IE keeps its own IEP so a 1953 Bretton Woods par with sterling can exist without colliding with the DM/EUR rate. The URL slug `/centralbank/[currency]` is resolved by `resolveCentralBankCurrency` in `src/lib/centralBank/currencyRouting.ts`, which also routes to the intorg API when the anchor bank is treaty run (the ECB).

Who may move the rate depends on the bank's independence. `src/lib/centralBank/governance.ts` encodes the historical case: the Bank of England had no operational independence until `BOE_INDEPENDENCE_YEAR = 1997`, so a UK world whose era START year is before 1997 opens with the Treasury setting Bank Rate. The default keys on the era start year, not the live year. A 1991 world that plays past 1997 does not flip on its own, because transferring monetary power is a statute: Parliament passes a `central_bank_independence` provision, and an explicit `bank.governmentControlled` written by legislation always wins. A country on a shared bank cannot legislate here at all (`canLegislateBankIndependence` returns false whenever the country config carries `sharedBankId`), so an ECB member cannot rewrite a treaty institution and a sterlingized Scotland cannot legislate over the Bank of England.

### Prime rate changes and their limits

`src/lib/monetaryPolicy/commands/updatePrimeRate.ts` is the single write path. It checks authority first: on a government controlled bank only the head of government or the finance seat (via `isNationalIssuer`) may act, and the chair is told plainly that the bank has no operational independence. On an independent bank only the seated chair may act, unless `chairControlsLocked` is set by an administrator. Admins bypass the limits; players do not. The limits, from `src/lib/db/types/centralBank.ts`:

- `MAX_RATE_CHANGE_DELTA = 0.75`: hikes are capped at +0.75pp per adjustment.
- `MAX_RATE_CUT_DELTA = 1.75`: cuts are capped at -1.75pp per adjustment.
- `AGGRESSIVE_CUT_SCRUTINY = 10`: a cut deeper than 0.75pp adds 10 to `chairInfamy`, capped at 100. If the government set the rate, the chair's infamy is untouched, since they had no hand in it.
- `RATE_CHANGE_COOLDOWN_TURNS = 6`: one change every 6 turns.
- `PRIME_RATE_STEP = 0.25` (rates snap to a quarter-point grid) and `PRIME_RATE_CEILING = 25`; the floor is 0. All in `src/lib/db/types/centralBank.ts`.
- Widened hike cap: `maxHikeDeltaFor(inflation - target)` returns `NPP_CHAIR_HIGH_INFLATION_HIKE_DELTA = 3` pp instead of 0.75 once inflation is at least `NPP_CHAIR_HIGH_INFLATION_GAP = 5` pp over target, for chairs, government setters and the committee alike (`src/lib/db/types/centralBank.ts`, shown to players by `src/lib/centralBank/rateLimits.ts`).

Every change appends to `rateHistory` with the previous rate, the new rate, who changed it and the stated reason, trimmed to the last 50 entries.

### The FOMC committee

Banks are committees, not lone chairs. `FOMC_BOARD_SIZE = 7` seats, `FOMC_TERM_TURNS = 192` (four game years), a meeting every `FOMC_MEETING_INTERVAL_TURNS = 8` turns (six meetings per game year), and player seats get `FOMC_PLAYER_VOTE_WINDOW_MS = 24 * 60 * 60 * 1000` of wall clock plus a hard turn deadline `FOMC_VOTE_WINDOW_TURNS = 24`.

`src/lib/centralBank/seedFomcBoard.ts` populates any bank without a board, one technocrat NPP per seat (role `fomcMember`), seat 0 the chair mirrored onto the bank's legacy single chair fields. Alignments alternate hawk, dove, hawk, dove across seats, and term expiries are staggered so roughly one seat opens per window instead of the whole board at once. A government controlled bank gets no committee: the MPC was created by the independence grant, so a pre-1997 Bank of England has no board until legislation seeds one.

The voting logic in `src/lib/centralBank/fomc.ts` is pure and deterministic. Each seat forms a view by running the same Taylor rule the autonomous chair uses (`computeNppChairRateTarget` and `computeNppChairRateStep` in `src/lib/nppAutonomy/nppChairAutoRate.ts`), tilted by its alignment. A step smaller than `FOMC_MOVE_THRESHOLD = 0.125`pp reads as a hold. The chair proposes a motion; when the chair cannot change the rate (per term cap, cooldown, command economy) the motion can only be a hold. `tallyMeeting` requires a strict majority of the FULL board, `majorityThreshold(7) = 4`. Seats that never cast a ballot abstain and count against the motion, so a divided or apathetic board holds. NPP seats auto vote their preference when the meeting opens; player seats vote live or abstain at resolution.

Alignment is temperament, not ideology. `src/lib/centralBank/chairAlignment.ts` defines `CHAIR_ALIGNMENT_POLICY`: a hawk multiplies the Taylor rule's inflation coefficient (1.5 for hawks), a dove weights growth harder and tolerates more inflation, and each side scales its own hike and cut step sizes. When no alignment is stored, `deriveChairAlignment` reads the technocrat's personality: stubbornness at or above ambition leans hawk, otherwise dove. `oppositeAlignment` flips the temperament on term expiry replacement so policy character changes over time.

### Nominations

`FomcNomination` (`src/lib/db/types/centralBank.ts`, lifecycle in `src/lib/fomcNominationLifecycle.ts`) is a President's nomination of a named nominee to a specific `seatId`, confirmed by the Senate through the same lifecycle as cabinet nominations. The nomination carries `makeChair`, the `occupantType` (a live player seat or an autonomous NPP seat) and the hawk or dove `alignment` the President assigns. On confirmation the nominee is installed into that seat on `fomcBoard`; on rejection the seat is untouched. The older executive path (`CentralBankNomination` plus `ChairSelectionPending`) still exists for chair picks that need the nominee's acceptance, and tracks which nominees declined this cycle so re selection skips them.

### The rate corridor readout

`src/lib/centralBank/rateCorridor.ts` answers one question at a glance: is the bank ahead of inflation? `corridorVerdict(primeRate, inflation)` takes the delta, and with `NEUTRAL_BAND = 0.5` calls it restrictive above +0.5pp, accommodative below -0.5pp, neutral in between, and writes the signed copy line. `inflationTrendLabel` reads the last `TREND_WINDOW = 12` observations and reports cooling, rising or steady on a `TREND_THRESHOLD = 0.15`pp move. Both are computed, never editorial.

### Reserves and the reserve currency ranking

A bank holds two pools: `reserveBalance` (home currency lending reserves) and `spreadFeeReserveBalances` (foreign currency accumulated from forex spread fees). `src/lib/centralBank/reservePortfolio.ts` builds the portfolio view, converting each foreign balance to the home currency through the live rate map (`convertCurrencyAmount` goes through the internal anchor: `amount / fromRate * toRate`) and reporting each currency's share of the FX reserve stack, plus home only, foreign only and total views.

`src/lib/centralBank/reserveCurrencyRanking.ts` ranks currencies by how much of them is held in reserves across every central bank. It deliberately counts only `spreadFeeReserveBalances`, not `reserveBalance`: the home lending reserve is a country stuffing its own currency into its own bank, and counting it would let one large domestic balance crown the leading exchange currency regardless of international demand. Totals are valued in the internal anchor (units divided by the rate) so currencies can be compared, and `getLeadingReserveCurrency` returns the number one, or null when no bank holds rankable FX reserves yet.

Rank pays. `RESERVE_CURRENCY_VOLATILITY_REDUCTIONS = [0.5, 0.25, 0.125]` in `src/lib/constants/currencies.ts` means the leading exchange currency trades 50% calmer, the second 25% calmer, the third 12.5% calmer, and everything else takes the full market jitter.

Chairs can move money between the two pools, with limits in `src/lib/centralBank/reservePoolTransfer.ts`: `RESERVE_POOL_TRANSFER_COOLDOWN_TURNS = TURNS_PER_DAY` (24 turns, one real day) and `RESERVE_POOL_TRANSFER_MAX_FRACTION = 0.5` of the source pool per action. Moving reserves out of lending is additionally capped so the 70% LOC pool stays at or above outstanding loans.

## Forex

Twenty-eight currencies trade: `FOREX_ACTIVE_CURRENCIES` (`src/lib/constants/currencyCodes.ts`) covers USD, GBP, JPY, EUR, IEP, CNY, BRL, NGN, SUR, RUB, DDM, FRF, ITL, ESP, SEK, TRL, GRD, ATS, FIM, PLZ, HUF, ROL, BGL, CSK, YUD, PLN, RON and BGN. Nigeria trades even while the country is still coming soon, because its sovereign bonds already settle in NGN and holders would otherwise be trapped; the same logic keeps the 1979 only countries exchangeable in every era. The bloc currencies (PLZ, HUF, ROL, BGL, CSK, YUD and their successors PLN, RON, BGN) are now in the active list.

Rates are quoted as local currency per one internal unit (₳). Higher rate means a weaker currency, which is why `computeStrengthVsReferencePercent` in `src/lib/forex/rateSemantics.ts` returns `(referenceRate / currentRate - 1) * 100` for strength while `computeRawRateVsReferencePercent` returns the plain rate change. Mixing the two is the classic way to read a devaluation as a rally.

### Trading costs

From `src/lib/constants/currencies.ts`:

- `MARKET_MAKER_SPREAD = 0.01` (1%) for an instant market trade.
- `LIMIT_ORDER_SPREAD = 0.0064` (about 0.64%) for a limit order.
- `DIRECT_TRADE_SPREAD = 0.0036` (about 0.36%) for a direct player to player trade, with `DIRECT_TRADE_EXPIRY_TURNS = 24`.
- `SECTOR_FX_SPREAD = 0.005` (0.5%, half the market maker rate) on cross currency sector flows, so multinational operations carry real FX friction without hitting core business income as hard as a market trade.

A chair can dial the fee charged when their own currency is sold, between `FOREX_SPREAD_STRENGTH_MIN = 0.5` and `FOREX_SPREAD_STRENGTH_MAX = 1.5` (default 1.0), once every `FOREX_SPREAD_STRENGTH_COOLDOWN_TURNS = 48`. Higher means more reserve income and more capital flow friction but less liquidity and less reserve appeal; lower means the opposite.

### How the rate moves each turn

`src/lib/currency/rateCalculation.ts` combines three components. First, macro drift toward a fundamental target at `DRIFT_SPEED = 0.05` per turn (about 48 turns to 90% convergence). The target uses `PRIME_RATE_SENSITIVITY = 0.02`, `INFLATION_SENSITIVITY = 0.015`, `GDP_GROWTH_SENSITIVITY = 0.01` and `TRADE_GROWTH_SENSITIVITY = 0.005`, each measured against an era aware baseline resolved by `resolveMonetaryBaseline` from `src/lib/constants/monetaryEra.ts` keyed on the current in game year, so a 1953 world at 1955 is not judged against late 1970s inflation targets.

Second, a separate absolute inflation term. Because the inflation sensitivity measures deviation from each currency's OWN target, a currency with a deliberately high baseline (Italy, Turkey, Sweden in the late 1970s profiles) would otherwise sit at par despite crippling inflation and pay a free real carry. `ABSOLUTE_INFLATION_DEPRECIATION_THRESHOLD = 6.0`pp sets a healthy inflation ceiling and `ABSOLUTE_INFLATION_SENSITIVITY = 0.015` weakens the currency per excess point above it. Developed markets around 1 to 2% inflation are unaffected.

Third, player flow and noise. Volume pressure uses `VOLUME_PRESSURE_SENSITIVITY = 0.0001`, caps at `VOLUME_PRESSURE_CAP = 0.05` (plus or minus 5%), looks back `VOLUME_LOOKBACK_TURNS = 24`, and accounts for `VOLUME_DIRECTION_WEIGHT = 0.2` of the movement direction against 80% macro. Random jitter is `RATE_NOISE_MAX = 0.004` (plus or minus 0.4%) per turn, scaled down by the reserve currency multiplier above. On top of that, each currency rolls a directional regime every `CYCLE_PRESSURE_TURNS = 12` (about 12 hours) from `CYCLE_PRESSURE_BY_REGIME`: plus or minus 0.0015 per turn for moderate, plus or minus 0.0007 for slight, zero for neutral. A sustained regime settles only about pressure divided by `DRIFT_SPEED` off the macro target (roughly 3% moderate, 1.4% slight), so fundamentals generally win. Everything is finally clamped to `RATE_FLOOR_MULTIPLIER = 0.5` and `RATE_CEILING_MULTIPLIER = 1.5` of the base rate.

### Era anchored starting rates

Seed rates live in four authored tables in `src/lib/constants/currencies.ts`: `INITIAL_RATES` (2019, the `STARTING_YEAR`), `INITIAL_RATES_1991`, `INITIAL_RATES_1979` and `INITIAL_RATES_1953`. The 1953 table is Bretton Woods par: GBP 0.357 (the $2.80 par), JPY 360.0 (the Dodge Line peg fixed 1949 to 1971). The 1991 table uses IMF IFS annual averages: GBP 0.57, JPY 134.5, CNY 5.32, NGN 9.9, and a DEM to EUR equivalent of 0.85 derived through the fixed 1.95583 DEM per EUR parity. Brazil is deliberately excluded from 1991 (cruzeiro hyperinflation makes a parity meaningless) and keeps the 2019 BRL 5.0 as a divide by zero guard. The 2019 table has USD 1.0, GBP 0.75, JPY 106.0, EUR 0.92, BRL 5.0, CNY 7.2, NGN 1550.

`getInitialRatesForYear(year)` covers everything between. It returns the authored table unchanged at an anchor year, so 1953, 1979, 1991 and 2019 worlds are byte identical, clamps below the first anchor and above the last rather than extrapolating, and otherwise interpolates GEOMETRICALLY between the two surrounding anchors (`exp(log a + (log b - log a) * t)`). Exchange rates compound: straight line interpolation put Nigeria at roughly 450 naira in 1999 against a real rate near 97, while the geometric mean gives about 42. A country present in only one anchor keeps that anchor's rate, since a missing entry means "not authored", not "no currency".

## Savings and the real rate

Savings pay half the REAL prime rate. `savingsApyPercent` in `src/lib/currency/savingsInterest.ts` is `max(SAVINGS_REAL_RATE_FLOOR_PERCENT, prime - inflation) / 2` with `SAVINGS_REAL_RATE_FLOOR_PERCENT = 0.5`, so the floor APY is 0.25%. Paying the real rate rather than the nominal prime is what closes the carry trade: a currency with a high nominal prime also has high inflation, so its real spread, and therefore its APY, ends up near everyone else's, and parking money in a high nominal currency no longer yields a free real return. The floor is uniform across every currency, so it confers no cross currency advantage and cannot be arbitraged.

Accrual is simple, per turn: `balance * (apy / 100) / TURNS_PER_YEAR`, rounded to whole yen for JPY and two decimals otherwise (`roundSavingsAmount`). Interest accrues every turn but is credited to the balance once every `SAVINGS_CREDIT_INTERVAL_TURNS = TURNS_PER_YEAR / 4 = 12` turns (a game quarter); `turnsUntilSavingsCredit` drives the countdown players see.

One more guard: `SAVINGS_POOL_SHARE_CAP = 0.25`. Interest accrues only on the lesser of the account's balance and 25% of the whole national pool for that currency (`interestEligibleBalance`), so a single actor cannot become nearly all of a currency's savings and farm the entire pool's interest. It binds only on accounts above that share; ordinary savers never feel it. The national pool is summed by `sumSavingsInCurrency` in `src/lib/savings/nationalTotals.ts`, which adds per currency `currencyBalances.savings` buckets plus the legacy `savingsOnHand` for pre migration characters in the anchor country. Every credit, deposit and withdrawal writes a `savingsLedger` row via `src/lib/savings/ledger.ts` with the balance after, so the player's statement is a real ledger, not a recomputation.

## Lines of credit

A LOC is priced off the same prime rate the central bank sets, plus a spread that depends on the borrower. `spreadPercentPointsFromComposite` in `src/lib/lineOfCredit/creditMath.ts` maps a 0 to 100 credit composite to `5 - (composite / 100) * 6`: +5pp over prime at the bottom, -1pp under prime at the top. The composite blends income and wealth. `incomeScoreFromPerTurnCurrency` annualizes one turn of personal inflow (salary and dividends, not campaign funds) through a saturating `100 * (1 - exp(-annual / 2_500_000))`; `netWorthScoreFromInternal` does the same on internal unit wealth with a 4,000,000 scale. `userCreditComposite` weights 75% corporate composite plus 25% income for a CEO, or 50/50 income and net worth otherwise. `applyDebtLeveragePenalty` subtracts up to 30 points as debt to assets rises (`ratio * 38`, capped), and `applyPrimeEnvironmentToComposite` pushes the composite down when prime sits above baseline, partly shielding wealthier borrowers.

Interest is simple per turn on principal plus arrears: `computeLocInterestForTurn` charges `(obligation * (prime + spread) / 100) / TURNS_PER_YEAR` and the caller adds it to arrears. Repayment is automatic at `LOC_PER_TURN_PAYMENT_RATE = 0.01625 / 4` (about 0.40625% of the obligation per turn). The derivation is a real world rule of thumb: roughly 1.625% of principal per month on a modest fixed rate loan, and one game month is four turns. Over about 23 game years a zero interest loan is about 99% repaid. A borrower can flip a currency's account to interest only mode, which pays arrears alone and leaves principal flat, at the cost of `LOC_IO_SURCHARGE_PERCENT_POINTS = 2.0` extra on the annual rate for that currency, and mode flips are gated by `LOC_PAYMENT_MODE_COOLDOWN_TURNS = 24` (one real day).

Three caps bound borrowing, all in `src/lib/lineOfCredit/locMath.ts`. System wide, one currency exchange may lend at most `LOC_DEPOSIT_FRACTION = 0.7` of its savings deposits plus reserves, and `availableForExchangeInternal` subtracts every borrower's outstanding principal and arrears from that. Per player, `LOC_DTI_MAX_FRACTION = 0.7` caps the scheduled per turn payment at 70% of per turn income, which inverts to a maximum principal of `(0.7 * income_per_turn) / LOC_PER_TURN_PAYMENT_RATE`; income of zero means a limit of zero, since borrowing requires verified income. Second, `LOC_NET_WORTH_LIMIT_MULTIPLIER = 1` caps total exposure at current economic equity, and because net worth already excludes current LOC debt, debt funded bond or stock purchases cannot recursively inflate the ceiling. Payments allocate to arrears first, then principal, in a stable currency order.

## Money supply aggregates

`src/lib/moneySupply/rules/calculate.ts` assembles M1 from every liquid pot: household, campaign, NPP, corporate, party, government, fund and organization balances. M2 adds household savings, `externalBroadMoney`, and bank deposits. Bank reserves are tracked as a capacity measure and reported separately. Negative and non finite components are normalized to zero before summing.

Growth is annualized geometrically: `(closing / opening) ** (TURNS_PER_YEAR / turnsElapsed) - 1`. It returns null, not zero, when the base is missing or the window is shorter than `MIN_MONEY_GROWTH_BASE_TURNS = 12`. Annualizing a bootstrap rebase over two turns raises the ratio to the 24th power and produces meaningless percentages, and returning null (rather than 0) makes downstream consumers fall back to GDP growth instead of reading a false "money supply is frozen".

Open market operations live in `src/lib/moneySupply/quantitativeEasing.ts`. `planOpenMarketOperation` clamps requested units to what is actually available (public float for QE, central bank holdings for QT), prices the consideration at face value times market price, and reports a `moneySupplyDelta` positive for QE and negative for QT. Accumulated holdings feed `applyQePriceSupport`, a persistent demand support of up to 20% on the rate derived bond price (`min(0.2, qeSupportRatio * 0.5)`), with the final price clamped between 0.05 and 2.

Autonomous banks act through `chooseNppMonetaryOperation` in `src/lib/moneySupply/nppPolicy.ts`, which compares inflation to `getInflationTarget`, compares annualized M2 growth to GDP growth (only when the growth reading is reliable), and picks QE, QT, a treasury advance, a liquidity injection or a hold. The emergency paths are bounded: `MONETARY_OPERATION_COOLDOWN_TURNS = 6`, `DIRECT_ADVANCE_GDP_CAP = 0.01` and `LIQUIDITY_INJECTION_GDP_CAP = 0.03` in `src/lib/moneySupply/operations.ts`. A treasury advance requires a genuine slump: inflation at least 3pp under target, GDP growth at or below -3%, and a treasury balance worse than half of GDP in deficit.

## Worked examples

- Rate move: prime 4.00%, inflation 3.0%. Savings APY is `max(0.5, 4.00 - 3.0) / 2 = 0.5%`, a quarterly credit of `balance * 0.005 / 4` per game quarter. Hike 0.75pp to 4.75% with inflation unchanged: APY becomes `(4.75 - 3.0) / 2 = 0.875%`, and a LOC borrower with composite 50 (spread `5 - 0.5 * 6 = +2pp`) goes from 6.00% to 6.75% a year.
- Forex trade: selling 10,000 local units at market costs 1% (`MARKET_MAKER_SPREAD`), so 100 units go to the bank's spread-fee reserves; the same trade as a limit order costs 0.64% and a direct trade 0.36%.
- Why a cut can be 1.75 but a hike only 0.75: cutting fast is a political risk (chair infamy rises 10 for any cut deeper than 0.75), while a slow hike is the safer default. The cap only widens when inflation is already well over target.

## Timing

One turn, in order (`src/simulation/phases/turnPhaseRegistry.ts`, `src/simulation/phases/stateEffectsPhase.ts`):

1. `savingsInterestTurn` accrues savings interest at the prime and inflation left by the previous turn. Quarterly credit lands when `turn % 12 == 0`.
2. `lineOfCreditTurn` charges LOC interest at prime plus spread and takes the automatic payment. It needs the same turn's `corporationTurn` currency income when forex is enabled.
3. Inside `stateEffectsAndNationalAggregation`: `inflationRecalc`, then `forexTurn` (rates, limit orders, spread revenue; skipped when forex is off), then `centralBankChairTurn`, `fomcMeetings` (opens and resolves meetings every 8 turns), `nppMonetaryOperations`, `centralBankChairExecutiveRemoval`, `centralBankChairSelection`.
4. `moneySupplySnapshot` closes the turn.

A prime rate set on turn T therefore first affects forex drift on turn T+1 and savings and LOC interest on turn T+1. Player chair rate changes are written immediately by `updatePrimeRate` and are subject to the 6-turn cooldown; committee decisions land when `fomcMeetings` resolves a meeting.

## Edge cases and limits

- Rates snap to 0.25pp; the floor is 0 and the ceiling 25.
- A government controlled bank (pre-1997 Bank of England by default) has no committee and only the head of government or finance seat can move the rate.
- A shared bank (ECB, sterlingized Scotland and Wales) cannot legislate independence.
- Tied or partial committee votes hold: a motion needs 4 of 7 votes, and absent seats count against it.
- Savings real rate floor of 0.5 gives a 0.25% APY floor even in deflation or negative real rates.
- A single actor earns interest only on up to 25% of the national savings pool in a currency.
- LOC: no verified income means a limit of zero; scheduled payments cannot exceed 70% of per-turn income.
- Forex off (`gameState.forexEnabled` false): `forexTurn` is skipped with a recorded reason, so exchange rates do not move.
- Forex rate is clamped between 0.5x and 1.5x of the base (seeded era) rate.
- Money-supply growth readings are `null` until 12 turns of history exist (see [Money Supply and QE](./money-supply-and-quantitative-easing.md)).

## Connections

Driven by:

- [National Budget](./national-budget.md): the inflation rate and GDP growth feed the Taylor rule (`src/lib/nppAutonomy/nppChairAutoRate.ts`), the savings real rate and the forex macro target (`src/lib/currency/rateCalculation.ts`).
- [Elections](./elections.md) and [Cabinet](./cabinet.md): who sits as head of government, finance seat and Senate confirmer decides who may set the rate or fill an FOMC seat (`src/lib/fomcNominationLifecycle.ts`).
- [Tariffs](./tariffs.md) and trade: trade growth enters the forex target.

Affects:

- [National Budget](./national-budget.md): the prime rate sets the `monetary` inflation term and the interest cost on debt.
- [Sovereign Bonds](./sovereign-bonds.md): bond prices derive from the prime rate; QE and QT are covered in [Money Supply and QE](./money-supply-and-quantitative-easing.md).
- [Currency Exchange](./currency-exchange.md): the prime rate sets drift, and spread fees fill the reserve stack that ranks reserve currencies.
- Player wealth: savings APY and LOC cost change personal cash flow every turn.

## How it fits together

The prime rate a chair or committee sets is not a dial in isolation. It feeds the macro target that moves the currency's exchange rate, it sets the savings APY through the real rate formula, and it sets the base cost of every line of credit in that currency. Savings deposits in turn become the lending pool that limits how much credit exists, and the fees on forex trades become the reserve stack that decides which currency is the leading exchange currency and therefore trades calmest. A hike tightens credit, strengthens the currency, pays savers more in real terms and shrinks the borrowing pool through the DTI cap. Nothing in that chain is a special case: it is the same numbers read by different systems.

Last checked: 2026-10-29, version 1.18.0
