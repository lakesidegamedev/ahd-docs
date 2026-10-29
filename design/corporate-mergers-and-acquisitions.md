# Corporate Mergers and Acquisitions

Players can offer to buy another player-run corporation outright. The acquirer's CEO proposes an all-in price; the target's CEO accepts or rejects. On acceptance, the target's shareholders are cashed out, its cash and sectors move to the acquirer, and the target corporation is deleted. If the combined firm would hold too large a share of a national industry, the deal is referred to a named cabinet officeholder for competition review before it can complete. The whole subsystem is gated by the `corpDealsEnabled` game flag.

## Feature Flag

- `corpDealsEnabled` (boolean) lives on the `gameState` document (`_id: "current"`). Also tracked: `corpDealsEnabledBy`, `corpDealsEnabledAt`.
- Default in `src/lib/seeds/reference/featureFlagDefaults.ts` is `true`.
- Enforced server-side by `requireCorpDealsEnabled()` (`src/lib/api/requireCorpDeals.ts`), which returns HTTP 403 `"Corporate acquisitions are not currently enabled."` when off. This guard runs on the `POST` path of the deals route only; `GET` instead reports `{ enabled: false, incoming: [], outgoing: [] }` when the flag is off, so the UI can render a disabled state without erroring.

## Proposing an Offer

Entry point: `proposeAcquisitionOffer()` in `src/lib/corporations/commands/acquisitions/acquisitionOffers.ts`, called from `POST /api/corporations/[id]/deals` with `action: "propose"`.

Rejected up front if:
- Acquirer and target are the same corporation.
- The target is state-owned (`countryOwnerId` set or `ownershipState === "stateOwned"`).
- `priceAnchor` is not a finite positive number.
- The acquirer is under an **overdue** divestiture order (`acquisitionsBarredByDivestiture`, see Divestiture section below), a still-current order does not bar new offers, only one that has run past its due turn.
- The acquirer already has a `pending` offer open against the same target (409).

Target discovery uses `GET /api/corporations/buyer-search?q=...&exclude=<corpId>`, a name search across player-run, non-state-owned corporations in **any country** (cross-border acquisitions are intentional, per code comment referencing issue #106). A corp counts as player-run via `PLAYER_RUN_CEO_FILTER`.

On success, an `AcquisitionOffer` document is inserted into the `acquisitionOffers` collection:

| Field | Notes |
|---|---|
| `priceAnchor` | Agreed all-in price for the whole target, in anchor currency (₳), rounded |
| `targetValuationAnchor` | Reference valuation captured at propose time (see below), rounded |
| `status` | `"pending" \| "accepted" \| "rejected" \| "withdrawn" \| "expired"` |
| `createdAtTurn` / `expiresAtTurn` | Offer lasts `ACQUISITION_OFFER_DURATION_TURNS = 24` turns |
| `proposedByCharacterId` / `proposedByUserId` | Who proposed, for authorization on withdraw |

If the target has a player CEO (`target.userId` set), a `corp_vote_opened`-type notification is sent pointing them to the Deals tab.

### Reference Valuation

`referenceValuationAnchor()` computes a display/fair-value anchor for the target, independent of the offer price:

```
whole-corp value = computeWholeCorpValuation({
  sharePrice: target.sharePrice (converted to ₳),
  totalShares: target.totalShares,
  balanceSheetEquity: liquidCapital (₳) + sectorNpvAnchor,
  debt: 0,   // v1 blocks bonded targets entirely, so no debt to net out
})
```

`sectorNpvAnchor` comes from `sectorExitValueAnchor()`, the same replacement-cost-book anchor used for other corp exits (dissolution, restructuring, nationalization) once plants are enabled for the active market mode. The code comment (tagged "D11") is explicit that this is deliberate: a corp whose value is its plants should be quoted the plants, not a capitalized earnings stream.

## Responding to an Offer

`POST /api/corporations/[id]/deals` with `action: "accept" | "reject" | "withdraw"`:
- `withdraw`, only the **acquirer**'s CEO.
- `accept` / `reject`, only the **target**'s CEO.
- All three require the offer to still be `"pending"`; acceptance additionally requires `currentTurn <= offer.expiresAtTurn`.
- Accept uses an atomic `findOneAndUpdate`-style claim (`updateOne` filtered on `status: "pending"`) so only one caller can transition `pending → accepted`; a losing racer gets 409.

## Executing an Accepted Acquisition

`acceptAcquisitionOffer()` claims the offer, then calls `executeAgreedAcquisition()` (`src/lib/corporations/commands/acquisitions/executeAgreedAcquisition.ts`). If execution throws or returns `ok: false`, the offer is rolled back to `"pending"` (claim released) so it can be retried.

### v1 Scope Guards

Two acquisition types are blocked outright with an error rather than being mishandled:
- Target has any un-matured bond (`bonds` collection, `matured: false`), bond assumption is deferred.
- Target holds equity in another corporation (`shareholders.corporationId` match), cross-holding transfer / acquiring a corporate parent is deferred.

### Merger Review Gate (runs before any money moves)

`assertMergerClearance()` is called with trigger `"agreedAcquisition"`. If it returns `ok: false`, execution stops before any state changes, "a referral must leave the two corporations exactly as it found them" per the code comment. See Merger Review section below for the full gate logic.

### Money and Asset Flow (once clearance is `ok`)

1. **Debit acquirer** the agreed price, converted to the acquirer's liquid currency via `anchorToCorpLiquidCapital`. Atomic, balance-gated (`atomicallyDebitCorpLiquidCapital`); insufficient funds aborts with a 400 before anything else happens.
2. **Pay target's shareholders** the agreed price pool via `payShareholders()` (the same fund-correct payout used elsewhere, e.g. nationalization). If this throws, the acquirer's debit is refunded and the error re-thrown.
3. **Fold target's liquid cash into the acquirer**, the target's own `liquidCapital` converts to ₳ and credits the acquirer. Money is conserved: the offer price went to shareholders; the target's own cash just relocates to its new owner.
4. **Move every target sector to the acquirer** via `moveSectorToCorp()`, described as "haircut-free" (no value loss), with currency re-denomination between target and acquirer currencies.
5. Two/three ledger transactions are emitted (`share_buyout_outflow` for the acquirer's outflow, `corp_dissolution_distribution` for the shell cash absorbed/released), timed after every asset mutation succeeds so a failure earlier logs nothing.
6. **Tear down the target shell**: cleans up its share-market activity, stamps it deleted (`stampSubjectDeleted`), then `corps.deleteOne`.
7. If the merger review cleared **with a remedy**, `attachMergerRemedy()` is called only now, after the merger has actually committed, to open the divestiture obligation.
8. An audit record (`action: "acquisition.execute"`) is written.
9. Every other pending offer that referenced the now-deleted target (as either acquirer or target) is set to `"withdrawn"`.

## Merger Review ("C3")

Code: `src/lib/corporations/mergerReview/{constants,gate,authority,concentration,divestiture,lifecycle}.ts`. Db type: `src/lib/db/types/mergerReview.ts`, collection `mergerReviews`.

### When It Applies

Gating is on **ownership and marketization**, never a country allow-list (explicit design note in `constants.ts`, referencing spec `ahd-b4-scrutiny-rework-spec`):
- Both acquirer and target must be privately owned, if either side is state-owned, the deal is an act of the state, not a reviewable transaction.
- The target's country must not be a command economy (`loadCommandEconomyBlockedCountries`), in a command economy the state already owns the firms, so review is deliberately inert, not a gap.
- The target's country must have an antitrust law mapped in `ANTITRUST_LAW_BY_COUNTRY` (explicit entries for `US`, `UK`, `RU`, `DD`; other countries review under their Competition Act from `mechanicalLaws`, or a carried law, and have a reviewing seat in `MERGER_AUTHORITY_SEAT_BY_COUNTRY`, see mapping below), with an enacted level whose threshold is not `null` (level 0 = "No Antitrust Enforcement" = off).
- The reviewing country must currently have a live officeholder seat for that law (`resolveMergerAuthority` returns non-null; a seat that doesn't exist yet in the current era means no review).

Two call sites trigger the gate, both at the instant two corporations would actually become one: `executeAgreedAcquisition` (trigger `"agreedAcquisition"`) and the hostile-takeover squeeze-out route (trigger `"hostileTakeover"`, not documented here). Reviewing at share-purchase time would be too early, per the code's own reasoning, until absorption the two firms are still measured separately.

### Antitrust Law → Threshold Mapping

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

### Measuring Concentration

`computeMergerConcentration()` measures the **combined post-merger share** of every industry (`CorporationType`) where either side has a physical presence, scoped to the **target's home country**, that is the state whose market structure changes and whose authority reviews it. Only sectors physically located in that country count for both sides (a foreign acquirer's home-market plants don't count toward the target-country concentration).

The denominator is the same `loadIndustryBasis()` rollup used for the corporation page's own market-share displays, so the number shown to the reviewing authority matches what a player sees elsewhere. For each overlapping sector type: `acquirerSharePercent`, `targetSharePercent`, `combinedSharePercent` (all rounded to 2 dp). The industry with the highest `combinedSharePercent` becomes `leadSectorType` and is the one measured against the threshold and, if remedied, the one ordered divested.

### The Gate Decision (`assertMergerClearance`)

Idempotent per `(acquirer, target)` pair:
1. If a review already exists for the pair with status `pending`, `blocked`, `cleared`, or `clearedWithRemedy`:
   - `cleared` / `clearedWithRemedy` → proceed (the clearance is durable, letting a referred hostile takeover simply retry once cleared).
   - `pending` → blocked, 409, with the decision deadline in the error message.
   - `blocked` → blocked, 400, permanently.
2. If review does not apply (ownership/marketization checks fail, no antitrust law mapped, level threshold is `null`, or no live authority seat) → proceed, no review opened.
3. Otherwise concentration is computed. If there's no overlapping sector or `combinedSharePercent < threshold` → proceed.
4. Otherwise a new `MergerReview` document is inserted with `status: "pending"`, `openedAtTurn: currentTurn`, `decideByTurn: currentTurn + MERGER_REVIEW_TURNS` (6 turns). The call returns `ok: false`, 409, blocking the deal. Notifications go to the seat holder (if a player) and to both corporations' owning users.

### Deciding a Review

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

### Divestiture Remedy

If a review resolves `clearedWithRemedy`, the obligation is **not** attached at decision time, only once the underlying deal actually commits, via `attachMergerRemedy()` called from `executeAgreedAcquisition` (or the takeover executor) after the merge succeeds. The obligation (`PendingDivestiture`, stored as `corporation.pendingDivestiture`):

- `sectorType`: the industry ordered divested (`review.remedySectorType`, always `leadSectorType`).
- `dueTurn`: `currentTurn + MERGER_REMEDY_TURNS` (12 turns).
- `thresholdPercent`: the share the acquirer's **controlled group** must fall below, carried on the obligation itself so a later law change can't retroactively satisfy or fail it.
- `countryId`: reviewing country, so any fine reaches the right treasury.

**Discharge is measured, not procedural.** `settleDivestitureIfSatisfied()` (in `divestiture.ts`) checks whether the acquirer's **controlled group** (itself plus every corp it controls at >50% voting power, computed by `controlledGroupIds()`, a closure walk over `shareholders`/`totalShares`/`superShareMultiplier`, cycle-safe) still holds `>= thresholdPercent` of the ordered industry in the ordered country. A spin-off into a wholly-owned subsidiary does **not** discharge the order (the group's share is unchanged); the group has to actually sell down. This can be called opportunistically after any relevant action, and from the turn sweep.

**Overdue enforcement**, `fineOverdueDivestitures()`, a turn phase:
- Re-checks discharge first (a group may have sold down already).
- Fine base: the **controlled group's** ₳ revenue in the ordered industry, in the reviewing country (using `loadIndustryBasis`'s `anchorByCorp`), not just the parent's own sectors, pushing the business into a subsidiary must not zero the fine.
- Fine rate: `MERGER_REMEDY_OVERDUE_FINE_RATE = 0.05` (5%) of that group revenue, **per turn**, debited from the corp's liquid capital and credited to the reviewing country's treasury (`creditTreasuryProceeds`). If the corp can't pay this turn, the debit simply fails and the order stands for retry next turn (no partial payment, no escalation logic beyond the flat 5%).
- An overdue corp is also barred from opening **new** acquisitions (`acquisitionsBarredByDivestiture`, checked at the propose step, current turn > `dueTurn`).
- A notification is sent to the corp's owning user each time it's fined.

## API Surface

| Route | Method | Purpose |
|---|---|---|
| `/api/corporations/[id]/deals` | GET | Pending incoming/outgoing offers for a corp the viewer runs; reports `{ enabled: false }` shape if flag off |
| `/api/corporations/[id]/deals` | POST | `action: propose \| accept \| reject \| withdraw`; rate-limited 10/60s per user; requires `corpDealsEnabled` + general corp-actions flag |
| `/api/corporations/buyer-search` | GET | Name search for acquisition targets (and supply-agreement counterparties), any country, player-run + non-state-owned only |
| `/api/merger-reviews` | GET | CEO-side view: reviews involving any corp the viewer runs (both sides), decided or not |
| `/api/merger-reviews/queue` | GET | Officeholder-side view: national pending/decided queue for the seat the viewer holds; `no-store`; fails closed to `{ applies: false }` if no seat, wrong era, command economy, or seat not held |
| `/api/merger-reviews/[id]` | POST | Officeholder hands down `cleared \| clearedWithRemedy \| blocked`, with optional note; seat re-resolved server-side every call |

## UI

- `src/components/corporation/DealsTab.tsx`, propose/accept/reject/withdraw UI, target search-by-name, renders `MergerReviewPanel` and `IndexCommitteePanel` alongside it.
- `src/components/corporation/MergerReviewPanel.tsx`, CEO-facing view of reviews touching the player's corp(s).
- `src/components/mergerReview/MergerReviewCard.tsx`, shared review-summary card component.
- The officeholder queue (`/api/merger-reviews/queue`) is consumed by a cabinet/national-office surface, not `DealsTab`, it deliberately never appears on a corporation's own page.

## Key Files

- `src/lib/api/requireCorpDeals.ts`, the `corpDealsEnabled` flag gate
- `src/lib/db/types/gameState.ts`, flag fields on `gameState`
- `src/lib/seeds/reference/featureFlagDefaults.ts`, flag default (`true`)
- `src/lib/db/types/acquisitionOffer.ts`, `AcquisitionOffer` type
- `src/lib/corporations/commands/acquisitions/acquisitionOffers.ts`, propose/accept/reject/withdraw, reference valuation, deal listing
- `src/lib/corporations/commands/acquisitions/executeAgreedAcquisition.ts`, the actual merge execution
- `src/lib/corporations/commands/acquisitions/executeAgreedAcquisition.test.ts`, coverage of the execution path
- `src/lib/db/types/mergerReview.ts`, `MergerReview` and `PendingDivestiture` types
- `src/lib/corporations/mergerReview/constants.ts`, law/seat mapping, thresholds, bands, turn windows
- `src/lib/corporations/mergerReview/gate.ts`, `assertMergerClearance`, `acquisitionsBarredByDivestiture`
- `src/lib/corporations/mergerReview/authority.ts`, `resolveMergerAuthority`
- `src/lib/corporations/mergerReview/concentration.ts`, `computeMergerConcentration`
- `src/lib/corporations/mergerReview/divestiture.ts`, `controlledGroupIds`, `groupIndustrySharePercent`, `settleDivestitureIfSatisfied`
- `src/lib/corporations/mergerReview/lifecycle.ts`, `decideMergerReview`, `resolveDueMergerReviews`, `attachMergerRemedy`, `fineOverdueDivestitures`
- `src/lib/corporations/mergerReview/{gate,divestiture,lifecycle}.test.ts` / `constants.test.ts`, test coverage
- `src/app/api/corporations/[id]/deals/route.ts`, deals GET/POST
- `src/app/api/corporations/buyer-search/route.ts`, target search
- `src/app/api/merger-reviews/route.ts`, CEO-side review list
- `src/app/api/merger-reviews/queue/route.ts`, officeholder queue
- `src/app/api/merger-reviews/[id]/route.ts`, officeholder decision
- `src/components/corporation/DealsTab.tsx`, `src/components/corporation/MergerReviewPanel.tsx`, `src/components/mergerReview/MergerReviewCard.tsx`, UI
