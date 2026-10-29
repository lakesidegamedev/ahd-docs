# Fundraising & Ads

## Summary

Campaign funds pay for advertising, campaigning, donor building and party operations. This page is the exact rules for earning funds (per-turn generation, the Fundraise action, the campaign page income) and spending them on ads and related actions.

Player guide: [Fundraising & Ads](https://www.ahousedividedgame.com/wiki/fundraising-ads)

There are two related but separate income systems: **personal character campaign funds** (`src/lib/utils/fundGeneration.ts`, run by `src/lib/turn/fundGeneration.ts`) and **candidate campaign funds** (`src/lib/campaigns/`). Money constants below are in anchor currency (₳) and converted to the player's local campaign currency at the write boundary. Starting campaign funds are 250,000 (`gameConfig.startingFunds`, `src/lib/seeds/reference/gameConfig.ts`); the one-time onboarding reward is 20% of that, 50,000 (`ONBOARDING_REWARD_FRACTION`, `src/lib/onboarding/reward.ts`).

## Rules

### Per-turn fund generation (personal funds)

Gross generation per turn, before party tax (`getTotalFundGeneration`, `src/lib/utils/fundGeneration.ts`):

```
gross = round((baseRate + donorBonus) x gdpScalar x priceLevel) + round(officeBonus x priceLevel)
donorBonus = DONOR_BASE_BONUS_PER_LEVEL[tier] x donorBaseLevel x influenceMultiplier
influenceMultiplier = 1 + clamp(stateInfluence, 0, 100) / 100      // 1.0 at 0%, 2.0 at 100%
gdpScalar = clamp(statGdpPerCapita / countryBaseline, 0.9, 1.5)
```

`stateInfluence` is the character's `politicalInfluence` field, passed in by the turn (`projectCharacterGeneration`).

| Tier | State population | Base rate per turn | Donor bonus per level per turn |
| --- | --- | --- | --- |
| Small | under 2,000,000 | 5,000 | 100 |
| Medium | 2,000,000 to under 8,000,000 | 10,000 | 200 |
| Large | 8,000,000 to under 20,000,000 | 20,000 | 400 |
| Mega | 20,000,000 and over | 40,000 | 800 |

`priceLevel` is the era deflator (1 in the modern era), from `resolveCampaignPriceLevel` (`src/lib/campaigns/rules/priceLevel.ts`). The office bonus is flat and ignores state wealth.

| Office | Bonus per turn | Constant key |
| --- | --- | --- |
| US House, UK Commons, Bundestag | 5,000 | `house`, `commons`, `bundestag` |
| US State Senate, Landtag | 3,000 | `stateSenate`, `landtag` |
| US Senate, Governor, Minister-President | 15,000 | `senate`, `governor`, `ministerPresident` |
| Vice President | 25,000 | `vicePresident` |
| President, Prime Minister, Chancellor | 50,000 | `president`, `primeMinister`, `chancellor` |
| Parliamentary cabinet, UK cabinet minister | 5,000 | `parliamentaryCabinet`, `ukCabinet` |

All in `OFFICE_FUND_BONUS`, `src/lib/utils/fundGeneration.ts`.

### Party tax

Both the state party tax and the national party tax are taken from gross generation: `floor(gross x rate / 100)` each, and the character receives `gross - stateTax - nationalTax` (`src/lib/turn/fundGeneration.ts`). `MAX_TAX_RATE = 33`; a rate above 33 yields no tax (`calculateTaxAmount`). Independents pay no tax. Each tax credits the matching party treasury. The Fundraise action credits its full yield and is not routed through this tax.

### Fundraise action

- Cost: `FUNDRAISE_ACTION_COST = 3` action points, no funds (`src/lib/actions/rules.ts`).
- Yield: `round(round((50,000 + 2,000 x donorBaseLevel) x influenceMultiplier x priceLevel) x statMultiplier(fundraising))`.
- Eligibility: donor base level must be at least 1 (`isFundraiseEligible`).
- `statMultiplier(stat) = 1 + (clamp(stat, 1, 10) - 5.5) x 0.04` (`EFFICACY_PIVOT = 5.5`, `EFFICACY_SLOPE = 0.04`, `src/lib/stats/statsConstants.ts`), so 0.82 at stat 1, 1.0 at 5.5, 1.18 at 10.

### Build Donor Network (`BuildDonorBase`)

- Action points: `min(20, round(4 + (level / 75)^1.4 x 16))`. L0 4, L10 5, L25 8, L50 13, L65 17, L75 20.
- Funds: `round(round((3,000 + 1,500 x level) x gdpScalar / 1,000) x 1,000 x priceLevel)`, with `gdpScalar = clamp(gdpPerCapita / baseline, 0.85, 2.0)`. Constants `BUILD_DONOR_BASE_FUND = 3,000`, `BUILD_DONOR_BASE_FUND_PER_LEVEL = 1,500`; the fundraising stat applies a cost-curve discount in the quote.
- Gain: `BUILD_DONOR_BASE_LEVEL_GAIN = 1` level per action. The design range is 0 to 75; total 0 to 75 is about 4.4M at national-average GDP.

### Advertise (Run Advertisements)

- Action points by current favorability (`getAdvertiseActionCost`): under 30 costs 5, 30 to 49 costs 6, 50 to 69 costs 7, 70 to 84 costs 8, 85 and over costs 9.
- Funds: `round(round(100,000 x (1 + tier x 0.2) x gdpScalar / 1,000) x 1,000 x priceLevel)` where `tier = AP cost - 5` (0 to 4) and `gdpScalar` is clamped 0.85 to 2.0 (`ADVERTISE_BASE_FUND_COST = 100,000`, `getFundMultiplier`).
- Favorability gain: `max(1, floor((3 - penalty) x statMultiplier(charisma)))`, `penalty = 0.1 x (favorability - 70)` above 70, else 0 (`advertiseFavorabilityGain`).
- Advertise is untargeted. It raises the buyer's own overall favorability; there is no demographic selector in the quote or execution (`quoteAdvertiseAction`, `src/lib/actions/commands/executeAction.ts`). Demographic reach comes from policy alignment and canvassing, see [demographics targeting](./demographics-targeting.md) and [canvassing](./canvassing.md).
- Newsroom slant discount (only when `mediaEditorialEnabled` is true, and only if the state has media sectors): `priceFactor = 1 - 0.15 x closeness` and `favorabilityFactor = 1 + 0.15 x closeness`, with `closeness = max(0, 1 - distance / 0.5) x slantStrength` (`SLANT_MAX_PRICE_DISCOUNT`, `SLANT_MAX_FAVORABILITY_BONUS`, `src/lib/mediaEditorial/slant.ts`). Cost falls to as low as 85%, gain rises up to 115%.
- Boosting another player: Campaign and Advertise priced as the equivalent self-action times `EXTERNAL_BOOST_PREMIUM = 1.25`; attacks use `EXTERNAL_ATTACK_PREMIUM = 1.5` (`src/lib/influence/rules.ts`). That file applies no home-state or adjacency tier.

### Campaign action

- Action points by state political influence (PI): under 20 costs 1, 20 to 39 costs 2, 40 to 59 costs 3, 60 to 79 costs 4, 80 and over costs 5 (`getCampaignActionCost`).
- Funds: `round(round(20,000 x tier x (1 + (tier - 1) x 0.2) x gdpScalar / 1,000) x 1,000 x priceLevel)` (`CAMPAIGN_BASE_FUND_COST = 20,000`).
- PI gain: `max(0.1, (1 - penalty) x effectiveness)` with `penalty = (PI - 50) / 75` above 50 (`campaignInfluenceGain`). Not allowed at PI 100 (`CAMPAIGN_MAX_INFLUENCE`).
- PI decay: 0.75% of current PI per turn (`POLITICAL_INFLUENCE_DECAY_RATE = 0.0075`, `shared/constants/formulas.ts`), multiplied by `2 - approval / 100` for members of the party holding the national executive (2.0 at 0% approval, 1.5 at 50%, 1.0 at 100%).

### Personal Campaign Donation (`ConvertCash`)

- Cost: `CONVERT_CASH_ACTION_COST = 2` action points plus the chosen amount of personal cash.
- Campaign funds credited: `floor(amount x 0.5)` (`CONVERT_CASH_RATE`). The other half is lost to the transfer; it does not stay as cash.
- Infamy: `min(100, round(15 x (amount / 1,000,000)^0.564))`, about 4 at 100,000, 15 at 1,000,000, 55 at 10,000,000.

### Campaign page income

Candidate campaigns have their own per-turn passive income (`src/lib/campaigns/income.ts`, `src/lib/campaigns/upgradeCosts.ts`):

| Fundraising level | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Base income per turn | 20,000 | 35,000 | 60,000 | 100,000 | 150,000 | 200,000 | 350,000 | 600,000 | 1,000,000 | 2,500,000 | 5,000,000 |

(`FUNDRAISING_INCOME`.) Income is multiplied by a race-family scalar (`CAMPAIGN_FAMILY_SCALAR_BY_ELECTION_TYPE`): president 1.0; senate, governor, commons, shugiin, sangiin, bundestag and NPC delegate 0.5; ministerPresident and landtag 0.4; house, regional council and people's congress 0.3; special commons 0.3; state senate 0.2; unknown types 1.0. A started Strategic Operations fundraising tree replaces the legacy level table. Upgrade costs and maintenance are in [campaign strategy](./campaign-strategy.md).

## Data

| Collection | Fields read | Fields written | Player-visible |
| --- | --- | --- | --- |
| `characters` | `donorBaseLevel`, `politicalInfluence`, `favorability`, `infamy`, `stats.fundraising`, `stats.charisma`, `currentOffice`, `homeState`, `party`, `funds` or `currencyBalances.campaign`, personal cash | `funds` or `currencyBalances.campaign` (income, action costs, ConvertCash credit), `donorBaseLevel`, `favorability`, `politicalInfluence`, `infamy`, personal cash, action points | Yes: own stats, funds and actions |
| `states` | `population`, `gdp`, `countryId` | none | Yes (state pages) |
| `politicalParties` | `nationalTaxRate` | `treasury` (national tax credit) | Treasury yes, on party pages |
| `statePartyOrg` | `stateTaxRate` | `treasury` (state tax credit) | Treasury yes, on party pages |
| `campaigns` | `fundraisingTree`, `fundraisingLevel`, election type | campaign funds (income per turn) | Yes (campaign page) |
| `gameConfig` | `campaignEraPriceLevelEnabled`, `mediaEditorialEnabled` | none | No |
| `gameState` | `preset`, `forexEnabled` | none | No |
| Financial and treasury ledgers | none | `office_income` and `party_dues_received` entries, treasury `fund_generation` credits | Own entries only |

Money constants are in anchor currency and converted to the player's local campaign currency when written (`campaignAnchorToLocal`, `src/lib/campaigns/campaignCurrency.ts`). Taxes are computed after that conversion, in local units.

## Configuration

| Setting | Default | Where set | Effect |
| --- | --- | --- | --- |
| `gameConfig.campaignEraPriceLevelEnabled` | true on fresh worlds (absent or false means price level 1) | `src/lib/seeds/reference/featureFlagDefaults.ts` | Applies the era price level to income, costs and Fundraise yield |
| `gameConfig.startingFunds` | 250,000 | `src/lib/seeds/reference/gameConfig.ts` | Opening campaign funds; also sizes the onboarding reward |
| `gameConfig.mediaEditorialEnabled` | true on fresh worlds | `src/lib/seeds/reference/featureFlagDefaults.ts` | Enables the newsroom slant discount on Advertise |
| `gameState.preset` | world preset (`2019-default` fallback) | World reset; fallback in `src/lib/constants/seedPreset.ts` | Picks the GDP baseline era and the price level |
| `gameState.forexEnabled` | world-specific | World config | Chooses `currencyBalances.campaign` over legacy `funds` as the credited field |
| Party tax rates | 0 | Party (`nationalTaxRate`) and state party (`stateTaxRate`) settings, capped at 33 | Share of gross income sent to treasuries |
| Era price level table | 2019 is 1 | `ERA_PRICE_LEVEL`, `src/lib/campaigns/rules/priceLevel.ts` | See table below |
| `politicalMediaMarketEnabled` | false, hard-coded | `src/lib/actions/commands/executeAction.ts` | Corporation-backed ad orders are off |

`ERA_PRICE_LEVEL` (`src/lib/campaigns/rules/priceLevel.ts`):

| Era | 1953 | 1979 | 1991 | 1999 | 2007 | 2019 | 2023 | 2027 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Price level | 0.03673 | 0.16688 | 0.35808 | 0.49707 | 0.6562 | 1 | 1.14996 | 1.28579 |

An unknown preset resolves to 1. The level multiplies income, the flat office bonus, Fundraise yield and the money cost of Campaign, Advertise and Build Donor Network. It is applied after the GDP scalar and rounding to the nearest 1,000.

## Timing

- Per-turn generation runs in `processFundGeneration` (`src/lib/turn/fundGeneration.ts`), called from `src/simulation/phases/turnPhaseRegistry.ts`.
- Fundraise, Build Donor Network, Advertise, Campaign and ConvertCash run immediately when the player acts (`executeAction`), not in a turn phase.
- PI decay runs in the action refresh each turn (`src/lib/turn/actionRefresh.ts`).
- Campaign page income is added per turn by the campaign turn, see [campaign manager](./campaign-manager.md).

### Order of operations

1. Player acts: Fundraise, Build Donor Network, Advertise, Campaign or ConvertCash (spends action points and funds, applies effect).
2. Each turn: `processFundGeneration` computes gross, splits state and national tax, credits the player and party treasuries.
3. Each turn: action refresh applies PI decay; campaign turn adds candidate campaign income.

```
actions (immediate, executeAction)   Fundraise, Build Donor Network, Advertise, Campaign, ConvertCash
turn group 1 (resourceAndFinanceStart)   actionRefresh (PI decay) and fundGeneration run in parallel
turn group 6 (billsCampaignsAndActivity)   campaign turn adds candidate campaign income
```

## Worked trace

A medium-tier state (population 5,000,000), donor level 5, state influence 50%, US House seat, gdpScalar 1.0, modern era.

- Donor bonus `= 200 x 5 x 1.5 = 1,500`. Gross `= (10,000 + 1,500) x 1.0 + 5,000 = 16,500` per turn.
- With state tax 10% and national tax 20%: taxes `1,650 + 3,300`; the player receives `11,550`. The state party treasury gains 1,650 and the national treasury 3,300.
- Fundraise at neutral stats: `(50,000 + 10,000) x 1.5 = 90,000` for 3 AP, untaxed.
- Ad at favorability 75, neutral charisma, gdpScalar 1.0: AP 8, tier 3, funds `100,000 x 1.6 = 160,000`, gain `floor(3 - 0.5) = 2`. At favorability 90: AP 9, funds 180,000, gain `floor(3 - 2) = 1`.

Extended with the other actions, same state and character:

| Action | Calculation | Result |
| --- | --- | --- |
| Build Donor Network at level 5 | AP: `round(4 + (5/75)^1.4 x 16) = round(4.36) = 4`. Funds: `round((3,000 + 7,500) x 1.0 / 1,000) x 1,000 = 11,000`, divided by `statMultiplier(5.5) = 1.0` | 4 AP, 11,000 funds, level 5 becomes 6 |
| Campaign at state PI 45 | Tier 3, so 3 AP. Multiplier `1 + 2 x 0.2 = 1.4`. Funds `20,000 x 3 x 1.4 = 84,000`. PI gain `max(0.1, 1 - 0) x 1.0` | 3 AP, 84,000 funds, PI +1.0 |
| ConvertCash 100,000 | Credit `floor(100,000 x 0.5) = 50,000`. Infamy `round(15 x 0.1^0.564) = round(4.09) = 4` | 2 AP, 100,000 cash spent, 50,000 funds, infamy +4 |

The same income in a 1953 world (price level 0.03673, flag on): base plus donor `round(11,500 x 0.03673) = 422`, office `round(5,000 x 0.03673) = 184`, gross 606. Taxes `floor(60.6) = 60` and `floor(121.2) = 121`, so the player receives 425.

## Edge cases and limits

- Donor level 0 produces no donor bonus and cannot Fundraise.
- Ad favorability gain is floored at 1 after the charisma multiplier, so an ad is never wasted completely, but cost keeps rising with the favorability tier.
- Party tax above 33 is ignored; independents skip tax.
- Missing home-state GDP or population, or an unallocated charisma stat, rejects an Advertise quote rather than falling back to neutral values.
- `gdpScalar` for income is clamped 0.9 to 1.5; for action costs 0.85 to 2.0. Missing GDP defaults the income scalar to 1.0.
- ConvertCash has no cap on amount, only the infamy cap of 100.
- Unspent funds do not compound; there is no interest on campaign funds.
- Ads currently apply their favorability immediately; the political media order path in `executeAction.ts` is switched off in the shipped code.
- Donor level has no hard cap on write: 75 is the design range, and only the Build Donor Network AP cost is capped (at 20).
- The two income paths round differently: `getTotalFundGeneration` (used by the turn) rounds the combined base and donor leg once, while `calculateFullFundDistribution` rounds base and donor separately, so previews built on it can differ by a point.
- A country with no GDP baseline row throws instead of using the US scale.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Character income plus state tax plus national tax equals gross | Arithmetic in `src/lib/turn/fundGeneration.ts`; `src/lib/turn/fundGeneration.test.ts` (party member and independent cases) |
| A tax rate outside 1 to 33 yields no tax | `calculateTaxAmount`; `src/lib/utils/fundGeneration.test.ts` |
| A quoted cost or yield equals what execution debits or credits | `src/lib/actions/rules.test.ts` (effect matches quote for Fundraise, Advertise, Campaign, Build Donor Network); `src/lib/actions.fundraiseQuote.test.ts` |
| Infamy stays within 0 to 100 | `clampAddExpression` in `executeAction.ts`, plus the cap in `calculateConvertCashInfamy` |
| Income GDP scalar within 0.9 to 1.5, cost scalar within 0.85 to 2.0 | Clamps in `getIncomeGdpScalar` and `getFundMultiplier` |
| Donor base level within 0 to 75 | Not enforced on write |
| Era price level reproduces today's arithmetic when off or modern | `src/lib/campaigns/rules/priceLevel.test.ts` (table matches the GDP baseline table) and `src/lib/utils/fundGeneration.era.test.ts` |

## Failure and recovery

- **Income not credited for a character.** Characters whose home state is missing are skipped by the turn; the symptom is a flat funds line for one player. Repair the character's home state, and the next turn pays normally.
- **Wrong credited field after a forex change.** If `forexEnabled` and a character's stored balances disagree, income lands in the field the flag selects. A balance heal moves it; the next turn then follows the flag.
- **Quote rejected.** Advertise, Build Donor Network and Fundraise reject rather than guess when GDP, population, charisma or the fundraising stat is missing. The fix is to allocate stats or repair the state's economic data; nothing is charged on a rejected quote.
- **Missing baseline row for a new country or era** throws in income and cost math. Adding the baseline row fixes it and the next turn recovers.
- **Treasury mismatch.** Party tax credits are written in bulk with ledger entries, so a half-failed turn shows as a treasury that disagrees with the ledger; the repair is a treasury heal against the ledger entries.

## Connections

**Driven by:**

- State population, GDP and influence (`src/lib/utils/fundGeneration.ts`), see [demographics](./demographics.md).
- Office held and party tax rates, see [parties](./parties.md) and [party influence](./party-influence.md).
- Character stats (fundraising, charisma), see [stats and actions](./stats-actions.md).
- Era price level and media newsroom slant.

**Affects:**

- Party treasuries (state and national tax credits).
- Candidate favorability and elections, see [election engine](./election-engine.md) and [campaign strategy](./campaign-strategy.md).
- Infamy (via ConvertCash) and political influence (via Campaign).

### Related pages

- [Formula Deep-Dive](./formula-deep-dive.md): the fund generation formula in context.
- [Campaign strategy](./campaign-strategy.md) and [campaign manager](./campaign-manager.md): upgrade costs and per-turn campaign income.
- [Canvassing](./canvassing.md) and [demographics targeting](./demographics-targeting.md): where advertising does not reach.

## Tests

| Area | Test files |
| --- | --- |
| Fund generation, tax, era scaling | `src/lib/utils/fundGeneration.test.ts`, `src/lib/utils/fundGeneration.era.test.ts`, `src/lib/utils/fundGeneration.projection.test.ts` |
| Turn income and treasury credits | `src/lib/turn/fundGeneration.test.ts` |
| Action quotes and costs | `src/lib/actions/rules.test.ts`, `src/lib/actions.fundraiseQuote.test.ts` |
| Era price level | `src/lib/campaigns/rules/priceLevel.test.ts` |
| Newsroom slant | `src/lib/mediaEditorial/slant.test.ts` |
| Campaign page income | `src/lib/campaigns/income.test.ts` |
| Boost and attack premiums | `src/lib/influence/rules.test.ts` |

Gaps: no test covers the donor level 75 design range, and the two income paths are not compared against each other.

## Known issues and history

- Corporation-backed political advertising is switched off pending a rework (`TODO` in `src/lib/actions/commands/executeAction.ts`); ads apply favorability immediately.
- `logarithmicPopulationScale` and `getDonorBaseBonusLogarithmic` in `src/lib/utils/fundGeneration.ts` are an unused older scaling; the tier table is the live rule.
- The era price level (#2119) was added to remove a between-era distortion where 1953 worlds paid and charged modern nominal amounts. The ratio of GDP per capita is an upper bound on pure inflation, as the source comment notes.
- Donor base levels moved from a 0 to 5 scale to 0 to 75; per-level amounts were calibrated to keep the same income ceiling.
- Doc corrections in this pass (no player-page contradictions found): the starting funds source is `gameConfig.startingFunds`, not a constant in the onboarding file; the Build Donor Network fundraising discount is now stated exactly (cost divided by `statMultiplier(fundraising)`).

Last checked: 2026-10-29, version 1.18.0
