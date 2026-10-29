# Corporate Mergers and Acquisitions

## Summary

Player guide: [Corporate Mergers & Acquisitions](https://www.ahousedividedgame.com/wiki/corporate-mergers)

Players can offer to buy another non-state-owned corporation outright, whether a player or an AI (NPP) runs it. The acquirer's CEO proposes an all-in price and an outcome, **merge** or **keep as subsidiary**. A player-run target's CEO accepts or rejects; an AI-run target resolves automatically against its asking price. On a merge, the target's shareholders are cashed out, its cash and sectors move to the acquirer, and the target corporation is deleted. On a subsidiary outcome the shareholders are cashed out but the target survives with the acquirer as its only shareholder. If the combined firm would hold too large a share of a national industry, or a foreign-controlled group would take over a company under a screening law, the deal is referred to a named cabinet officeholder for review before it can complete. The whole subsystem is gated by the `corpDealsEnabled` game flag.

Why it works this way: acquisitions are the only way to fold one corporation into another, so the review gate exists to stop a player rolling up a whole national industry through offers. The reviewing seat is a named officeholder with published fallback bands, so a vacant seat is neither a loophole nor a coin flip.

## Rules

| Constant | Value | Source |
| --- | --- | --- |
| `ACQUISITION_OFFER_DURATION_TURNS` | 24 turns | `src/lib/corporations/commands/acquisitions/acquisitionOffers.ts` |
| `NPP_ACQUISITION_PREMIUM_MULTIPLIER` | 1.1 (AI-run target asking price = ceil(reference valuation x 1.1)) | `src/lib/corporations/commands/acquisitions/rules.ts` |
| `MERGER_REVIEW_THRESHOLD_PERCENT` | level 0 off, 1: 75, 2: 60, 3: 50, 4: 40 | `src/lib/corporations/mergerReview/constants.ts` |
| `MERGER_REVIEW_TURNS` | 6 turns for the seat to rule | `src/lib/corporations/mergerReview/constants.ts` |
| `MERGER_REVIEW_REMEDY_MARGIN_PERCENT` | 5 points above threshold: auto-clears with remedy | `src/lib/corporations/mergerReview/constants.ts` |
| `MERGER_REVIEW_BLOCK_MARGIN_PERCENT` | 15 points above threshold: auto-blocks | `src/lib/corporations/mergerReview/constants.ts` |
| `MERGER_REMEDY_TURNS` | 12 turns to divest after the deal commits | `src/lib/corporations/mergerReview/constants.ts` |
| `MERGER_REMEDY_OVERDUE_FINE_RATE` | 0.05 of controlled-group revenue in the ordered industry, per turn | `src/lib/corporations/mergerReview/constants.ts` |
| Screening referral threshold | 100 (stored on the review; the margin can never reach the remedy band, so an undecided screening review auto-clears) | `assertMergerClearance` in `src/lib/corporations/mergerReview/gate.ts` |
| `GROUP_MERGER_CONCENTRATION_STAGE` | 5 (the `groupSizeCostsStage` at which concentration measures whole control groups) | `src/lib/corporations/mergerReview/concentration.ts` |
| Review note length | 500 characters | `src/app/api/merger-reviews/[id]/route.ts` |
| Deals route rate limit | 10 requests per 60 seconds per user | `src/app/api/corporations/[id]/deals/route.ts` |
| `corpDealsEnabled` default | `true` for fresh worlds only (see Configuration) | `src/lib/seeds/reference/featureFlagDefaults.ts` |

### Proposing an offer

Entry point: `proposeAcquisitionOffer()` in `src/lib/corporations/commands/acquisitions/acquisitionOffers.ts`, called from `POST /api/corporations/[id]/deals` with `action: "propose"`.

Rejected up front if:
- Acquirer and target are the same corporation.
- The target is state-owned (`countryOwnerId` set or `ownershipState === "stateOwned"`), including a state flip found when the target is re-read.
- `priceAnchor` is not a finite positive number.
- The acquirer is under an **overdue** divestiture order (`acquisitionsBarredByDivestiture`, see Divestiture remedy below), a still-current order does not bar new offers, only one that has run past its due turn. Returned as 403.
- The acquirer already has a `pending` offer open against the same target (409).
- The target is AI-run and controlled by another corporation (`getControllingCorporateParent`): the parent decides, so an outsider cannot buy it (400).
- The outcome is `subsidiary` and the subsidiary checks fail (see Subsidiary outcome below).

Target discovery uses `GET /api/corporations/buyer-search?q=...&exclude=<corpId>`, a name search across player-run and AI-run (`ceoType: "npp"`), non-state-owned corporations in **any country** (cross-border acquisitions are intentional, per code comment referencing issue #106). A corp counts as player-run via `PLAYER_RUN_CEO_FILTER` (`src/lib/corporations/playerRunCeo.ts`).

On success, an `AcquisitionOffer` document is inserted into the `acquisitionOffers` collection:

| Field | Notes |
|---|---|
| `priceAnchor` | Agreed all-in price for the whole target, in anchor currency (₳), rounded |
| `targetValuationAnchor` | Reference valuation captured at propose time (see below), rounded |
| `status` | `"pending" \| "accepted" \| "rejected" \| "withdrawn" \| "expired" \| "failed"` |
| `outcome` | `"subsidiary"` when the offer keeps the target as a subsidiary; absent for a merge |
| `createdAtTurn` / `expiresAtTurn` | Offer lasts `ACQUISITION_OFFER_DURATION_TURNS = 24` turns |
| `proposedByCharacterId` / `proposedByUserId` | Who proposed, for authorization on withdraw |

If the target has a player CEO (`target.userId` set), a `corp_vote_opened`-type notification is sent pointing them to the Deals tab.

If the target is genuinely AI-run (`ceoType: "npp"` with no player caretaker, `isNppAutoResolvableTarget`), no human can press Accept: the offer resolves immediately. A price at or above `nppAcquisitionMinimumPrice` (reference valuation x 1.1, rounded up) auto-accepts and executes; a lower price is stored as `"rejected"`. Caretaker-run corporations stay player property and follow the normal pending-offer flow. If an auto-accepted offer then fails at execution (a guard, or a merger referral), the offer is flipped to `"rejected"` and the failure is returned; a thrown error also flips it to `"rejected"` and rethrows.

#### Reference valuation

`referenceValuationAnchor()` computes a display/fair-value anchor for the target, independent of the offer price:

```
whole-corp value = computeWholeCorpValuation({
  sharePrice: target.sharePrice (converted to ₳),
  totalShares: target.totalShares,
  balanceSheetEquity: liquidCapital (₳) + sectorNpvAnchor,
  debt: 0,   // v1 blocks bonded targets entirely, so no debt to net out
})
// computeWholeCorpValuation (src/lib/nationalization/compensation.ts):
//   max(0, max(sharePrice x totalShares, balanceSheetEquity) - debt)
```

So the valuation is the **larger** of market capitalization and balance-sheet equity, never their sum. `sectorNpvAnchor` comes from `sectorExitValueAnchor()` (`src/lib/bonds/sectorExitBasis.ts`), the same replacement-cost-book anchor used for other corp exits (dissolution, restructuring, nationalization) once plants are enabled for the active market mode. The code comment (tagged "D11") is explicit that this is deliberate: a corp whose value is its plants should be quoted the plants, not a capitalized earnings stream. Below plants the sector leg is going-concern NPV with the growth cost excluded (`excludeGrowthCost: true`).

### Responding to an offer

`POST /api/corporations/[id]/deals` with `action: "accept" | "reject" | "withdraw"`:
- `withdraw`, only the **acquirer**'s CEO.
- `accept` / `reject`, only the **target**'s CEO.
- All three require the offer to still be `"pending"`; acceptance additionally requires `currentTurn <= offer.expiresAtTurn`.
- Accept uses an atomic `findOneAndUpdate`-style claim (`updateOne` filtered on `status: "pending"`) so only one caller can transition `pending → accepted`; a losing racer gets 409.
- If a settlement is holding acquirer money when a reject or withdraw arrives, the settlement is compensated first (the undelivered remainder is refunded), then the offer is closed.

### Executing an accepted acquisition

`acceptAcquisitionOffer()` claims the offer, then calls `executeAgreedAcquisition()` (`src/lib/corporations/commands/acquisitions/executeAgreedAcquisition.ts`). Settlement is recorded in an `acquisitionSettlements` document claimed before money moves; each payout leg applies as an atomic credit-plus-stamp write, so a retry resumes from the record and never pays a holder twice. If execution returns `ok: false` before any money moves, the claim is released so the offer can be retried (status back to `pending`); a permanently unpayable leg refunds only the undelivered remainder and the offer goes to `"failed"`.

#### v1 scope guards

Two acquisition types are blocked outright with an error rather than being mishandled:
- Target has any un-matured bond (`bonds` collection, `matured: false`), bond assumption is deferred.
- Target holds equity in another corporation (`shareholders.corporationId` match), cross-holding transfer / acquiring a corporate parent is deferred.

Both guards apply to the **merge** outcome only. Under the **subsidiary** outcome the target survives with its bonds and holdings, and `checkSubsidiaryAcquisition` instead refuses chaining, circular ownership and one player running both parent and subsidiary.

#### Bank charter and law guards

- **Bank charter.** A merge moves the target's bank charter to the acquirer (`transferBankCharterToAcquirer`, `src/lib/banking/transferCharter.ts`). It is refused up front (`bankTransferConflict`) when the target has settlement in flight (sovereign primary funding, construction funding, a funded underwriting placement, a forex fee, or funded sovereign escrow) or when the target operates an active bank and the acquirer already has a charter, because a corporation holds one bank only. A subsidiary outcome leaves the charter on the target.
- **Foreign Investment Act.** `assertForeignControlAllowed` (`src/lib/mechanicalLaws/guards.ts`) refuses a buyer whose controlling group is headquartered outside the target's country when the target country's Foreign Investment Act is at the ban level.
- **Subsidiary Limits Act.** For the subsidiary outcome, `assertSubsidiaryWithinCap` refuses when the buyer's controlled group already runs the maximum number of subsidiaries headquartered in the target's country.
- **One live settlement per target.** The target document is stamped with `acquisitionSettlementId`; a second concurrent offer for the same target gets 409 "Another acquisition of ... is already in progress".

#### Subsidiary outcome

`checkSubsidiaryAcquisition` (`src/lib/corporations/commands/acquisitions/subsidiaryOutcome.ts`, rules in `rules/subsidiaryOutcome.ts`) runs at propose time and again at execution. It refuses when: `subsidiaryCorporationsEnabled` is off; the acquirer is state-owned or already a formalized subsidiary; the target is state-owned, already controlled by another corporation, already a formalized subsidiary, or controls other corporations (no chains); buying it would create an ownership cycle; or the target's CEO already runs another of the acquirer's subsidiaries, or is the same player as the parent's CEO. On success the executor pays the price the same way as a merge, then `transferTargetEquityToAcquirer` rewrites the cap table so the acquirer is the only shareholder (`publicFloat` 0, `subsidiaryFormalizedAtTurn` set, pending share issuance and dual-class structure removed). Open orders, listings and offers on the target's shares are cancelled first, and index fund holdings in the target are swept. The target's sectors, cash, bonds, bank charter, identity and CEO are untouched.

#### Merger review gate (runs before any money moves)

`assertMergerClearance()` is called with trigger `"agreedAcquisition"`. If it returns `ok: false`, execution stops before any state changes, "a referral must leave the two corporations exactly as it found them" per the code comment. See Merger review below for the full gate logic.

#### Money and asset flow (once clearance is `ok`)

1. **Debit acquirer** the agreed price, converted to the acquirer's liquid currency via `anchorToCorpLiquidCapital`. Atomic, balance-gated (`atomicallyDebitCorpLiquidCapital`); insufficient funds aborts with a 400 before anything else happens.
2. **Pay target's shareholders** the agreed price pool through a pinned payout plan (`buildAcquisitionPayoutPlan`, `src/lib/corporations/commands/acquisitions/rules/acquisitionPayoutPlan.ts`) built on `allocateShareholderPool`: each shareholder row gets `floor(price x shares / totalShares)`, characters and imperial characters to personal balances, corporate holders to `liquidCapital`, index funds to fund cash, and the public float slice to the target country's treasury (`federalBudget`). Per-row rounding dust and holder rows that match no bucket (for example NPP holders) are paid to nobody; this is a deliberate copy of the dissolution allocation's behaviour. Character holders accrue a pending stock tax receipt when the stock holding tax has started (`stockHoldingTaxStartTurn`). If a leg is permanently unpayable the settlement compensates.
3. **Fold target's liquid cash into the acquirer**, the target's own `liquidCapital` converts to ₳ and credits the acquirer. Money is conserved: the offer price went to shareholders; the target's own cash just relocates to its new owner.
4. **Move every target sector to the acquirer** via `moveSectorToCorp()`, described as "haircut-free" (no value loss), with currency re-denomination between target and acquirer currencies.
5. Two/three ledger transactions are emitted (`share_buyout_outflow` for the acquirer's outflow, `corp_dissolution_distribution` for the shell cash absorbed/released), timed after every asset mutation succeeds so a failure earlier logs nothing.
6. **Tear down the target shell**: cleans up its share-market activity, stamps it deleted (`stampSubjectDeleted`), records the exit as `acquired` with the acquirer as successor (`recordCorporationExit`), then `corps.deleteOne`.
7. If the merger review cleared **with a remedy**, `attachMergerRemedy()` is called only now, after the merger has actually committed, to open the divestiture obligation.
8. An audit record (`action: "acquisition.execute"`) is written.
9. Every other pending offer that referenced the now-deleted target (as either acquirer or target) is set to `"withdrawn"`.

### Merger review ("C3")

Code: `src/lib/corporations/mergerReview/{constants,gate,authority,concentration,divestiture,lifecycle}.ts`. Db type: `src/lib/db/types/mergerReview.ts`, collection `mergerReviews`.

#### When it applies

Gating is on **ownership and marketization**, never a country allow-list (explicit design note in `constants.ts`, referencing spec `ahd-b4-scrutiny-rework-spec`):
- Both acquirer and target must be privately owned, if either side is state-owned, the deal is an act of the state, not a reviewable transaction.
- The target's country must not be a command economy (`loadCommandEconomyBlockedCountries`), in a command economy the state already owns the firms, so review is deliberately inert, not a gap.
- The target's country must have an antitrust law: an explicit entry in `ANTITRUST_LAW_BY_COUNTRY` for `US`, `UK`, `RU`, `DD`, or, for every other legislature, its Competition Act from `mechanicalLaws` (or a carried law, such as the GDR competition primary that DE inherits on reunification), and a reviewing seat in `MERGER_AUTHORITY_SEAT_BY_COUNTRY` (see mapping below), with an enacted level whose threshold is not `null` (level 0 = "No Antitrust Enforcement" = off).
- The reviewing country must currently have the seat for that law in the current era (`resolveMergerAuthority` returns non-null). A seat that exists but is vacant or held by an NPP still counts: the review just runs to its deadline and resolves on the published bands.
- **Foreign Investment Act screening is a second trigger.** When the buyer's controlling group is headquartered outside the target's country and the target country's Foreign Investment Act is at a screening or cap level, the deal is referred even below the concentration threshold (review `reason: "foreignScreening"`). That review auto-clears at its deadline unless the authority blocks it.

Two call sites trigger the gate, both at the instant two corporations would actually become one: `executeAgreedAcquisition` (trigger `"agreedAcquisition"`) and the hostile-takeover squeeze-out route (trigger `"hostileTakeover"`, not documented here). Reviewing at share-purchase time would be too early, per the code's own reasoning, until absorption the two firms are still measured separately.

#### Antitrust law to threshold mapping

Each country's antitrust *level* (0-4, from its existing competition-primary legislation, not a new statute) maps to a combined-market-share trip threshold:

| Country | Antitrust Law (existing legislation id) | Reviewing Cabinet Seat |
|---|---|---|
| US | `us.economy.competition.primary` (Antitrust and Fair Commerce Act) | Attorney General (`attorney_general`) |
| UK | `uk.economy.competition.primary` (Restrictive Practices and Competition Act) | Business Secretary (`business_secretary`, era-renamed Board of Trade → Trade and Industry → Business) |
| RU | `ru.economy.competition.primary` | Minister of Internal Trade (`minister_of_internal_trade`) |
| DD | `dd.economy.competition.primary` | Minister of Internal Trade (`minister_of_internal_trade`) |
| Every other legislature | its Competition Act (`mechanicalLaws`); DE also carries the GDR competition primary | DE and JP: economy minister (`economy_minister`); IE: `minister_for_enterprise`; CN: `minister_of_commerce`; NG, FR, IT, ES, SE, TR, GR, AT, FI, BR: `minister_of_trade_industry`; PL, HU, RO, BG, CS, YU, UKR, BLR, BAL: `minister_of_internal_trade` |

`MERGER_REVIEW_THRESHOLD_PERCENT` by enacted level:

| Level | Meaning | Threshold |
|---|---|---|
| 0 | No Antitrust Enforcement | off (`null`) |
| 1 | Case-by-Case Review / Monopolies Commission | 75% |
| 2 | Active Enforcement | 60% |
| 3 | Structural Enforcement | 50% |
| 4 | Open Markets Charter | 40% |

`thresholdForLevel` rounds and clamps the level into 0 to 4, and returns `null` for a non-finite level.

#### Measuring concentration

`computeMergerConcentration()` measures the **combined post-merger share** of every industry (`CorporationType`) where either side has a physical presence, scoped to the **target's home country**, that is the state whose market structure changes and whose authority reviews it. Only sectors physically located in that country count for both sides (a foreign acquirer's home-market plants don't count toward the target-country concentration).

The denominator is the same `loadIndustryBasis()` rollup used for the corporation page's own market-share displays, so the number shown to the reviewing authority matches what a player sees elsewhere. The basis is ₳ revenue below plants and capacity units under plants. For each overlapping sector type: `acquirerSharePercent`, `targetSharePercent`, `combinedSharePercent` (all rounded to 2 dp). The industry with the highest `combinedSharePercent` becomes `leadSectorType` and is the one measured against the threshold and, if remedied, the one ordered divested.

An industry only counts as an overlap if **both** sides hold share in it (ticket #1163). A single-sided industry is unchanged by the deal, so referring on it would report a state of the world the merger did not create. When `groupSizeCostsStage` is at least 5, each side is its whole control group (the acquirer's group, and the target with everything it controls, minus members already in the acquirer's group) so a deal cannot be sliced into pieces that each look small.

#### The gate decision (`assertMergerClearance`)

Idempotent per `(acquirer, target)` pair:
1. If a review already exists for the pair with status `pending`, `blocked`, `cleared`, or `clearedWithRemedy`:
   - `cleared` / `clearedWithRemedy` → proceed (the clearance is durable, letting a referred hostile takeover simply retry once cleared).
   - `pending` → blocked, 409, with the decision deadline in the error message.
   - `blocked` → blocked, 400, permanently.
2. If review does not apply (ownership/marketization checks fail, no antitrust law mapped and no screening, level threshold is `null` and no screening, or no authority seat) → proceed, no review opened.
3. Otherwise concentration is computed. If there's no overlapping sector or `combinedSharePercent < threshold`, and screening does not apply → proceed.
4. Otherwise a new `MergerReview` document is inserted with `status: "pending"`, `openedAtTurn: currentTurn`, `decideByTurn: currentTurn + MERGER_REVIEW_TURNS` (6 turns). The call returns `ok: false`, 409, blocking the deal. Notifications go to the seat holder (if a player) and to both corporations' owning users.

#### Deciding a review

Two paths, both funneling through `decideMergerReview()` in `lifecycle.ts`:

**Officeholder decision**, `POST /api/merger-reviews/[id]/route.ts`. Authorization is the **seat**, re-resolved from `cabinetMembers` on every request (not cached, not derived from `character.currentOffice`), whoever holds the seat right now decides, and a reshuffled-out minister loses the queue immediately. Decision is one of `"cleared" | "clearedWithRemedy" | "blocked"`, with an optional free-text note (max 500 chars) shown to both CEOs.

**Deadline fallback**, `resolveDueMergerReviews()`, a turn-phase sweep that resolves every review whose `decideByTurn <= currentTurn` and is still `pending`, using the deterministic, published `autoResolveDecision()`:

```
margin = combinedSharePercent - thresholdPercent
margin >= 15 (MERGER_REVIEW_BLOCK_MARGIN_PERCENT)  -> blocked
margin >= 5  (MERGER_REVIEW_REMEDY_MARGIN_PERCENT) -> clearedWithRemedy
otherwise                                          -> cleared
```

The code is explicit that this is deliberately readable off the card ahead of time, "the difference between a review and a coin flip", and only kicks in when nobody holds the seat, or the holder lets the clock run out; a seated officeholder can decide however they like regardless of the bands.

A `clearedWithRemedy` decision always targets `review.leadSectorType`, the officeholder cannot pick a different sector to declare "solved," per an explicit anti-abuse comment.

The atomic claim on `pending → decided` prevents an officeholder decision and the deadline sweep from racing each other.

#### Divestiture remedy

If a review resolves `clearedWithRemedy`, the obligation is **not** attached at decision time, only once the underlying deal actually commits, via `attachMergerRemedy()` called from `executeAgreedAcquisition` (or the takeover executor) after the merge succeeds. The obligation (`PendingDivestiture`, stored as `corporation.pendingDivestiture`):

- `sectorType`: the industry ordered divested (`review.remedySectorType`, always `leadSectorType`).
- `dueTurn`: `currentTurn + MERGER_REMEDY_TURNS` (12 turns).
- `thresholdPercent`: the share the acquirer's **controlled group** must fall below, carried on the obligation itself so a later law change can't retroactively satisfy or fail it.
- `countryId`: reviewing country, so any fine reaches the right treasury.

**Discharge is measured, not procedural.** `settleDivestitureIfSatisfied()` (in `divestiture.ts`) checks whether the acquirer's **controlled group** (itself plus every corp it controls at >50% voting power, computed by `controlledGroupIds()`, a closure walk over `shareholders`/`totalShares`/`superShareMultiplier`, cycle-safe) still holds `>= thresholdPercent` of the ordered industry in the ordered country. A spin-off into a wholly-owned subsidiary does **not** discharge the order (the group's share is unchanged); the group has to actually sell down. This can be called opportunistically after any relevant action, and from the turn sweep.

**Overdue enforcement**, `fineOverdueDivestitures()`, a turn phase:
- Selects corporations with `pendingDivestiture.dueTurn < currentTurn`.
- Re-checks discharge first (a group may have sold down already).
- Fine base: the **controlled group's** ₳ revenue in the ordered industry, in the reviewing country (using `loadIndustryBasis`'s `anchorByCorp`), not just the parent's own sectors, pushing the business into a subsidiary must not zero the fine.
- Fine rate: `MERGER_REMEDY_OVERDUE_FINE_RATE = 0.05` (5%) of that group revenue, **per turn**, debited from the corp's liquid capital and credited to the reviewing country's treasury (`creditTreasuryProceedsFromAnchor`, flow `regulatory_fine`), converted to the treasury's currency. If the corp can't pay this turn, the debit simply fails and the order stands for retry next turn (no partial payment, no escalation logic beyond the flat 5%).
- An overdue corp is also barred from opening **new** acquisitions (`acquisitionsBarredByDivestiture`, checked at the propose step, current turn > `dueTurn`).
- A notification is sent to the corp's owning user each time it's fined, and a `corp_fine` ledger row is written.

### API surface

| Route | Method | Purpose |
|---|---|---|
| `/api/corporations/[id]/deals` | GET | Pending incoming/outgoing offers for a corp the viewer runs; reports `{ enabled: false }` shape if flag off |
| `/api/corporations/[id]/deals` | POST | `action: propose \| accept \| reject \| withdraw`; rate-limited 10/60s per user; requires `corpDealsEnabled` + general corp-actions flag |
| `/api/corporations/buyer-search` | GET | Name search for acquisition targets (and supply-agreement counterparties), any country, player-run + non-state-owned only |
| `/api/merger-reviews` | GET | CEO-side view: reviews involving any corp the viewer runs (both sides), decided or not |
| `/api/merger-reviews/queue` | GET | Officeholder-side view: national pending/decided queue for the seat the viewer holds; `no-store`; fails closed to `{ applies: false }` if no seat, wrong era, command economy, or seat not held |
| `/api/merger-reviews/[id]` | POST | Officeholder hands down `cleared \| clearedWithRemedy \| blocked`, with optional note; seat re-resolved server-side every call |

### UI

- `src/components/corporation/DealsTab.tsx`, propose/accept/reject/withdraw UI, target search-by-name, renders `MergerReviewPanel` alongside it.
- `src/components/corporation/MergerReviewPanel.tsx`, CEO-facing view of reviews touching the player's corp(s).
- `src/components/mergerReview/MergerReviewCard.tsx`, shared review-summary card component.
- The officeholder queue (`/api/merger-reviews/queue`) is consumed by a cabinet/national-office surface, not `DealsTab`, it deliberately never appears on a corporation's own page.

### Key files

- `src/lib/api/requireCorpDeals.ts`, the `corpDealsEnabled` flag gate
- `src/lib/db/types/gameState.ts`, flag fields on `gameState`
- `src/lib/seeds/reference/featureFlagDefaults.ts`, flag default (`true` for fresh worlds)
- `src/lib/db/types/acquisitionOffer.ts`, `AcquisitionOffer` type
- `src/lib/corporations/commands/acquisitions/acquisitionOffers.ts`, propose/accept/reject/withdraw, reference valuation, deal listing
- `src/lib/corporations/commands/acquisitions/executeAgreedAcquisition.ts`, the actual merge execution
- `src/lib/corporations/commands/acquisitions/acquisitionSettlement.ts`, settlement record, legs and compensation
- `src/lib/corporations/commands/acquisitions/rules/acquisitionPayoutPlan.ts`, pinned payout plan
- `src/lib/corporations/commands/acquisitions/subsidiaryOutcome.ts`, subsidiary eligibility and equity transfer
- `src/lib/corporations/commands/acquisitions/executeAgreedAcquisition.test.ts`, coverage of the execution path
- `src/lib/db/types/mergerReview.ts`, `MergerReview` and `PendingDivestiture` types
- `src/lib/corporations/mergerReview/constants.ts`, law/seat mapping, thresholds, bands, turn windows
- `src/lib/corporations/mergerReview/gate.ts`, `assertMergerClearance`, `acquisitionsBarredByDivestiture`
- `src/lib/corporations/mergerReview/authority.ts`, `resolveMergerAuthority`
- `src/lib/corporations/mergerReview/concentration.ts`, `computeMergerConcentration`
- `src/lib/corporations/mergerReview/divestiture.ts`, `controlledGroupIds`, `groupIndustrySharePercent`, `settleDivestitureIfSatisfied`
- `src/lib/corporations/mergerReview/lifecycle.ts`, `decideMergerReview`, `resolveDueMergerReviews`, `attachMergerRemedy`, `fineOverdueDivestitures`
- `src/app/api/corporations/[id]/deals/route.ts`, deals GET/POST
- `src/app/api/corporations/buyer-search/route.ts`, target search
- `src/app/api/merger-reviews/route.ts`, CEO-side review list
- `src/app/api/merger-reviews/queue/route.ts`, officeholder queue
- `src/app/api/merger-reviews/[id]/route.ts`, officeholder decision
- `src/components/corporation/DealsTab.tsx`, `src/components/corporation/MergerReviewPanel.tsx`, `src/components/mergerReview/MergerReviewCard.tsx`, UI

## Data

| Collection | Fields | Read / written | Player-visible |
| --- | --- | --- | --- |
| `acquisitionOffers` | `acquirerCorporationId`, `targetCorporationId`, `priceAnchor`, `targetValuationAnchor`, `status`, `outcome`, `createdAtTurn`, `expiresAtTurn`, `resolvedAtTurn`, proposer ids | Written by propose, accept, reject, withdraw, and by the withdraw-others sweep after a commit | Yes, in the Deals tab (pending offers only) |
| `acquisitionSettlements` | pinned payout legs with per-leg stamps, `status` (`in_progress`, `applied`, `compensated`), progress flags (`equityTransferred`, `bankCharterTransferred`, `sectorsMoved`, `shellDeleted`), `completedResult` | Written by the executor before money moves; read on retry | No |
| `corporations` (target) | `acquisitionSettlementId` (claim), `shareholders`, `publicFloat`, `subsidiaryFormalizedAtTurn`, `liquidCapital`, `bankCharter` | Claim and equity transfer written; deleted on a merge | Partly |
| `corporations` (acquirer) | `liquidCapital` (debit, then shell cash credit), `pendingDivestiture { reviewId, sectorType, dueTurn, thresholdPercent, countryId }` | Written | Cash and the order, yes |
| `corporateSectors` | `corporationId` | Read for valuation and concentration; rewritten by `moveSectorToCorp` on a merge | Yes |
| `mergerReviews` | `acquirerCorporationId`, `targetCorporationId`, `countryId`, `authoritySeatId`, `lawLevel`, `thresholdPercent`, `leadSectorType`, `combinedSharePercent`, `overlaps`, `trigger`, `reason`, `status`, `openedAtTurn`, `decideByTurn`, `resolvedAtTurn`, `resolvedBy`, `decidedByCharacterId`, `decisionNote`, `remedySectorType` | Written by the gate, the officeholder route and the deadline sweep | Yes, to both CEOs and the seat holder |
| `cabinetMembers` | `positionId`, `characterId`, `isNPP` | Read to resolve the seat holder | Yes |
| `characters`, `imperialCharacters`, `indexFunds`, `federalBudget` | personal balance, fund cash, treasury balance | Written by payout legs and fines | Balance yes |
| `gameState` (`_id: "current"`) | `corpDealsEnabled`, `corpDealsEnabledBy`, `corpDealsEnabledAt`, `subsidiaryCorporationsEnabled`, `corporationActionsPaused`, `stockHoldingTaxStartTurn` | Read | No |
| `gameConfig` (`_id: "default"`) | `marketSystemMode`, `groupSizeCostsStage` | Read | No |
| notifications | `corp_vote_opened`, `merger_review_opened`, `merger_review_decided`, `merger_remedy_overdue` | Written | Yes |
| financial transaction log | `share_buyout_payout`, `share_buyout_outflow`, `corp_dissolution_distribution`, `corp_fine` | Written | Admin only |

## Configuration

| Setting | Default | Effect | Where set |
| --- | --- | --- | --- |
| `gameState.corpDealsEnabled` | `true` on fresh worlds; an existing world with the field absent is treated as off | Server-side gate on `POST /deals`: HTTP 403 `"Corporate acquisitions are not currently enabled."` when off. `GET` reports `{ enabled: false, incoming: [], outgoing: [] }` instead of erroring. Also tracked: `corpDealsEnabledBy`, `corpDealsEnabledAt`. | `gameState` document; seeded by `src/lib/seeds/reference/featureFlagDefaults.ts`; guard in `src/lib/api/requireCorpDeals.ts` |
| `gameState.subsidiaryCorporationsEnabled` | `true` on fresh worlds | Needed for the subsidiary outcome; `GET` reports `subsidiaryAvailable` | `featureFlagDefaults.ts`, read in `subsidiaryOutcome.ts` |
| `gameState.corporationActionsPaused` | `false` | While paused, `POST /deals` is refused (`requireCorporationActionsEnabled`) | `gameState` document |
| `gameConfig.marketSystemMode` | `"off"` when absent | At `"plants"` or above, valuation uses book value and concentration uses capacity units | `gameConfig` document |
| `gameConfig.groupSizeCostsStage` | 0 | At 5 or more, concentration measures whole control groups | `gameConfig` document, `GROUP_MERGER_CONCENTRATION_STAGE` |
| Enacted competition law level, per country | per country and era | Sets the review threshold (0 to 4) | Legislation (`mechanicalLaws` and the competition primaries) |
| Foreign Investment Act level, per country | open | Ban refuses a foreign buyer outright; screening and cap levels add the screening referral | `mechanicalLaws` |
| Subsidiary Limits Act level, per country | open | Caps how many subsidiaries one group may run in the country | `mechanicalLaws` |
| Era | per world | A seat that does not exist yet in the era means no review | `src/lib/cabinet/rosterEra.ts` |

All numeric constants are code constants listed under Rules; none is overridden by scenario.

## Timing

- **Offers** are player-driven requests, not a turn phase. Proposal, accept, reject and withdraw take effect immediately when the API call is made. Expiry is checked only when someone tries to accept (`currentTurn > expiresAtTurn` fails with "This offer has expired"); no sweep rewrites the status.
- **Merger review sweep** runs inside the `corporationTurn` phase (`src/lib/turn/corporation/index.ts`), after subsidiary cleanup so the controlled-group measurement reads settled ownership: first `resolveDueMergerReviews` (reviews past `decideByTurn`), then `fineOverdueDivestitures`, then antitrust compliance (`processAntitrustCompliance`, which enforces the Subsidiary Limits and Foreign Investment Acts). It is best-effort and cannot fail the turn.
- **Gate timing:** review is checked at the instant two corporations would combine (`executeAgreedAcquisition`, and the hostile-takeover squeeze-out), not when shares are bought.
- **Remedy attach:** the divestiture obligation is attached only after the merge commits, and the 12-turn clock starts then.

```
propose (API) --> [AI target?] --yes--> price >= ceil(valuation x 1.1)? --no--> offer "rejected"
      |                                          | yes
      no                                         v
      v                                   executeAgreedAcquisition
 offer "pending" --accept (target CEO)---------->|
                                                 v
                          guards (bonds, equity, bank, Foreign Investment, Subsidiary Limits)
                                                 v
                                   assertMergerClearance
                       no referral |                      | referral: review "pending", deal 409
                                   v                      v
                              pay + move          corporationTurn sweep
                                   |              resolveDueMergerReviews (turn >= decideByTurn)
                                   v                      | cleared / clearedWithRemedy / blocked
                    attachMergerRemedy (if remedy)        v
                                   |              retry accept or re-propose (clearance is durable)
                                   v
              corporationTurn sweep: fineOverdueDivestitures (dueTurn < turn)
```

## Worked trace

Setup: the target is AI-run, in a country at antitrust level 2 (threshold 60). Target: share price 40, 100,000 total shares, `liquidCapital` 300,000, sector exit value 3,500,000, no bonds, no cross holdings. Cap table: a player 60,000 shares, a corporation 15,000, an index fund 5,000, public float 20,000. The acquirer offers 5,000,000, holds 35% of the target's lead industry in that country, and the target holds 30%. All amounts in ₳, no stock tax, no FX.

**Valuation and asking price.**
1. Market cap = 40 x 100,000 = 4,000,000. Balance-sheet equity = 300,000 + 3,500,000 = 3,800,000.
2. Reference valuation = max(4,000,000, 3,800,000) - 0 = 4,000,000.
3. Asking price = ceil(4,000,000 x 1.1) = 4,400,000. The 5,000,000 offer meets it (an offer of 4,300,000 would fail: it is below 4,400,000, and the offer would be stored as `rejected`).

**Gate (turn 100).** The executor runs the bond and equity guards (none apply), then `assertMergerClearance`:
4. The law level is 2, so the threshold is 60. Combined share = 35 + 30 = 65, which is at or above 60, so a review opens: `decideByTurn` = 100 + 6 = 106, `thresholdPercent` 60, `combinedSharePercent` 65.
5. The call returns 409 and no money moves. Because the target is AI-run, the offer is stored as `rejected`; a human-run target's offer would return to `pending`.

**Deadline (turn 106).** Nobody ruled. `resolveDueMergerReviews` runs `autoResolveDecision(65, 60)`: margin = 5. 5 is below 15 and at least 5, so the result is `clearedWithRemedy`, with `remedySectorType` set to the lead industry.

**Retry (turn 107).** The acquirer proposes again at 5,000,000 (valuation unchanged, so it still meets the 4,400,000 asking price). The gate finds the existing `clearedWithRemedy` review for this pair and proceeds.
6. Debit the acquirer 5,000,000.
7. Pay shareholders: player floor(5,000,000 x 60,000 / 100,000) = 3,000,000; corporation floor(5,000,000 x 15,000 / 100,000) = 750,000; index fund 250,000; public float 1,000,000 to the target country's treasury. The slices sum to 5,000,000 (no dust in this case).
8. Add the target's 300,000 cash to the acquirer. The acquirer's net cash change is -5,000,000 + 300,000 = -4,700,000, plus all the target's sectors (valued at 3,500,000 on the exit basis).
9. The target is deleted. `attachMergerRemedy` sets `pendingDivestiture.dueTurn` = 107 + 12 = 119.

**Fines.** At turn 119 the order is not yet overdue (`dueTurn < turn` is false). From turn 120, if the acquirer's controlled group still holds 60% or more of the ordered industry and earns 2,000,000 per turn from it, each sweep fines 0.05 x 2,000,000 = 100,000, debited from its cash and credited to the reviewing treasury, and new acquisitions are barred, until the group sells below 60%.

## Edge cases and limits

- **Blocked is permanent** for that acquirer and target pair; a cleared pair does not need a second referral.
- **Pending review blocks with a 409**, naming the decision deadline.
- **Level 0 antitrust (threshold `null`) means review is off**, not "unreachable". Foreign Investment Act screening can still refer a foreign takeover.
- **No overlapping industry means no concentration review**, whatever the sizes of the firms. Both sides must hold share in the same industry.
- **Concentration counts only sectors physically in the target's home country**, for both sides.
- **State-owned and command-economy cases are excluded:** a state-owned side makes the deal an act of the state, and in a command economy the state already owns the firms, so review is inert there rather than a gap.
- **No seat in the current era means no review** (`resolveMergerAuthority` returns null). A seat that exists but is vacant, or held by an NPP, still produces a review that resolves on the bands.
- **Remedy sector is fixed.** The officeholder cannot choose a different sector than `leadSectorType`.
- **Spin-off does not discharge a remedy.** The controlled group (acquirer plus corporations it controls at more than 50% voting power) is measured, so moving the business into a subsidiary changes nothing.
- **Fine failure is not escalated.** If the corporation cannot pay in a turn the debit fails and the order stands; there is no partial payment.
- **A referred AI-run offer is closed, not parked.** The AI target path stores the offer as `rejected` when execution is refused, so the proposer must propose again after the review clears (the clearance is durable for the pair). A human-run target's offer returns to `pending` and can be accepted again while it has not expired.
- **AI-run target under a controlling parent cannot be bought** by an outsider; the parent decides.
- **Bonded or cross-holding targets (merge outcome only):** a target with any un-matured bond, or one holding shares in another corporation, is refused for a merge. A subsidiary outcome has no such obstacle because the target survives, but chaining subsidiaries, ownership cycles and putting one player in charge of both parent and subsidiary are refused.
- **Banked targets:** the bank charter moves to the acquirer on a merge. It is refused only when the acquirer already operates a bank, or the target has bank settlement in flight.
- **A completed settlement replays.** A crash after commit returns the recorded result; the offer goes to `failed` on a terminal failure and is not returned to `pending`. A `compensated` settlement refuses to resume and tells the player to open a new offer.
- **Rounding.** Offer prices are rounded to whole units; shareholder slices are floored, so a small remainder can go unpaid.
- **Zero or negative valuation.** `nppAcquisitionMinimumPrice` returns 0 for a non-positive or non-finite valuation, so any positive price meets the asking price of such a target.
- **Why the review exists:** it stops a player rolling up a whole national industry through offers, and it hands the call to a named officeholder with published fallback bands, so a vacant seat is neither a loophole nor a coin flip.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| A referral leaves both corporations exactly as it found them (the gate runs before any state change) | Order of checks in `executeAgreedAcquisition`; not directly tested (the executor suite mocks the gate, and `gate.test.ts` covers the gate alone) |
| Money is conserved: the price goes to the target's holders, the target's own cash relocates to the acquirer, nothing is minted | Pinned payout plan and stamped legs; `src/lib/corporations/commands/acquisitions/acquisitionSettlement.idempotency.test.ts` |
| A holder is never paid twice, whatever the retries | Per-leg stamps; `acquisitionSettlement.idempotency.test.ts`, `acquisitionOffers.settlement.test.ts` |
| Only one live settlement owns a target | `acquisitionSettlementId` claim on the target; covered by settlement tests |
| One review per acquirer and target pair is durable; pending or blocked is a hard gate | `src/lib/corporations/mergerReview/gate.test.ts` |
| The deadline fallback is deterministic | `autoResolveDecision`; `src/lib/corporations/mergerReview/constants.test.ts` |
| The remedy attaches only after a commit and targets the lead sector | `lifecycle.ts`; `src/lib/corporations/mergerReview/lifecycle.test.ts` |
| A spin-off does not discharge a divestiture | `src/lib/corporations/mergerReview/divestiture.test.ts` |
| An AI-run target auto-accepts at exactly the asking price and not one unit below | `src/lib/corporations/commands/acquisitions/nppAcquisitionOffers.test.ts`, `rules.test.ts` |
| State-owned targets can never be acquired | Checked in propose and execute; `nppAcquisitionOffers.test.ts` |
| Offer expiry removes the offer from the pending list | Not enforced: expiry is only checked at accept (see Known issues) |

## Failure and recovery

- **Crash mid-settlement.** The settlement record is claimed before money moves and each leg is stamped. A retry resumes from the record and pays only the legs not yet stamped. A crash after commit returns the recorded result.
- **Unpayable recipient.** If a holder document no longer exists, the settlement compensates: the acquirer is refunded the undelivered remainder, delivered payouts stand, and the offer is closed as `failed`. The proposer opens a new offer.
- **Withdraw or reject during an in-flight settlement.** The settlement is compensated first so no acquirer money is stranded, then the offer is closed.
- **Stuck claim on a target.** A leftover `acquisitionSettlementId` from a crashed run is released on the next retry for the same offer, or by the release path when the settlement is compensated. A claim from a different, abandoned offer would block new offers on the target with 409 until it is cleared by a heal.
- **Interrupted bank charter move.** A crash in the middle of the charter transfer is covered by that transfer's own recovery protocol; the pre-check stands aside only for the same offer's own interrupted claim.
- **Review never decided.** The turn sweep resolves it on the published bands; if the sweep itself throws, the error is logged and the turn continues, and the next turn resolves it.
- **Wrong review or stale clearance.** A stale `cleared` review for a pair stays valid until removed; an incorrect review can only be repaired by an admin edit of the review record.
- **Overdue fine cannot be paid.** The order stands and is retried every turn; no state is corrupted.

## Connections

**Driven by:**

- [Corporations](./corporations.md): share price, cash and sector values feed the reference valuation (`referenceValuationAnchor`, `sectorExitValueAnchor` in `src/lib/bonds/sectorExitBasis.ts`) and the concentration measure (`loadIndustryBasis`).
- [Policy System](./policy-system.md): the target country's enacted competition-law level sets the review threshold, and the cabinet seat that rules is read from the live cabinet (`resolveMergerAuthority`).
- [Corporate Bond Defaults](./corporate-bond-defaults.md): outstanding bonds block a merge outcome (the `bonds` check in `executeAgreedAcquisition`).
- Foreign Investment Act and Subsidiary Limits Act levels: read by `assertForeignControlAllowed`, `assertSubsidiaryWithinCap` and the screening branch of `assertMergerClearance`.
- Admin pause of corporation actions: read by the deals route.

**Affects:**

- [Corporations](./corporations.md): a merge moves sectors and cash and deletes the target (`executeAgreedAcquisition`); a divestiture order forces sector sales and fines revenue.
- [Subsidiary Corporations](./subsidiary-corporations.md): the subsidiary outcome creates a formal parent and subsidiary link (`transferTargetEquityToAcquirer`).
- [Stock Market](./stock-market.md): the target's shareholders are cashed out and its market activity cleaned up (`cleanupShareMarketActivityForCorporations`).
- National treasury of the reviewing country: overdue-divestiture fines are credited through `creditTreasuryProceedsFromAnchor`; the public float slice of the price is credited to the target country's treasury.
- Banking: the target's bank charter moves to the acquirer (`transferBankCharterToAcquirer`).
- Index funds: a fund holding the target is paid and its holding removed.

## Tests

| File | Covers |
| --- | --- |
| `src/lib/corporations/commands/acquisitions/executeAgreedAcquisition.test.ts` | Execution path and guards, including the bank charter conflict (the review gate is mocked here) |
| `src/lib/corporations/commands/acquisitions/nppAcquisitionOffers.test.ts`, `rules.test.ts` | AI-run asking price, auto-accept and reject, stale-snapshot control flips |
| `src/lib/corporations/commands/acquisitions/acquisitionSettlement.idempotency.test.ts`, `acquisitionOffers.settlement.test.ts` | Pinned plan, replay, compensation, charter-claim recovery |
| `src/lib/corporations/commands/acquisitions/subsidiaryAcquisition.test.ts`, `subsidiaryOffers.test.ts`, `acquisitionLegacyControl.test.ts` | Subsidiary outcome and legacy control cases |
| `src/lib/corporations/mergerReview/gate.test.ts` | Referral, thresholds, level 0, screening, command economy, state-owned, pending, blocked, cleared, divestiture bar |
| `src/lib/corporations/mergerReview/lifecycle.test.ts`, `divestiture.test.ts`, `concentration.test.ts`, `constants.test.ts` | Decisions, deadline bands, remedy, fines, group measure, overlap rule, constants |
| `src/app/api/corporations/buyer-search/route.test.ts` | Target search |

Gaps: no route test for `POST /api/corporations/[id]/deals` (rate limit, flag guard, authorization by corporation), none for the three `/api/merger-reviews` routes (seat authorization, 500 character note limit), and no test that drives a real referral through the executor end to end.

## Known issues and history

- **Expired offers are never marked expired.** `AcquisitionOfferStatus` includes `"expired"`, but no code sets it. An offer past `expiresAtTurn` stays `pending` and keeps appearing in the Deals tab (`listDealsForCorp` lists every pending offer) until it is rejected, withdrawn or someone tries to accept and gets "This offer has expired".
- **Stale flag comment.** `requireCorpDealsEnabled` documents the flag as off "(the default)", while the seeded default for fresh worlds is `true`. Existing worlds with the field absent are treated as off.
- **Player wiki gaps (not contradictions).** The player page does not mention the Foreign Investment Act screening referral or ban, the Subsidiary Limits Act cap on the subsidiary outcome, or that a merge moves the target's bank charter (and is refused when the acquirer already has a bank).
- **Referred AI-run offers need a fresh proposal.** Not a defect, but surprising: the offer is stored as `rejected` when the gate refers the deal.
- **Corrected from the earlier version of this page.** "Banked targets cannot be merged" was stale (the charter now transfers); `DealsTab` does not render an index committee panel; the reference valuation is the larger of market capitalization and balance-sheet equity, not either-or described loosely; "no live seat holder means no review" was wrong (only a missing seat does).
- Foreign Investment Act screening referrals (`reason: "foreignScreening"`) and group-wide concentration measurement (`groupSizeCostsStage` 5) are later additions recorded in code comments; exact dates are not recorded in this page's earlier versions.

Last checked: 2026-10-29, version 1.18.0
