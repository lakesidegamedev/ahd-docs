# IMF corporate bailout (admin rescue)

**Status: shipped.** This is the corporate-side IMF rescue facility, live in code (`src/lib/imf/`). It is a separate mechanism from the sovereign IMF facility described below, the two use different capture/cap numbers and different eligibility (corporations vs national governments); do not conflate them.

## Purpose

Give admins a structured **bailout** tool for distressed corporations: flag a corp as under **IMF restructuring**; **reduce bond-holder claims (haircut)** and **notify** holders; **consolidate** remaining obligation into an **amortizing IMF facility** (principal + interest) with **payments defaulting to a 35% capture of per-turn income, capped at 45%** (`IMF_BAILOUT_DEFAULT_INCOME_CAPTURE_FRACTION` / `IMF_BAILOUT_INCOME_FRACTION_CAP`, `src/lib/imf/constants.ts`); **remit** collections to the **IMF corporation** in **USD** (with **forex** from the rescued corp’s home currency / ₳ as needed); dilute existing shareholders by issuing new shares to the IMF; **bar dividends and CEO compensation** while active; block **bond-default refinance** while active; apply a **−15% share price** penalty (`IMF_BAILOUT_SHARE_PRICE_MULTIPLIER` = 0.85, already wired into `computeSharePrices`); show **admin-only** stake metrics in **₳**; and allow **admin forced liquidation** if the CEO fails obligations.

### Sovereign IMF facility (separate system)

Governments have their own IMF facility for sovereign default, implemented in `src/lib/sovereignDefault/` (`imfSovereignFacility.ts`, `constants.ts`). It uses different numbers: income capture defaults to 20% (`IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT`), floored at 10% and capped at 30% (`IMF_SOVEREIGN_INCOME_CAPTURE_MIN` / `IMF_SOVEREIGN_INCOME_CAPTURE_CAP`). It is not covered further in this doc.

### Related but separate: interbank / dead-bank lending

Private banking has its own distress-lending mechanism, interbank loans and dead-bank handling in `src/lib/turn/bankingTurn.ts` and `src/lib/turn/bankSolvencyTurn.ts`. It is unrelated to the IMF corporate facility described here and is not covered further in this doc.

### Currency

- **Admin analytics** (stake value, facility principal comparisons, “net of debt” views): **anchor (₳)**, consistent with `formatAmount` and `POST /api/admin/corporations/[id]/capital`.
- **IMF corporation balance sheet:** **USD**, `liquidCurrencyCode` / US HQ; all bailout **cash remittances** credit IMF in USD using existing `corporationCapital` conversion helpers.
- Do not use Australian dollars (AUD) unless a future product explicitly adds AUD as a game currency; the symbol “A$” is not used for anchor.

---

## Lore / user identity

- **IMF** is modeled as a normal `Corporation` document that can hold positions in other corps via `Shareholder.corporationId` (same pattern as any corporate portfolio).
- **CEO of the IMF** is the character **Sherrod Brown** (player-owned or admin-seeded character). The IMF corp’s `ceoId` / `userId` point at that character and owning user.
- In-product copy can lean satirical (“IMF”) without implying real-world IMF mechanics.

---

## Data model

### 1. IMF institution corporation

- One **canonical IMF corporation** per live game (or per deployment), created via **seed script** or one-time admin setup, documented in `scripts/` README.
- Fields (`src/lib/db/types/corporation.ts`):
  - `hiddenFromExchange: true` so it does not pollute retail listings.
  - `imfInstitution: true` marks the global IMF institution, gating UX and validating bailout targets.
- **Sherrod Brown** character must exist and be assigned **CEO** of this corp (`ceoId`, `ceoVacant: false`).
- **US headquarters** and **USD** `liquidCurrencyCode` so incoming remittances match product (“IMF in USD”).

### 2. Bailout state on the rescued corporation

Fields on `Corporation` (`src/lib/db/types/corporation.ts`):

| Field                              | Type           | Meaning                                                           |
| ---------------------------------- | -------------- | ----------------------------------------------------------------- |
| `imfBailoutActive`                 | `boolean`      | Bailout / restructuring in effect.                                |
| `imfBailoutImfCorporationId`       | `ObjectId`     | Which IMF corp holds (or will hold) the stake.                    |
| `imfBailoutTargetOwnershipPercent` | `number`       | Target fully diluted ownership **of the IMF** (0-100), e.g. `40`. |
| `imfBailoutStartedAt`              | `Date`         | Audit / display.                                                  |

**IMF facility (amortization)**, fields on the rescued corp:

| Field                             | Type          | Meaning                                                         |
| --------------------------------- | ------------- | --------------------------------------------------------------- |
| `imfFacilityPrincipalOutstanding` | `number` (₳)  | Remaining principal owed to IMF after haircut / consolidation.  |
| `imfFacilityAnnualRate`           | `number`      | Annual interest rate on outstanding principal (%).              |
| `imfFacilityAmortizationTurnsRemaining` | `number` | Turns left on the amortization schedule.                        |
| `imfFacilityIncomeCaptureFraction` | `number`     | Share of per-turn operating income captured for the payment.   |

**Invariant:** When `imfBailoutActive` is true, `imfBailoutImfCorporationId` must reference the seeded IMF corp (validate on write).

### 3. Bond-holder haircut + notification

- On bailout activation, apply an admin-configured **haircut** to outstanding corporate bonds: proportionally reduce `totalIssued`, float, and holder **units** (respect `BOND_UNIT_FACE_VALUE`).
- **Notify** affected holders via `sendSystemMail` (characters). **Corporate** bondholders need a defined notification path if mail is character-scoped (wire event, alternate inbox, or aggregated notice).
- Prefer **consolidating** post-haircut debt into `imfFacilityPrincipalOutstanding` so vanilla bond coupons and the IMF facility do not double-pay.

### 4. Share issuance to the IMF

- **Only** the IMF receives **new** shares; issuance is driven by admin (not CEO self-issue) to hit `imfBailoutTargetOwnershipPercent` **fully diluted**.
- Math: let `O` = pre-transaction `totalShares`, `p` = target fraction (e.g. `0.40`). Only new shares `x` go to the IMF:

  \[
  \frac{x}{O + x} = p \;\Rightarrow\; x = \frac{p \cdot O}{1 - p}
  \]

- Update:
  - `totalShares` → `O + x`
  - `shareholders`: upsert entry with `corporationId: imfBailoutImfCorporationId`, `shares: previousImfShares + x`
  - Adjust `publicFloat` if the codebase requires it to stay consistent with total issued (follow existing issuance / `HealCorporationShares` patterns).
- **Idempotency:** Admin action should either be “set target and apply once” or “recalculate delta from current IMF shares to target %” to avoid double-issuance bugs.

### 5. IMF facility payments (P/I), income cap, USD remittance

- Each turn while the facility has principal outstanding:
  1. Compute **scheduled** principal + interest for that turn (₳).
  2. **Capture:** payment defaults to `0.35 × perTurnIncome₳` (`IMF_BAILOUT_DEFAULT_INCOME_CAPTURE_FRACTION`), configurable per bailout, hard-capped at `0.45 × perTurnIncome₳` (`IMF_BAILOUT_INCOME_FRACTION_CAP`), and never above `scheduled`. **Per-turn income** matches the same basis used in corporation turn / `corporationHistory` (align with implementation).
  3. Split the payment into interest and principal; reduce `imfFacilityPrincipalOutstanding`.
  4. Debit the rescued corp’s `liquidCapital` (home currency); **credit IMF** `liquidCapital` in **USD** via existing forex conversion.
- If the cap binds, define whether the schedule **extends** (implicit re-term) or accrues, pick one rule and document it in code.
- **Turn order:** Place this logic relative to `processBondTurn` / corporation turn per `docs/design/core-systems.md` so `liquidCapital` and defaults stay coherent.

### 6. Admin forced liquidation

- **POST** admin-only route (e.g. `/api/admin/corporations/[id]/force-liquidate`) with `requireAdmin` and confirmation.
- Reuse **settlement** logic from CEO bond-default **dissolve** (extract shared module): liquidate assets, pay claims, clear bailout state. Use when admin judges the CEO is not meeting obligations.

---

## Behavioral rules

### 1. Bond-default refinance (and related crisis actions)

- While `imfBailoutActive`:
  - **POST** `/api/corporations/[id]/bond-default/refinance` → **400** with clear message (IMF restructuring, refinance not available).
  - **GET** `/api/corporations/[id]/bond-default` → `refinance.canRefinance: false` (and UI reasons) so `DefaultedBondCrisisModal` does not offer refinance.
- **Cash paydown** / **CEO dissolve** may still exist per existing rules; **admin forced liquidation** is separate (see §6 above).

### 2. Share price: −15% during bailout

- **Storage:** Continue storing the “intrinsic” computed price in `sectorCalculations` as today.
- **Bailout adjustment:** When `imfBailoutActive`, multiply the **final rounded** share price used for persistence (and trading hooks that read `corp.sharePrice`) by **`0.85`**.
- Single implementation site preferred: `src/lib/turn/corporation/sectorCalculations.ts` (where `sharePrice` is set), so all consumers see one consistent number.
- **Tests:** Snapshot with/without flag; ensure dividends / orders that depend on price stay coherent (document if any path must use pre-penalty price, ideally none).

### 2b. Dividends and CEO compensation: barred during bailout

- On activation: set **`dividendRate`** and **`ceoSalary`** to **0** on the rescued corporation.
- While `imfBailoutActive`:
  - **Turn processing** must apply **no shareholder dividends** and **no CEO salary** (enforce effective 0% / $0 even if the DB were stale).
  - **API:** Reject CEO attempts to set a positive dividend rate or CEO salary (`dividends` route, corporation `settings` route); marketing/logistics may remain editable unless product says otherwise.
- When bailout ends, allow normal settings again; do not auto-restore prior dividend/salary unless explicitly specified later.

### 3. Debt valuation for admin display

- Prefer **`imfFacilityPrincipalOutstanding`** (and scheduled coupons) once bonds are consolidated post-bailout.
- If legacy bonds remain, use **par / face** (`totalIssued`) for display where relevant.

### 4. IMF selling shares

- No new subsystem: IMF is a corp; **Sherrod** (CEO) uses existing **corporate portfolio** flows (`placerCorporationId` orders, fills, etc.).
- Verify in QA: IMF can list sells from its position; cooldowns and float rules still apply.

---

## Admin panel

### API

- **`GET /api/admin/corporations`**, extend payload with `imfBailoutActive`, optional computed **IMF stake metrics** (or lazy-load detail).
- **New:** e.g. `POST /api/admin/corporations/[id]/imf-bailout` with `requireAdmin`:
  - Body includes: `active`, `targetOwnershipPercent`, **haircut**, **facility rate/term** (as needed), `applyIssuance`.
  - Turning **on**: haircut bonds + notify, issue shares, init facility, set flags.
  - Turning **off**: clear `imfBailoutActive` (product decision on unwinding equity, default **do not auto-liquidate**).
- **New:** `POST .../force-liquidate`, admin settlement (see §6).

### UI (`CorporationsAdminPanel` and/or corp detail admin)

- Row/badge: **“IMF bailout”** when `imfBailoutActive`.
- Controls:
  - Set **target %** (new issuance to IMF to reach fully diluted %).
  - **Haircut** + facility terms; **force liquidate** (destructive, confirm).
  - Toggle bailout active (with confirmation).
- **Readout (anchor ₳):** For the IMF’s stake in this corp:
  1. **Equity-only (sans debt):** `imfShares × sharePrice` (anchor ₳ throughout; `sharePrice` is stored in ₳ baseline per `sectorCalculations` comments).
  2. **With debt:** Show equity stake value **minus** IMF’s pro-rata share of **par debt** (simple display):

     \[
     \text{imfShares} \times \text{sharePrice} - \frac{\text{imfShares}}{\text{totalShares}} \times \text{totalParDebt}
     \]

     Label clearly (e.g. “Stake equity value” vs “Net of attributed par debt”) so admins are not confused with market EV.

- Optional: link to IMF corp page (`/corporation/{sequentialId}`).

### Config

- **IMF corporation id**: resolved via `GameState` field, env var, or constant populated by seed, **one** source of truth referenced by admin validation and issuance.

---

## Risks / follow-ups

- **Forex / non-USD HQ:** QA bailout remittances with **JPY** and **GBP** rescued corporations (active forex); use **EUR** only if Germany is in scope for that test matrix, not as the default second non-USD beside JPY.
- **Forex:** If any display mixes home currency and ₳, keep admin readout strictly in **₳** for this slice; expand later if needed.
- **Double dilution:** Guard admin “apply issuance” against repeated clicks (transaction or idempotency key).
- **Nationalized corps:** Likely **exclude** or explicit error if `countryOwnerId` set (same as other bond-default restrictions).
- **Design doc / PUBLIC_CHANGELOG** when shipping: follow `ahd-release` skill.

---

## Out of scope (this plan)

- CEO salary caps, dividend caps (unless folded into a later “compliance” phase).
- Automatic narrative events when the facility is fully repaid (optional follow-up).
- Player-facing IMF branding beyond what admin seeds provide.
