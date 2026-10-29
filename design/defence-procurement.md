# Defence Procurement

## Overview

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
- `procurementGate.ts` - Global pause switch for new procurement
- `defenceTermination.ts` - Cost of tearing up a signed contract (cause versus convenience)
- `defenceMinisterInterests.ts` - Minister's stake in a competing domestic defence supplier
- `src/lib/turn/defenceDeliveryTurn.ts` - The per-turn delivery sweep that applies the caps above

## Background: the Price-Band Drain

A delivery credits the supplier `pricePerLot - productionCost` per lot. Under the original cost model, a lot could be priced in the hundreds of millions while costing a few thousand to build, a margin above 99.99%. Because the price band's top was the GDP anchor (five orders of magnitude above the true build cost) and the cost model was an unrelated flat commodity-recipe figure, a defence contract was very close to a pure transfer of national appropriation into one corporation's cash balance. A minister with a stake in the supplier directly benefited. The guardrails below are the mitigation, not a full clawback (contracts already signed keep their terms).

## Tenders and Bidding (`src/lib/governmentContracts/`)

New defence contracts are no longer direct offers from a minister to a named CEO. The defence seat holder (an acting holder has the same authority) publishes a **tender** fixing the component, number of lots, required grade and maximum price per lot. Eligible domestic corporations nominate a certified plant and bid a price inside the price band. Bids are sealed until bidding closes, and the CEO may revise or withdraw a bid until then. The minister then picks any qualifying bid and publishes a reason; there is no automatic winner. The winning bid activates the order with no second acceptance step.

| Constant | Value | Source |
| --- | --- | --- |
| `BIDDING_TURNS_MIN` / `BIDDING_TURNS_MAX` / `BIDDING_TURNS_DEFAULT` | 6 / 48 / 24 turns | `src/lib/governmentContracts/rules.ts` |
| `AWARD_WINDOW_TURNS` | 24 turns after bidding closes | `src/lib/governmentContracts/rules.ts` |
| `CONTRACTS_PAGE_SIZE` | 10 results per page on the country board | `src/lib/governmentContracts/rules.ts` |

Publishing reserves the maximum obligation (lots times maximum price) against the appropriation and the window quota; award transfers the actual winning value and releases the difference. An open tender therefore holds resources for at most 72 turns (48 bidding plus 24 award). The tender's maximum price is checked against the current price floor for that component and grade, and a tender below it is refused. Bidding costs nothing. Existing signed contracts and any legacy direct offers keep their stored terms.

All the guardrails below (window cap, supplier cap, price band, self-dealing, fill eligibility) still apply to a tender award.

## Contract Award Limits (`defenceContractLimits.ts`)

Contracts are budgeted in quarter-year tranches, not against an unlimited future stream.

- **Contract window:** `DEFENCE_CONTRACT_WINDOW_TURNS = TURNS_PER_YEAR / 4` (one quarter).
- **Country cap:** `defenceContractLotCaps(defenseLine, pricePerLot)` computes `procurementNotional = defenseLine * (1 - SEED_UPKEEP_TARGET_SHARE) * (windowTurns / TURNS_PER_YEAR)`, the appropriation spends 55% of the annual defence line sustaining the seeded force (`SEED_UPKEEP_TARGET_SHARE`), so only the remaining 45% is a procurement budget, prorated to one window.
- **Supplier cap:** `defenceSupplierCapShare(stateOwned)`, a private supplier may take at most `DEFENCE_CONTRACT_SUPPLIER_SHARE = 1/3` of the country's window, so a minister cannot dump the whole tranche into one corporation. A **state-owned** supplier (National Corporation) gets the full window instead of a third: command economies seed one National Corporation per sector, and applying the private cap there would leave two thirds of the window unspendable across every other plant on that SOE.

## Turn Spend Cap (`defenceTurnSpendCap.ts`)

The award side limits the total a supplier may be *promised* in a window; this limits the rate at which that promise may *settle*, closing the throughput gap that let a single contract deliver an entire quarterly procurement window in one tick.

- `defenceProcurementAccrualPerTurn(defenceLine) = defenceLine * (1 - SEED_UPKEEP_TARGET_SHARE) / TURNS_PER_YEAR`, the same identity `defenceContractLotCaps` uses for a window, divided by the window length, so award and payout can never drift apart.
- `DEFENCE_TURN_SPEND_BURST = 3`, a country may pay out up to 3 turns' worth of accrual in a single turn (so a country that has been saving can spend the stockpile faster than it earned it).
- `defenceCountryTurnSpendCap = accrualPerTurn * 3`; `defenceSupplierTurnSpendCap` applies `defenceSupplierCapShare` on top (a third for private industry, all of it for a National Corporation).
- Over a full 12-turn window this sums to `3x` the window's total award quota, the cap never reduces what a legitimate buyer can spend across a window, it only stops the whole quota landing in one or two turns.
- `lotsWithinTurnSpendCap()` computes how many lots a contract may settle *this turn*, with a **one-lot-per-country-per-turn floor** so a small country whose lot price exceeds its whole turn cap still ships something. The floor is per country, not per contract, so it cannot be exploited by splitting one order into twenty.

## Lot Economics and Price Band (`defenceLotEconomics.ts`)

Cost is derived from price, not the other way round, inverting the old model.

- `TARGET_SUPPLIER_MARGIN = 0.15`, production cost is the GDP-anchored lot price less 15% (real-world large Western primes run 9-11% operating margin; US government contracting fee targets sit near 10-15%; the top of that range is chosen deliberately so procurement stays worth chasing).
- `MIN_CONTRACT_MARGIN = 0.12`, floor: a contract may never be written below cost + 12%.
- `MAX_CONTRACT_MARGIN = 1.0`, backstop ceiling on markup over cost, active only if the cost model is ever mis-derived; the GDP anchor is normally the tighter, binding ceiling.
- `lotCostIndex()` reads live commodity price ratios (see below) against the nominal recipe, clamped to `[LOT_COST_INDEX_MIN=0.7, LOT_COST_INDEX_MAX=1.5]`, a shortage squeezes the **supplier's** margin, never raises the price to the taxpayer.
- `GRADE_PRICE_SCALE` (grade 0-3): `{0: 0.7, 1: 0.85, 2: 1.0, 3: 1.25}`, cheap-mass vs. premium doctrine both fall out of one price dial.
- `lotPriceBand({anchorPrice, productionCost, grade})` returns `{productionCost, floor, ceiling, suggested}`, the band a minister may set a lot price inside. Not retroactive: a signed contract keeps the price (and margin) it was struck at even if the anchor moves later (`costBasis: "margin"` vs. legacy contracts, which settle on `legacyLotProductionCost`, the earlier flat-overhead model, kept only so already-signed contracts keep the terms players agreed to).
- **Factory slots:** `DEFENCE_FACTORY_SLOTS_PER_PLANT = 4`, a CEO splits a plant's throughput across contracts by assigning slots, not a figure derived from revenue (which would silently invalidate a standing allocation every turn). New private-supplier contracts default to an even split (`defaultFactoryAllocation`); a National Corporation (no player CEO to reallocate) takes every free slot at award (`awardFactoryAllocation`).

## Live Price Ratios (`defencePriceRatios.ts`)

Lot costing reads the same world commodity price ratio (`globalPrice / basePrice`) the corporation turn's own input-cost calculation uses, so a lot's cost floor and a plant's actual input bill move together. Deliberately the **world** ratio, not a country's reachable-market ratio, the award form is a client component that quotes a price band before any of that scope exists, and a world ratio is the same number for both sides of the negotiation. Never cached at module scope (a stale ratio would survive a world reset into the next era).

## Self-Dealing (`defenceSelfDealing.ts`)

The concentration cap stops one supplier taking the whole tranche; it says nothing about who owns that supplier. `resolveSelfDealing()` detects when the awarding minister has a stake in the receiving corporation:

- **`owner`**, same player (`userId`) on both sides of the contract, read even while a caretaker runs the corp so the relationship can't be laundered.
- **`shareholding`**, minister's own recorded shareholding is `>= MATERIAL_STAKE_SHARE = 5%`.
- Deliberately narrow: only the same player and the minister's own recorded holding count. There is no character relationship graph, so anything wider would be invented rather than observed.

The answer to self-dealing is **disclosure plus a political price**, not another cap:

- `selfDealingFavorabilityPenalty({contractValue, tranche})` scales `SELF_DEALING_BASE_PENALTY = 1.5` up to `SELF_DEALING_MAX_PENALTY = 8` favorability points, proportional to the contract's share of the window's procurement notional, a token order costs almost nothing, routing the whole quarter's budget to yourself is a career event.
- `selfDealingDisclosure()` writes one public wire-voice line naming the minister, the interest, and the contract value/lots, it goes on the public order book.

## Terminating a Contract (`defenceTermination.ts`)

Tearing up a signed contract used to be free, instant, and returned both the appropriation and the window quota, so a minister could cancel a rival's order and re-award the room to their own plant. Termination is now priced by basis (`terminationBasis`):

| Basis | When | Fee | Quota |
| --- | --- | --- | --- |
| Withdrawal | Contract still pending, supplier never accepted | 0 | Released |
| Cause | Supplier at fault for `DEFENCE_TERMINATION_CAUSE_TURNS = 3` delivery turns in a row | 0 | Released |
| Convenience | Anything else | `round(undelivered lots x pricePerLot x TARGET_SUPPLIER_MARGIN)`, i.e. 15% of the undelivered value | Stays spent |

- Supplier-fault reasons (`SUPPLIER_FAULT_REASONS`): `no_output`, `supplier_ineligible`, `supplier_cannot_fund_loss`. Buyer-side shortfalls (`appropriation_short`, `turn_spend_cap`) never count, so underfunding the budget cannot buy a free cancellation.
- The fee is paid from the defence appropriation immediately; if it cannot cover the fee the termination is refused.
- Favorability penalty: `TERMINATION_BASE_PENALTY = 1` up to `TERMINATION_MAX_PENALTY = 6`, scaled by the order's share of the window tranche. If the minister holds a stake (owner, or at least `MATERIAL_STAKE_SHARE`) in a different domestic corporation with a defence plant (`findCompetingSupplierInterest`), the penalty is multiplied by `TERMINATION_CONFLICTED_MULTIPLIER = 2`.
- The cancellation is disclosed on the public wire (`terminationDisclosure`) and the supplier is notified (`terminationNoticeToSupplier`).

## Fill Eligibility (`defenceFillEligibility.ts`)

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

## Procurement Gate (`procurementGate.ts`)

`isDefenceProcurementPaused(db)` reads `gameState.defenceProcurementPaused` (singleton `_id: "current"`, not filtered on `isActive`). When true:

- Awarding a **new** contract and a CEO **accepting** a pending offer both refuse.
- Everything already active is untouched, the delivery sweep keeps settling live contracts, and cancel/decline stay open.

This is a kill switch for a procurement-drain exploit, not a subsystem teardown.

## Worked Example

A country has an annual defence line of 48,000,000,000 and a lot price of 150,000,000 (grade 2, so the grade scale is 1.0).

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

## Timing

- **Tender lifecycle:** `governmentContractExpiry` (tenders past their award deadline become Canceled) and `governmentContractMaximaRefresh` (open tenders' maximum price re-checked against the live floor) are phases in `src/simulation/phases/turnPhaseRegistry.ts`, running after commodity prices.
- **Delivery sweep:** `applyDefenceDeliveries` runs inside the `ministerialOrders` phase (`processMinisterialOrders` in `src/lib/turn/ministerialOrderProcessing.ts`, run right after `crisisTurn` and before `policyEffects`) once per country per turn, before planned-economy state arms production, naval repair, refit and nuclear stockpile accrual. Materiel has to arrive before it can be issued, and conventional deliveries settle before the nuclear programme competes for the same appropriation.
- **Idempotency:** a contract settles at most once per turn (`defenceDeliveryMoveKey`), so a re-run turn replays rather than pays twice.
- **Windows:** `defenceContractWindow(countryId, turn)` splits turns into 12-turn windows starting at turn 1, so windows are turns 1 to 12, 13 to 24, and so on.
- **Award time:** caps, price band, self-dealing and eligibility are checked when a tender is published and awarded, not at delivery. The spend cap and eligibility are checked again at each delivery.

## Edge cases and limits

- **Unspent window room does not carry forward.** A fresh tranche opens each window.
- **Lot caps floor at 1.** If the country cap is above zero, the private supplier cap is at least 1 lot. If the defence line or lot price is zero or negative, every cap is 0.
- **One-lot floor on delivery.** If a country has paid nothing yet this turn, at least one lot settles even when its price exceeds the turn cap; the floor is per country per turn, so splitting an order into many contracts does not multiply it.
- **Cap never shrinks a window.** The per-turn cap is 3x the steady accrual and a window is 12 turns, so the cap only spreads payouts, never reduces the total a buyer can spend.
- **Price floor wins over ceiling.** If input costs run away so the cost-derived floor exceeds the anchor ceiling, the ceiling is raised to the floor: nothing may be written below cost plus 12%.
- **Cost shocks hit the supplier, not the taxpayer.** `lotCostIndex` is clamped to 0.7 to 1.5, and the price stays inside the band.
- **Grade out of range.** `normalizeGrade` rounds and clamps to 0 to 3, and a missing grade is treated as 3.
- **Self-dealing is disclosed, not blocked.** The penalty is capped at 8 favorability points, so no single award ends a career outright. Only the same player or the minister's own recorded shareholding of 5% or more counts; there is no relationship graph.
- **Demilitarisation.** A country under a demilitarisation settlement may award no new contract and no company may accept one from it until the bar lapses; live contracts keep delivering.
- **Paused procurement.** Only new awards and acceptances stop; live deliveries, cancel and decline continue.
- **Planned economies** (Soviet Union, East Germany) receive state arms output outside tenders (`stateArmsIndustry.ts`), and AI-run or state suppliers submit an initial suggested-price bid but get no direct-award shortcut.
- **Legacy contracts** settle on `legacyLotProductionCost` and keep the price and margin they were struck at.

## Connections

**Driven by:**

- [National Budget](./national-budget.md): the defence line sets every cap (`resolveDefenseLine` in `src/lib/turn/defenseEnvelope.ts`, `SEED_UPKEEP_TARGET_SHARE` in `src/lib/military/appropriation.ts`).
- [Commodities](./commodities.md): world price ratios feed lot cost (`defencePriceRatios.ts`).
- [Corporations](./corporations.md): plant output and strategy decide fill eligibility and who can bid.
- [Government Approval](./government-approval.md): self-dealing and termination penalties reduce the minister's favorability.

**Affects:**

- [Conflict System](./conflict-system-as-shipped.md): delivered lots enter the national arsenal (`depositLots`) and become unit strength and refit.
- [Corporations](./corporations.md): award payments credit supplier cash (`applyMoneyMove` in `defenceDeliveryTurn.ts`).
- [National Budget](./national-budget.md): deliveries draw down the defence appropriation encumbrance.

## Related Systems

- [conflict-system-as-shipped.md](./conflict-system-as-shipped.md) - Arsenal components, unit grades, and how procured materiel becomes combat effectiveness
- [corporations.md](./corporations.md) - Corporate sectors, strategies, revenue

Last checked: 2026-10-29, version 1.18.0
