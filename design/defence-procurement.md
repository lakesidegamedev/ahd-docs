# Defence Procurement

## Summary

Defence procurement lets a country's ministry award contracts to domestic corporations to build materiel (arsenal components) for its military. The subsystem is a set of independent guardrails around what used to be an almost unbounded transfer channel from the national defence appropriation into corporate cash, the [defence price-band drain](#background-the-price-band-drain). Each guardrail is a small, pure module so the award route, the delivery sweep, and the client-side award form can all agree on the same numbers.

Player guide: [Defence Procurement](https://www.ahousedividedgame.com/wiki/defence-procurement)

**Location:** `src/lib/military/`, with tender bidding in `src/lib/governmentContracts/`

**Key files:**

- `defenceContractLimits.ts` - Per-window award caps (how much may be promised)
- `defenceTurnSpendCap.ts` - Per-turn payout caps (how fast a promise may be paid)
- `defenceLotEconomics.ts` - Lot cost, price band, margin, factory-slot allocation
- `defenceSelfDealing.ts` - Minister/supplier conflict-of-interest detection and penalty
- `defencePriceRatios.ts` - Live commodity price ratios feeding lot costing
- `defenceFillEligibility.ts` - Whether a plant can hold/deliver a given contract
- `procurementGate.ts` - Global pause switch and demilitarisation bar for new procurement
- `defenceTermination.ts` - Cost of tearing up a signed contract (cause versus convenience)
- `defenceMinisterInterests.ts` - Minister's stake in a competing domestic defence supplier
- `stateArmsIndustry.ts` - State arms output for planned economies and the empty-store floor
- `src/lib/governmentContracts/` - Tender publishing, sealed bidding, award and reservations
- `src/lib/turn/defenceDeliveryTurn.ts` - The per-turn delivery sweep that applies the caps above

## Rules

### Background: the Price-Band Drain

A delivery credits the supplier `pricePerLot - productionCost` per lot. Under the original cost model, a lot could be priced in the hundreds of millions while costing a few thousand to build, a margin above 99.99%. Because the price band's top was the GDP anchor (five orders of magnitude above the true build cost) and the cost model was an unrelated flat commodity-recipe figure, a defence contract was very close to a pure transfer of national appropriation into one corporation's cash balance. A minister with a stake in the supplier directly benefited. The guardrails below are the mitigation, not a full clawback (contracts already signed keep their terms).

### Tenders and Bidding (`src/lib/governmentContracts/`)

New defence contracts are no longer direct offers from a minister to a named CEO. The defence seat holder (an acting holder has the same authority) publishes a **tender** fixing the component, number of lots, required grade and maximum price per lot. Eligible domestic corporations nominate a certified plant and bid a price inside the price band. Bids are sealed until bidding closes, and the CEO may revise or withdraw a bid until then. The minister then picks any qualifying bid and publishes a reason; there is no automatic winner. The winning bid activates the order with no second acceptance step.

| Constant | Value | Source |
| --- | --- | --- |
| `BIDDING_TURNS_MIN` / `BIDDING_TURNS_MAX` / `BIDDING_TURNS_DEFAULT` | 6 / 48 / 24 turns | `src/lib/governmentContracts/rules.ts` |
| `AWARD_WINDOW_TURNS` | 24 turns after bidding closes (exactly 24, enforced by `validDeadlines`) | `src/lib/governmentContracts/rules.ts` |
| `CONTRACTS_PAGE_SIZE` | 10 results per page on the country board | `src/lib/governmentContracts/rules.ts` |

Publishing reserves the maximum obligation (`tenderReservationValue = lots × maximumPricePerLot`) against the appropriation and the window quota (`reserveDefenceTender`, `src/lib/governmentContracts/reservations.ts`); award transfers the actual winning value and releases the difference. An open tender therefore holds resources for at most 72 turns (48 bidding plus 24 award). The tender's maximum price must be at least the lowest live price floor over every strategy that can build that component at that grade (`defenceLiveLotFloor`, `src/lib/governmentContracts/defenceLiveFloor.ts`), and a tender below it is refused. Bidding costs nothing. Existing signed contracts and any legacy direct offers keep their stored terms.

A defence bid is rejected (`defenceBidError`) when the plant's grade (the lower of supplier grade and era grade) is below the required grade, when the amount is outside the plant's current price band or above the tender maximum, or when the supplier has less remaining quarterly room than the tender's lots. Bids sort cheapest first (`compareBids`).

All the guardrails below (window cap, supplier cap, price band, self-dealing, fill eligibility) still apply to a tender award.

### Contract Award Limits (`defenceContractLimits.ts`)

Contracts are budgeted in quarter-year tranches, not against an unlimited future stream.

- **Contract window:** `DEFENCE_CONTRACT_WINDOW_TURNS = TURNS_PER_YEAR / 4 = 12` turns (`TURNS_PER_YEAR = 48`, `src/lib/constants/calendar.ts`).
- **Country cap:** `defenceContractLotCaps(defenseLine, pricePerLot)` computes `procurementNotional = defenseLine * (1 - SEED_UPKEEP_TARGET_SHARE) * (windowTurns / TURNS_PER_YEAR)`, the appropriation spends 55% of the annual defence line sustaining the seeded force (`SEED_UPKEEP_TARGET_SHARE = 0.55`, `src/lib/military/appropriation.ts`), so only the remaining 45% is a procurement budget, prorated to one window. `countryLots = floor(procurementNotional / pricePerLot)`.
- **Supplier cap:** `defenceSupplierCapShare(stateOwned)`, a private supplier may take at most `DEFENCE_CONTRACT_SUPPLIER_SHARE = 1/3` of the country's window (`supplierLots = max(1, floor(countryLots / 3))` when `countryLots > 0`), so a minister cannot dump the whole tranche into one corporation. A **state-owned** supplier (National Corporation) gets the full window instead of a third: command economies seed one National Corporation per sector, and applying the private cap there would leave two thirds of the window unspendable across every other plant on that SOE.

### Turn Spend Cap (`defenceTurnSpendCap.ts`)

The award side limits the total a supplier may be *promised* in a window; this limits the rate at which that promise may *settle*, closing the throughput gap that let a single contract deliver an entire quarterly procurement window in one tick.

- `defenceProcurementAccrualPerTurn(defenceLine) = defenceLine * (1 - SEED_UPKEEP_TARGET_SHARE) / TURNS_PER_YEAR`, the same identity `defenceContractLotCaps` uses for a window, divided by the window length, so award and payout can never drift apart.
- `DEFENCE_TURN_SPEND_BURST = 3`, a country may pay out up to 3 turns' worth of accrual in a single turn (so a country that has been saving can spend the stockpile faster than it earned it).
- `defenceCountryTurnSpendCap = accrualPerTurn * 3`; `defenceSupplierTurnSpendCap` applies `defenceSupplierCapShare` on top (a third for private industry, all of it for a National Corporation).
- Over a full 12-turn window this sums to `3x` the window's total award quota, the cap never reduces what a legitimate buyer can spend across a window, it only stops the whole quota landing in one or two turns.
- `lotsWithinTurnSpendCap()` computes how many lots a contract may settle *this turn*: `floor(min(countryCap - countryPaid, supplierCap - supplierPaid) / pricePerLot + 1e-9)`, with a **one-lot-per-country-per-turn floor** (returns 1 when the result is 0 and the country has paid nothing yet this turn) so a small country whose lot price exceeds its whole turn cap still ships something. The floor is per country, not per contract, so it cannot be exploited by splitting one order into twenty. A non-positive price returns infinity (no cap).

### Lot Economics and Price Band (`defenceLotEconomics.ts`)

Cost is derived from price, not the other way round, inverting the old model.

- `TARGET_SUPPLIER_MARGIN = 0.15`, production cost is the lot price less 15%, so cost share is `0.85 × index` (real-world large Western primes run 9-11% operating margin; US government contracting fee targets sit near 10-15%; the top of that range is chosen deliberately so procurement stays worth chasing).
- `MIN_CONTRACT_MARGIN = 0.12`, floor: a contract may never be written below cost + 12%.
- `MAX_CONTRACT_MARGIN = 1.0`, backstop ceiling on markup over cost, active only if the cost model is ever mis-derived; the GDP anchor is normally the tighter, binding ceiling.
- `lotCostIndex()` reads live commodity price ratios (see below) against the nominal recipe, clamped to `[LOT_COST_INDEX_MIN = 0.7, LOT_COST_INDEX_MAX = 1.5]`, a shortage squeezes the **supplier's** margin, never raises the price to the taxpayer.
- `lotProductionCost(strategy, lotPrice, ratios) = lotPrice × min(0.85 × index, MAX_COST_SHARE_OF_PRICE)` with `MAX_COST_SHARE_OF_PRICE = 1 / (1 + MIN_CONTRACT_MARGIN) = 0.8929`. The cap binds once the index exceeds about 1.0504, and at the cap the supplier's margin has fallen to the 12% floor markup and stops there.
- `GRADE_PRICE_SCALE` (grade 0-3): `{0: 0.7, 1: 0.85, 2: 1.0, 3: 1.25}`, cheap-mass vs. premium doctrine both fall out of one price dial. `normalizeGrade` rounds and clamps to 0-3; a missing or non-numeric grade becomes 3.
- `lotPriceBand({anchorPrice, productionCost, grade})` returns `{productionCost, floor, ceiling, suggested}`, the band a minister may set a lot price inside:
  - `gradedCost = productionCost × GRADE_PRICE_SCALE[grade]`
  - `floor = max(1, ceil(gradedCost × 1.12))`
  - `ceiling = max(floor, min(round(anchor × scale), round(gradedCost × 2)))`
  - `suggested = max(floor, min(ceiling, round(gradedCost / 0.85)))`
  - Not retroactive: a signed contract keeps the price (and margin) it was struck at even if the anchor moves later (`costBasis: "margin"` vs. legacy contracts, which settle on `legacyLotProductionCost = inputs × (1 + LOT_OVERHEAD_SHARE_OF_INPUTS)` with `LOT_OVERHEAD_SHARE_OF_INPUTS = 0.35`, the earlier flat-overhead model, kept only so already-signed contracts keep the terms players agreed to).
- **Factory slots:** `DEFENCE_FACTORY_SLOTS_PER_PLANT = 4`, a CEO splits a plant's throughput across contracts by assigning slots, not a figure derived from revenue (which would silently invalidate a standing allocation every turn). Lots per turn for a contract are `rawLots × assigned / 4` (`contractLotsThisTurn`). New private-supplier contracts default to an even split `floor(4 / componentCount)`, at least 1 and at most the free slots (`defaultFactoryAllocation`); a National Corporation (no player CEO to reallocate) takes every free slot at award (`awardFactoryAllocation`).

### Live Price Ratios (`defencePriceRatios.ts`)

Lot costing reads the same world commodity price ratio (`globalPrice / COMMODITY_BASE_PRICES[commodity]`) the corporation turn's own input-cost calculation uses, so a lot's cost floor and a plant's actual input bill move together. Deliberately the **world** ratio, not a country's reachable-market ratio, the award form is a client component that quotes a price band before any of that scope exists, and a world ratio is the same number for both sides of the negotiation. Never cached at module scope (a stale ratio would survive a world reset into the next era). `NOMINAL_PRICE_RATIOS` is an empty map (every ratio 1).

### Self-Dealing (`defenceSelfDealing.ts`)

The concentration cap stops one supplier taking the whole tranche; it says nothing about who owns that supplier. `resolveSelfDealing()` detects when the awarding minister has a stake in the receiving corporation:

- **`owner`**, same player (`userId`) on both sides of the contract, read even while a caretaker runs the corp so the relationship can't be laundered.
- **`shareholding`**, minister's own recorded shareholding is `>= MATERIAL_STAKE_SHARE = 0.05` (5%).
- Deliberately narrow: only the same player and the minister's own recorded holding count. There is no character relationship graph, so anything wider would be invented rather than observed.

The answer to self-dealing is **disclosure plus a political price**, not another cap:

- `selfDealingFavorabilityPenalty({contractValue, tranche})` scales `SELF_DEALING_BASE_PENALTY = 1.5` up to `SELF_DEALING_MAX_PENALTY = 8` favorability points: `1.5 + min(1, contractValue / tranche) × 6.5`, rounded to one decimal, proportional to the contract's share of the window's procurement notional, a token order costs almost nothing, routing the whole quarter's budget to yourself is a career event. For a tender the contract value is `lots × winning amount` (`tenderSelfDealingPenalty`, `src/lib/governmentContracts/rules/selfDealing.ts`).
- `selfDealingDisclosure()` writes one public wire-voice line naming the minister, the interest, and the contract value/lots, it goes on the public order book.

### Terminating a Contract (`defenceTermination.ts`)

Tearing up a signed contract used to be free, instant, and returned both the appropriation and the window quota, so a minister could cancel a rival's order and re-award the room to their own plant. Termination is now priced by basis (`terminationBasis`):

| Basis | When | Fee | Quota |
| --- | --- | --- | --- |
| Withdrawal | Contract still pending, supplier never accepted | 0 | Released |
| Cause | Supplier at fault for `DEFENCE_TERMINATION_CAUSE_TURNS = 3` delivery turns in a row (`supplierFaultTurns`) | 0 | Released |
| Convenience | Anything else | `round(undelivered lots x pricePerLot x TARGET_SUPPLIER_MARGIN)`, i.e. 15% of the undelivered value | Stays spent |

- Supplier-fault reasons (`SUPPLIER_FAULT_REASONS`): `no_output`, `supplier_ineligible`, `supplier_cannot_fund_loss`. Buyer-side shortfalls (`appropriation_short`, `turn_spend_cap`) never count, so underfunding the budget cannot buy a free cancellation.
- The fee is paid from the defence appropriation immediately; if it cannot cover the fee the termination is refused.
- Favorability penalty: `TERMINATION_BASE_PENALTY = 1` up to `TERMINATION_MAX_PENALTY = 6`, `1 + min(1, cancelledValue / tranche) × 5`, scaled by the order's share of the window tranche. If the minister holds a stake (owner, or at least `MATERIAL_STAKE_SHARE`) in a different domestic corporation with a defence plant (`findCompetingSupplierInterest`), the penalty is multiplied by `TERMINATION_CONFLICTED_MULTIPLIER = 2`, applied after the cap, so the conflicted maximum is 12.
- The cancellation is disclosed on the public wire (`terminationDisclosure`) and the supplier is notified (`terminationNoticeToSupplier`).

### Fill Eligibility (`defenceFillEligibility.ts`)

`resolveFillEligibility()` is the single shared answer to "can this plant fill this order", used by the award picker, the award route, the CEO's accept, and the delivery sweep, previously each carried its own version and disagreed. AWARDABLE MUST MEAN DELIVERABLE.

Refusal reasons (`FillIneligibilityReason`):

| Reason                  | Meaning                                                                 |
| ------------------------ | -------------------------------------------------------------------------- |
| `foreign_supplier`      | Plant is not in the buying country                                       |
| `currency_mismatch`     | Corp is not paid in the buying country's currency (`canSupply()` infers the currency from the corp's own country, never defaults to USD, a prior USD default hid every non-US domestic plant) |
| `no_materiel_line`      | Plant's strategy supplies no arsenal component                           |
| `retooled_off_component`| Plant has re-tooled off the component its contract was frozen on         |
| `no_output`             | Plant produces nothing this turn, still **eligible** (a plant between production runs is a legitimate contract target; the reason rides along as a UI warning, not a refusal) |
| `no_factories_assigned` | No production lines assigned to the order                                |

State ownership is not a fill-eligibility factor: a National Corporation banks in its own country's currency like any other supplier; the only thing it changes is who clicks Accept (no player CEO).

Delivered grade is the tightest of three ceilings (`deliveredGrade`): the corporation's research ceiling, the contract's own `gradeCeiling` (3 when absent) and the era ceiling (`maxTechTierForPreset`, passed to the sweep as `maxGrade`).

### Procurement Gate (`procurementGate.ts`)

`isProcurementBlocked(db, countryId, turn)` blocks new awards in two cases:

1. **Global pause.** `isDefenceProcurementPaused(db)` reads `gameState.defenceProcurementPaused` (singleton `_id: "current"`, not filtered on `isActive`). When true, awarding a **new** contract and a CEO **accepting** a pending offer both refuse. This is a kill switch for a procurement-drain exploit, not a subsystem teardown.
2. **Demilitarisation bar.** `activeProcurementRestriction` (collection `procurementRestrictions`) returns the turn until which a country under a peace settlement may award nothing.

Everything already active is untouched in both cases: the delivery sweep keeps settling live contracts, and cancel/decline stay open. `publishTender` calls the same gate before publishing a defence tender.

### Delivery Sweep (`src/lib/turn/defenceDeliveryTurn.ts`)

`applyDefenceDeliveries(db, countryId, currentYear, maxGrade, currentTurn)` settles every active contract. Four caps apply to each contract, in this order:

1. what the plant produced: `floor(deliveryCarry + contractLotsThisTurn(rawLotsFromSector(sector), assigned))`
2. what remains on the order: `lotsOrdered - lotsDelivered`
3. what the contract's encumbrance (or, for legacy contracts, the uncommitted appropriation) covers: `floor(funding / pricePerLot)`, with no overdraft
4. the per-turn spend cap (`lotsWithinTurnSpendCap`)

`deliverable = min(produced, remaining, affordable, withinTurnCap)`. Everything built and not shipped is banked in `deliveryCarry` (never discarded, capped at what the order still needs), with a `carryReason` naming the binding limit.

Settlement per delivery of `recorded` lots at grade `g`:

- `actualCost = recorded × pricePerLot`
- `unitCost = contractLotProductionCost(contract, strategy, ratios)` (a share of the stored `pricePerLot` for `costBasis: "margin"`, the legacy recipe cost otherwise)
- `buildCost = round(unitCost × GRADE_PRICE_SCALE[g] × recorded)`, `margin = actualCost - buildCost`
- One idempotent money move (`applyMoneyMove`, key `defence-delivery:<contractId>:<turn>`): debit `actualCost` from `federalBudget.defenseAppropriation.balance`, credit `margin` to the supplier's `liquidCapital` (or debit it when negative), burn `buildCost`. The legs net to zero.
- The lot record is written first (`advanceContract`) and reversed if the money move does not apply, so a failed payment leaves nothing to reclaim. Then the encumbrance is drawn down, payment recorded, and finally `depositLots` stocks `nationalArsenal`. If the deposit throws, the lot record is reversed and a paired refund move runs.
- A negative margin (input prices overtook the struck price) is allowed only if the supplier's `liquidCapital` covers the loss; otherwise the contract stalls with `supplier_cannot_fund_loss`.
- The share of a plant's output that shipped is stamped on the sector (`militaryDivertedFraction`, `militaryDivertedTurn`) and removed from its market sales and supply next turn.

### State arms industry (`stateArmsIndustry.ts`)

Planned economies get state arms output outside tenders: `STATE_ARMS_INDUSTRY = { RU: 3, DD: 1 }` lots per turn. Every other country has an emergency floor: `MATERIEL_FLOOR_LOTS = 1` lot per turn, only into a domain whose store is at zero with a need above zero, so it can refuse to leave a store empty but cannot fill one.

## Data

| Collection | Access | Fields and notes |
| --- | --- | --- |
| `governmentTenders` (`GovernmentTender`) | read and written | terms (`component`, `lots`, `grade`, `maximumPricePerLot`), `closesTurn`, `awardDeadlineTurn`, `status` (`publishing`, `open`, `awarding`, `awarded`, `canceled`), `bids`, `bidHistory`, `reservedAmount`, `allocationWindowId`, `contractId`, `awardSelfDealing`. Bids are sealed to other parties until `closesTurn`; the board, winning reason and awarded contract are public. |
| `defenceContracts` (`DefenceContract`, `src/lib/db/types/defenceContract.ts`) | read and written | `countryId`, `corporationId`, `sectorId`, frozen `component`, `lotsOrdered`, `lotsDelivered`, `deliveryCarry`, `pricePerLot`, `encumberedAmount`, `amountPaid`, `productionCostPaid`, `gradeCeiling`, `assignedFactories`, `carryReason`, `supplierFaultTurns`, `selfDealing`, `termination`, `costBasis`, `status`. Order books show the contract, carry reason, margin and termination record. |
| `defenceProcurementAllocations` | read and written | One doc per country and window (`<countryId>:<index>`): `countryAmount`, `supplierAmounts`, per-tender hold markers. Enforces the window and supplier caps atomically. |
| `federalBudget` | written | `defenseAppropriation.balance`, `.encumbered`, `.governmentTenderReservations`; the delivery debit and the termination fee. `gdp` and `militaryPriceBaselineGdp` set the lot price anchor. |
| `corporations` and `corporateSectors` | read; `liquidCapital` and `militaryDivertedFraction` written | Supplier eligibility, research ceiling, plant output (`rawLotsFromSector`), margin credit. |
| `nationalArsenal` | written | `depositLots` increments stock and grade by component. |
| `bankMoneyMoves` | written | Idempotency records for delivery and refund moves. |
| `commodityPrices` | read | `globalPrice` per commodity for live ratios. |
| `gameState` | read | `defenceProcurementPaused`, preset (era grade ceiling). |
| `procurementRestrictions` | read | Demilitarisation bar. |
| `characters` | written | `favorability` penalty for self-dealing and termination. |
| `financialTxLog` | written | `defence_contract_payment` entry per delivery. |

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `gameState.defenceProcurementPaused` | absent (false) | `src/lib/db/types/gameState.ts`, flipped by an admin action; read by `procurementGate.ts` |
| Era grade ceiling | by preset | `maxTechTierForPreset` in `src/lib/admin/seed/seedMilitaryUnits.ts`, passed as `maxGrade` by `processMinisterialOrders` |
| `SEED_UPKEEP_TARGET_SHARE` | 0.55 | `src/lib/military/appropriation.ts` (the one balance dial; procurement share is `1 - 0.55`) |
| `DEFENCE_CONTRACT_SUPPLIER_SHARE`, `DEFENCE_TURN_SPEND_BURST`, `TARGET_SUPPLIER_MARGIN`, `MIN_CONTRACT_MARGIN`, `MAX_CONTRACT_MARGIN`, `GRADE_PRICE_SCALE`, `DEFENCE_FACTORY_SLOTS_PER_PLANT` | 1/3, 3, 0.15, 0.12, 1.0, see Rules, 4 | `defenceContractLimits.ts`, `defenceTurnSpendCap.ts`, `defenceLotEconomics.ts` |
| `STATE_ARMS_INDUSTRY`, `MATERIEL_FLOOR_LOTS` | `{RU: 3, DD: 1}`, 1 | `src/lib/military/stateArmsIndustry.ts` |
| Tender timing | 6 to 48 bidding turns (default 24), 24 award turns | `src/lib/governmentContracts/rules.ts` |
| Demilitarisation bar | none | `procurementRestrictions`, written by peace settlements |

There are no per-country overrides of the window, caps or margins. Country differences come from the defence line (`resolveDefenseLine`), the currency and the state-owned status of the supplier.

## Timing

```
every turn:
  resourceAndFinanceStart group (after commodityPrices)
    governmentContractExpiry         tenders past award deadline -> Canceled
    governmentContractMaximaRefresh  open tender maxima re-checked vs live floor
  stateEffectsAndNationalAggregation group, ministerialOrders phase
  (after crisisTurn, intelligenceTurn, navairOperations; before policyEffects):
    processMinisterialOrders, per country:
    applyDefenseAppropriation        accrue the appropriation
    applyDefenceDeliveries           settle contracts (this page)
    applyStateArmsProduction         planned-economy and floor lots
    applyNavalRepair -> applyDefenceRefit -> nuclear production -> doctrine income
    battle declarations resolve
```

- **Tender lifecycle:** `governmentContractExpiry` and `governmentContractMaximaRefresh` are phases in `src/simulation/phases/turnPhaseRegistry.ts`, running after commodity prices.
- **Delivery sweep:** `applyDefenceDeliveries` runs inside the `ministerialOrders` phase (`processMinisterialOrders` in `src/lib/turn/ministerialOrderProcessing.ts`) once per country per turn. It must follow the appropriation accrual (`applyDefenseAppropriation`) because it spends the balance that step credits, and it runs before state arms production, naval repair, refit and nuclear stockpile accrual. Materiel has to arrive before it can be issued, and conventional deliveries settle before the nuclear programme competes for the same appropriation.
- **Idempotency:** a contract settles at most once per turn (`defenceDeliveryMoveKey`), so a re-run turn replays rather than pays twice.
- **Windows:** `defenceContractWindow(countryId, turn)` splits turns into 12-turn windows starting at turn 1, so windows are turns 1 to 12, 13 to 24, and so on. A tender is booked against the window containing its publish turn.
- **Award time:** caps, price band, self-dealing and eligibility are checked when a tender is published and awarded, not at delivery. The spend cap and eligibility are checked again at each delivery.

## Worked trace

A country has an annual defence line of 48,000,000,000 and a lot price of 150,000,000 (grade 2, so the grade scale is 1.0, and a calm market so the cost index is 1.0).

| Step | Calculation | Result |
| --- | --- | --- |
| Window procurement notional | 48,000,000,000 x (1 - 0.55) x (12 / 48) | 5,400,000,000 |
| Country cap | floor(5,400,000,000 / 150,000,000) | 36 lots |
| Private supplier cap | max(1, floor(36 x 1/3)) | 12 lots |
| State-owned supplier cap | full window | 36 lots |
| Accrual per turn | 48,000,000,000 x 0.45 / 48 | 450,000,000 |
| Country turn spend cap | 450,000,000 x 3 | 1,350,000,000 (9 lots) |
| Private supplier turn cap | 1,350,000,000 x 1/3 | 450,000,000 (3 lots) |
| Production cost | 150,000,000 x (1 - 0.15) | 127,500,000 |
| Price floor | ceil(127,500,000 x 1.12) | 142,800,000 |
| Price ceiling | min(anchor 150,000,000, cost x 2 = 255,000,000) | 150,000,000 |
| Suggested price | 127,500,000 / 0.85 | 150,000,000 |

So a private plant awarded the full 12 lots delivers 3 per turn and finishes in 4 turns. If the minister owns that plant and awards 1,800,000,000 (one third of the tranche), the self-dealing penalty is 1.5 + (1/3) x (8 - 1.5) = 3.67, shown as 3.7 favorability points. Cancelling that order for convenience after 3 of 12 lots delivered pays a fee of 9 x 150,000,000 x 0.15 = 202,500,000.

Settlement of one delivery of 3 lots (contract struck at 150,000,000, grade 2 delivered, index 1.0):

| Step | Calculation | Result |
| --- | --- | --- |
| Actual cost | 3 x 150,000,000 | 450,000,000 (exactly the private supplier turn cap) |
| Unit cost | 150,000,000 x min(0.85 x 1.0, 0.8929) | 127,500,000 |
| Build cost | round(127,500,000 x 1.0 x 3) | 382,500,000 |
| Margin | 450,000,000 - 382,500,000 | 67,500,000 |
| Money move | debit appropriation 450,000,000; credit supplier 67,500,000; burn 382,500,000 | nets to 0 |

With a commodity shock at index 1.5 the unit cost share would be min(1.275, 0.8929) = 0.8929, so build cost is 3 x 133,928,571 = 401,785,714 and the margin falls to 48,214,286 (10.7% of price), never negative at grade 2.

## Edge cases and limits

- **Unspent window room does not carry forward.** A fresh tranche opens each window.
- **Lot caps floor at 1.** If the country cap is above zero, the private supplier cap is at least 1 lot. If the defence line or lot price is zero or negative, every cap is 0.
- **One-lot floor on delivery.** If a country has paid nothing yet this turn, at least one lot settles even when its price exceeds the turn cap; the floor is per country per turn, so splitting an order into many contracts does not multiply it.
- **Cap never shrinks a window.** The per-turn cap is 3x the steady accrual and a window is 12 turns, so the cap only spreads payouts, never reduces the total a buyer can spend.
- **Price floor wins over ceiling.** If input costs run away so the cost-derived floor exceeds the anchor ceiling, the ceiling is raised to the floor: nothing may be written below cost plus 12%.
- **Cost shocks hit the supplier, not the taxpayer.** `lotCostIndex` is clamped to 0.7 to 1.5 and the cost share to 0.8929, and the price stays inside the band.
- **Grade out of range.** `normalizeGrade` rounds and clamps to 0 to 3, and a missing grade is treated as 3.
- **Self-dealing is disclosed, not blocked.** The penalty is capped at 8 favorability points, so no single award ends a career outright. Only the same player or the minister's own recorded shareholding of 5% or more counts; there is no relationship graph.
- **Demilitarisation.** A country under a demilitarisation settlement may award no new contract and no company may accept one from it until the bar lapses; live contracts keep delivering.
- **Paused procurement.** Only new awards and acceptances stop; live deliveries, cancel and decline continue.
- **Planned economies** (Soviet Union, East Germany) receive state arms output outside tenders (`stateArmsIndustry.ts`), and AI-run or state suppliers submit an initial suggested-price bid but get no direct-award shortcut. Other countries get a one-lot-per-turn floor only for an empty store.
- **Legacy contracts** settle on `legacyLotProductionCost` and keep the price and margin they were struck at. Legacy contracts with no encumbrance spend from the uncommitted appropriation (`balance - encumbered`).
- **Domestic only.** The supplier must be in the buying country and paid in its currency; there is no cross-border order.
- **Loss-making deliveries** are modelled, not clamped: a negative margin debits the supplier, and a supplier that cannot fund it stalls.
- **Retool.** A plant that re-tools off the frozen component is `retooled_off_component` and stalls.

## Invariants

- Award and payout use the same identity: the per-turn accrual times the window length equals the window procurement notional. Enforced by `defenceTurnSpendCap.test.ts` ("sums over a contracting window to exactly the window's procurement notional").
- Money is conserved on every delivery: the debit equals the supplier credit plus the burned build cost, and `applyMoneyMove` refuses a move whose legs do not net to zero. Tested in `defenceMoneyConservation.test.ts`.
- A contract never delivers more lots than ordered, and never delivers on an empty appropriation. Tested in `defenceDeliveryTurn.test.ts` ("never delivers more than the order has outstanding", "delivers nothing on an empty appropriation").
- No overdraft for procurement: the debit is guarded inside the write. Tested in `defenceDeliveryTurn.test.ts`.
- A contract settles at most once per turn (move key). Tested in `defenceMoneyConservation.test.ts` ("is idempotent when the same turn is settled twice").
- No price can be written below cost plus 12% or above the lesser of the anchor and twice cost (except that the floor wins when it exceeds the anchor). Tested in `defenceLotEconomics.test.ts` ("never lets a contract be written below the cost of building it", "caps the price at twice cost even when the anchor is absurd").
- Awardable means deliverable: one function answers eligibility for picker, route, accept and sweep. Tested in `defenceFillEligibility.test.ts`.
- Quarterly window and supplier quotas are enforced atomically in `defenceProcurementAllocations`. Tested in `reservations.realMongo.test.ts`.
- A margin-basis contract is never underwater: holds for delivered grades 0 to 2 (`defenceMoneyConservation.test.ts`), not enforced at grade 3 (see Known issues).
- Not enforced: that delivered grade equals the grade the contract was priced at.

## Failure and recovery

- **Half-applied money move.** If one leg of the delivery move throws, the move record stays `partial` in the repair queue with the legs that applied; the lot record is reversed, the contract stalls with a reason, and the sweep continues with other contracts. Repair is finishing or reversing the recorded move.
- **Arsenal deposit failure.** The lot record is reversed and a paired refund move returns the appropriation and the supplier margin.
- **Interrupted award.** A tender stays in `awarding` (shown as Bidding Closed) with its frozen winner, contract id and financial identity so a retry converges on the same contract and cannot double-charge. Tenders stuck in `publishing` expire to Canceled and their reservation is released.
- **Termination fee not landed.** `termination.feePaid = false` marks a closed order whose supplier was not compensated; the move key derives from the contract id so a replay cannot pay twice.
- **Over-award clawback.** Contracts that were over-awarded past a cap can be administratively recovered; the recovered and unrecoverable amounts are recorded on the contract (`administrativeClawback*` fields).
- **Procurement drain exploit.** The global pause stops new awards without touching live deliveries until a fix ships.
- **Stale carry or reason.** `carryReasonTurn` makes a stale reason legible as stale; a normal delivery clears it.

## Connections

**Driven by:**

- [National Budget](./national-budget.md): the defence line sets every cap (`resolveDefenseLine` in `src/lib/turn/defenseEnvelope.ts`, `SEED_UPKEEP_TARGET_SHARE` in `src/lib/military/appropriation.ts`).
- [Commodities](./commodities.md): world price ratios feed lot cost (`defencePriceRatios.ts`).
- [Corporations](./corporations.md): plant output and strategy decide fill eligibility and who can bid.
- [Government Approval](./government-approval.md): self-dealing and termination penalties reduce the minister's favorability.
- [Conflict System](./conflict-system-as-shipped.md): peace settlements write the demilitarisation bar (`procurementRestrictions`).

**Affects:**

- [Conflict System](./conflict-system-as-shipped.md): delivered lots enter the national arsenal (`depositLots`) and become unit strength and refit.
- [Corporations](./corporations.md): award payments credit supplier cash (`applyMoneyMove` in `defenceDeliveryTurn.ts`) and delivered output is removed from the plant's market sales (`militaryDivertedFraction`).
- [National Budget](./national-budget.md): deliveries draw down the defence appropriation encumbrance.

### Related Systems

- [conflict-system-as-shipped.md](./conflict-system-as-shipped.md) - Arsenal components, unit grades, and how procured materiel becomes combat effectiveness
- [corporations.md](./corporations.md) - Corporate sectors, strategies, revenue

## Tests

- `src/lib/military/defenceContractLimits.test.ts`, `defenceTurnSpendCap.test.ts`, `defenceLotEconomics.test.ts`, `defenceSelfDealing.test.ts`, `defenceTermination.test.ts`, `defenceFillEligibility.test.ts`, `defenceMinisterInterests.test.ts`, `defencePriceRatios.test.ts`, `procurementGate.test.ts`, `stateArmsIndustry.test.ts`, `procurement.test.ts`: the pure modules.
- `src/lib/military/defenceMoneyConservation.test.ts`: delivery money legs net to zero.
- `src/lib/turn/defenceDeliveryTurn.test.ts`: the sweep, carry, caps, unwind and diversion.
- `src/lib/governmentContracts/rules.test.ts`, `publishTender.test.ts`, `defenceLiveFloor.test.ts`, `reservations.realMongo.test.ts`, `commands.realMongo.test.ts`, `authority.test.ts`: tenders, bids and reservations.
- Gaps: no test pins the grade scale applied at settlement against a contract priced at that grade (see Known issues); no end-to-end test covers a full tender-to-termination run; the demilitarisation bar is covered only through the gate unit tests.

## Known issues and history

- **Player wiki contradiction (code wins).** The player page says defence bidding and award deadlines "must fit inside the current quarterly contracting window". The code does not enforce this: `validDeadlines` requires 6 to 48 bidding turns plus exactly 24 award turns, which cannot fit in a 12-turn window, and the tender is simply booked against the window of its publish turn (`reserveDefenceTender`). This page states the code behaviour.
- **Possible double application of the grade scale at settlement.** The band prices a graded lot as `anchor × scale` and derives cost from the ungraded anchor. At delivery, `unitCost` is derived from the stored (already graded) `pricePerLot` and then multiplied by `GRADE_PRICE_SCALE` of the delivered grade again. At index 1.0 that gives a supplier margin of 40.5% at grade 0, 27.75% at grade 1, 15% at grade 2 and -6.25% at grade 3, so a grade 3 contract struck at the graded anchor settles at a loss that the supplier must fund. Found by reading the code. `defenceMoneyConservation.test.ts` asserts a margin-basis contract cannot go underwater, but its fixtures deliver at grade 0, so that claim is untested above grade 2.
- Existing contracts signed before the cost-basis fix (`costBasis` absent) keep the old flat-overhead economics by design; they are grandfathered, not a defect.
- The termination favorability penalty is capped at 6 before the conflicted multiplier, so a conflicted termination can reach 12 against a self-dealing cap of 8.

Last checked: 2026-10-29, version 1.18.0
