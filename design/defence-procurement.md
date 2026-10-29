# Defence Procurement

## Overview

Defence procurement lets a country's ministry award contracts to domestic corporations to build materiel (arsenal components) for its military. The subsystem is a set of independent guardrails around what used to be an almost unbounded transfer channel from the national defence appropriation into corporate cash, the [defence price-band drain](#background-the-price-band-drain). Each guardrail is a small, pure module so the award route, the delivery sweep, and the client-side award form can all agree on the same numbers.

**Location:** `src/lib/military/`

**Key files:**

- `defenceContractLimits.ts` - Per-window award caps (how much may be promised)
- `defenceTurnSpendCap.ts` - Per-turn payout caps (how fast a promise may be paid)
- `defenceLotEconomics.ts` - Lot cost, price band, margin, factory-slot allocation
- `defenceSelfDealing.ts` - Minister/supplier conflict-of-interest detection and penalty
- `defencePriceRatios.ts` - Live commodity price ratios feeding lot costing
- `defenceFillEligibility.ts` - Whether a plant can hold/deliver a given contract
- `procurementGate.ts` - Global pause switch for new procurement

## Background: the Price-Band Drain

A delivery credits the supplier `pricePerLot - productionCost` per lot. Under the original cost model, a lot could be priced in the hundreds of millions while costing a few thousand to build, a margin above 99.99%. Because the price band's top was the GDP anchor (five orders of magnitude above the true build cost) and the cost model was an unrelated flat commodity-recipe figure, a defence contract was very close to a pure transfer of national appropriation into one corporation's cash balance. A minister with a stake in the supplier directly benefited. The guardrails below are the mitigation, not a full clawback (contracts already signed keep their terms).

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

## Related Systems

- [conflict-system-as-shipped.md](./conflict-system-as-shipped.md) - Arsenal components, unit grades, and how procured materiel becomes combat effectiveness
- [corporations.md](./corporations.md) - Corporate sectors, strategies, revenue
