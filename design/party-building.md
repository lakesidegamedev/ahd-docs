# Party Building

## Summary

Party building is the long-game layer behind elections, treasury, NPP bench management, and internal faction power. Its core mechanic is **Organization (Org)**: a party's share of the party machinery in each state or region, raised one unit at a time with the Build Org action and eroded by inactivity. Org lifts a party's general election vote, gates NPP recruitment slots, and decides Major or Minor party tier.

Player guide: [Party Organization](https://www.ahousedividedgame.com/wiki/party-organization)

This page also records the surrounding party structure (leadership elections, treasury, Slate, caucuses, coalitions). The party-level NPP management actions are in [party-influence.md](./party-influence.md).

## Rules

### Structure

Each party operates across:

- a **national organization**
- **state / regional chapters**
- elected **Chair**, **Vice Chair**, and **Treasurer** roles at both levels

### Organization

Party organization is a percentage (0 to 100) per state or region per party. It is derived from stored contribution units, not from a cap. Code: `src/lib/parties/rules/organizationBucket.ts`, constants in `src/lib/constants/partyOrg.ts`.

What Org does:

- improves party election support in that geography (see "Org in elections" below)
- gates local party capacity, such as NPP recruitment slots (2 / 3 / 4 / 6 at org 0 / 30 / 40 / 50, `RECRUITMENT_SLOT_TIERS` in `src/lib/npp/recruitment.ts`)
- earns regions toward Major party tier (see "Party tier")
- interacts with treasury planning and growth decisions

### Share formula

Every region has a permanent Unaffiliated stake of `ORG_BUCKET_BASELINE_UNITS = 100` units that never decays and is always in the denominator.

`org% = party units / (100 + sum of all parties' units) x 100`

The result is rounded to 4 decimal places (`roundShare` in `src/lib/parties/rules/organizationBucket.ts`); unit balances are kept to 6 decimal places. Because shares are proportional, adding one party's units slightly dilutes everyone else's percentage without removing any of their units. There is no per-state cap: the old "lean decides the cap" and "base plus seat share cap" models are gone.

### Growth

A successful Build Org click deposits `ORG_BUILD_UNITS_PER_CLICK = 1` unit and resets that party's decay clock in that region (`applyOrganizationBuild`, applied atomically by `buildOrganizationBucket` in `src/lib/parties/commands/buildOrganizationBucket.ts`). Each click costs both Political Strength (PS) and treasury cash:

| Input | Value | Source |
| --- | --- | --- |
| Base PS cost | `BUILD_ORG_BASE_PS_COST = 1` | `src/lib/politicalStrength/strengthConstants.ts` |
| Pressure ladder | +1 stored pressure per spend in the same (party, region), stored value capped at 8, minus 3 per turn | `PRESSURE_LADDER_INCREMENT`, `PRESSURE_LADDER_MAX_VALUE`, `PRESSURE_DECAY_PER_TURN` |
| Effective PS cost | `min(1 + pressure, 8)` | `effectivePsCost`, `PRESSURE_LADDER_MAX_COST = 8` |
| Cash price | `round(rate x 0.075 x effective PS cost x size multiplier)` | `orgBuildCashPrice` in `src/lib/politicalStrength/buildOrgFunding.ts`, `ORG_BUILD_TREASURY_FRACTION = 0.075` |
| Rate | Per country, national and state tier (US 75,000 / 37,500; UK 60,000 / 30,000; JP 5,000,000 / 2,500,000) | `TREASURY_PS_RATE_BY_COUNTRY`, filled from each country's `tax.treasuryPsRate` in `src/lib/countries/<id>/economy.ts` |
| Size multiplier | `sqrt(state population) / country mean of sqrt(population)`, clamped to 0.5 to 2.0 | `orgBuildSizeMultiplier`, `ORG_BUILD_SIZE_MULTIPLIER_MIN/MAX` |
| Minimum treasury to click | 25% of the price | `ORG_BUILD_MIN_FUNDED_FRACTION = 0.25` |

The national rate is twice the state rate in every country, so a national click costs twice the cash. If the treasury covers at least 25% of the price but less than all of it, the click still lands: it takes whatever is in the treasury and adds the same one unit (`resolveOrgBuildFunding`, `chargeOrgBuildFunds`). Below 25% the click is refused before any PS is spent. A refused click (no presence, no funds, not authorised) costs nothing.

Why the size multiplier exists: Org is consumed as a normalised share, so a point in a large state carries far more electoral weight than a point in a small one. The curve is a square root so tiny states are not close to free, and the band keeps the widest spread to a 4x price range.

Who pays: the pool follows the spender's tier. A state officer pays from the state party's PS and `statePartyOrg.treasury`; a national officer pays from the national PS pool and `politicalParties.treasury`. A dual-role officer may choose with `psPool` in the request body; an ineligible choice is rejected with 403, not silently re-routed.

Who may click: state chair, state vice chair, state campaigner, national chair, national vice chair, national campaigner, or admin. Treasurers cannot (`canSpendOnStateParty` in `src/lib/parties/access.ts`).

### Decay

A party with no Build Org click for `ORG_DECAY_GRACE_TURNS = 96` turns loses `ORG_UNIT_DECAY_RATE = 1%` of its units per turn (`applyOrganizationDecay`), a half-life of about 69 turns once decay starts. The test is `currentTurn - lastOrganizationBuildTurn >= 96`. Units decay, not percentage points, so accumulated investment keeps its meaning. The Unaffiliated stake never decays.

### Presence

Building requires party presence in the region, checked live (`checkPartyPresence` in `src/lib/turn/partyOrg/presence.ts`): at least one party player character homed there, one elected official of the party there, or one active (non-retired) NPP of the party homed there. There is no exemption for national officers. A US region outside the 50 states plus DC cannot host an organization (`isNonPartyOrganizationUsRegion` in `src/lib/constants/states.ts`). When a party has presence and authority but no row, the route creates the row at 0 units (`ensureStatePartyOrgRow`).

### Org in elections

In a general election a party's normalised state Org share is raised to `ORG_WEIGHT_EXPONENT = 0.2` (`orgVoteWeight` in `src/lib/electionEngine/electionFormulaFactors.ts`): a 3 to 1 lead in Org becomes about a 1.25 to 1 edge in vote weight. With no Org data anywhere in the state the weight is a neutral 1; a party with 0 Org in a populated state gets 0. Primaries are unaffected because every candidate in a party's primary shares the same Org.

### Party tier

Org footprint, not offices, decides Major or Minor tier (`src/lib/parties/partyTier.ts`, run by `partyTierTurn`).

| Constant | Value |
| --- | --- |
| `TIER_EARN_REGION_ORG_PCT` | 20 (a region is earned at 20% Org or more) |
| `TIER_LOSE_REGION_ORG_PCT` | 10 (an earned region is kept until Org falls below 10%) |
| Graduation to Major | earned regions >= `ceil(regions / 3)`; UK uses `UK_TIER_GRADUATION_REGION_FRACTION = 1/4` |
| Demotion warning | Org below 10% in >= `ceil(2 x regions / 3)` regions |
| `MAJOR_DEMOTION_GRACE_TURNS` | 240 |
| `MINOR_PARTY_BASE_PS_CAP` / `MINOR_PARTY_PS_CAP_PER_REGION` | 100 / +10 per earned region, never above the national cap |

Region counts per country are in `REGION_COUNT_BY_COUNTRY` (`src/lib/politicalStrength/strengthConstants.ts`; US 50, UK 12, so the UK needs 3 regions). Ruling parties in one-party states are exempt from demotion. PS caps and the NPP Action Point pools that follow the tier are in [party-influence.md](./party-influence.md).

### Treasury

Party treasury is more than a raw send / transfer wallet.

Core functions:

- collect member tax (rate 0 to `MAX_TAX_RATE = 33` percent, set by chair, vice chair or treasurer, `src/lib/api/schemas/settings.ts`)
- collect NPP tax where applicable (`DEFAULT_NPP_STATE_TAX_RATE = 5` percent when no players are in the state party)
- send funds to members
- transfer funds between national and state / regional chapters
- fund NPP management and party actions

Treasury planning surfaces support reserve targets, planning presets (`custom`, `growth`, `election_push`, `member_support`, `reserve_first`, `src/lib/treasury/partyTreasuryPresets.ts`), state-funding visibility and override history. This makes party treasury a real leadership role rather than a passive balance sheet.

### Leadership

Party leadership elections cover `Chair`, `Vice Chair`, and `Treasurer` at both national and state / regional levels. The default voting window is **72 turns** (`NATIONAL_ELECTION_DURATION_TURNS` and `ELECTION_DURATION_TURNS` both 72, about 72 real hours at the standard 1-turn-per-hour cadence). Founding-phase elections use 12 turns (`FOUNDING_CHAIR_ELECTION_DURATION_TURNS`, `FOUNDING_STATE_ELECTION_DURATION_TURNS`). National parties can adopt a custom duration of 168-420 turns (`NATIONAL_ELECTION_MIN_DURATION_TURNS`, `NATIONAL_ELECTION_MAX_DURATION_TURNS`) via committee proposal. National committee elections run 168 turns with a committee of up to 6 (`COMMITTEE_ELECTION_DURATION_TURNS`, `COMMITTEE_SIZE` in `src/lib/nationalCommitteeElections.ts`).

Role identities:

- `Chair`: broad authority and political control
- `Vice Chair`: assists with political management
- `Treasurer`: planning, reserve posture, funding visibility, and treasury oversight

### NPP building

Party-building relies heavily on NPP systems.

- **Recruitment.** Parties can recruit new same-party NPP bench where recruitment rules allow (slot tiers above, growth frontier in `src/lib/parties/partyFrontier.ts`).
- **Management.** Leadership shapes the existing bench through favorability, influence, loyalty, stubbornness / cooperation, endorsements, withdrawals and Slate assignment. Only the favorability, influence, loyalty, cooperation and relocation actions are live as party actions; the rest happen through the Slate and the player endorsement flow. See [party-influence.md](./party-influence.md).

### Slate

Slate is part of party building. It acts as the party's bench-management board:

- view relevant races by state / region
- assign players or same-party NPPs
- persist those assignments across cycles
- let local leadership coordinate local filing pressure

Detail in [party-slate.md](./party-slate.md).

### Analytics

Party pages include internal analytics surfaces: identify underbuilt states, surface local and national discipline issues, track Slate coverage and assignment trouble, and show caucus health on the national surface.

### Caucuses

Caucuses are part of the live party-building loop. They give parties internal factions, a caucus treasury, a caucus whip, caucus chair elections and relationship-driven NPP sub-blocs. Recruiting an NPP into a caucus needs a chair relationship of at least `CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP = 60`, with a `CAUCUS_NPP_RECRUIT_COOLDOWN_TURNS = 12` turn cooldown between recruits; membership is kept while the relationship stays at or above `CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP = 20`. NPP relationships drift toward neutral by `NPP_RELATIONSHIP_DECAY_PER_TURN = 0.1` (all in `src/lib/constants/partyOrg.ts`). See [caucuses.md](./caucuses.md).

### Coalitions

Coalitions are a parallel cross-party layer rather than a replacement for party building, but coalition priorities and cohesion sit adjacent to party strategy. See [coalitions.md](./coalitions.md).

## Data

| Collection | Fields read or written | Player-visible |
| --- | --- | --- |
| `statePartyOrg` | `organization` (cached percent), `organizationUnits` (durable balance), `lastOrganizationBuildTurn` (decay clock), `treasury`, `hasPresence`, chair / vice chair / campaigner ids, `nppActionPoints` | Org percent and treasury yes; units are returned to the clicking officer in the build response |
| `politicalParties` | `treasury`, `politicalStrength`, `tier`, `nppActionPoints` (national tier spend) | Treasury and tier yes |
| `partyStrengthPressure` | `value`, `lastUpdatedTurn`, keyed by country, party and region | Shown indirectly as the quoted PS price |
| `orgRegLedger` | One row per changed share: `turn`, `partyId`, `metric: "org"`, `delta`, `value`, `source` (`action` for the spender, `passive` for dilution), `actorId`, `note` | State overview history |
| `treasuryTransactions` | A `category: "org_building"` debit row per landed charge | Treasury history for officers |
| `partyBudget` | Legacy `orgBuildingPercent` (see Known issues) | Budget panel |
| `states` | `population`, read for the size multiplier | Yes |
| `characters`, `electedOfficials`, `npps` | Read live for the presence check | Yes |
| `gameConfig` (`_id: "default"`) | `ledgerShadow`, read to decide whether to witness the cash sink in the accounting ledger | No |

The build response returns `psCost`, `newPS`, `newPressure`, `cashPrice`, `cashCost`, `fundedFraction`, `contributionUnits`, `organizationUnits`, `orgGain`, `newOrg`, a `dilutions` list (rival party id, loss, new Org) and a `nextPreview` quote for the next click.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| Org unit constants (`ORG_BUCKET_BASELINE_UNITS`, `ORG_BUILD_UNITS_PER_CLICK`, `ORG_DECAY_GRACE_TURNS`, `ORG_UNIT_DECAY_RATE`, `ORG_LEGACY_UNITS_PER_PERCENT_MAX`) | 100, 1, 96, 0.01, 10 | `src/lib/constants/partyOrg.ts` (code constants, not in `gameConfig`) |
| Build cost constants (`BUILD_ORG_BASE_PS_COST`, `ORG_BUILD_TREASURY_FRACTION`, `ORG_BUILD_MIN_FUNDED_FRACTION`, size band) | 1, 0.075, 0.25, 0.5 to 2.0 | `src/lib/politicalStrength/strengthConstants.ts` |
| Cash rate per country | US 75,000 national / 37,500 state, other countries differ | `tax.treasuryPsRate` in `src/lib/countries/<id>/economy.ts` |
| `ledgerShadow` | off unless set | `gameConfig` default document |
| Region count for tier thresholds | per country | `REGION_COUNT_BY_COUNTRY` |
| Election durations | 72 / 12 / 168 to 420 | `src/lib/nationalPartyElectionConstants.ts`, `src/lib/statePartyElections.ts` |
| NPP build sweep chance | 0.15 base, scaled by campaign aggression | `NPP_BUILD_ORG_BASE_PROBABILITY` in `src/lib/turn/nppActionProcessing.ts` |

No era or scenario preset overrides the Org constants. Eras change the cash price only through the country economy file (currency scale). Org is not available in a US region outside the 50 states and DC.

## Timing

`partyOrgTurn` applies decay and settles org shares each turn. Build Org clicks happen at request time through the build-org route (`src/app/api/country/[code]/region/[id]/party/[partyId]/build-org/route.ts`), so shares update immediately. Leadership elections resolve in `statePartyElections`, `nationalPartyElections` and `nationalCommitteeElections`. Order, from `src/simulation/phases/turnPhaseNames.ts`:

1. `partyGOTV`
2. `partyOrgTurn`: decay, then re-derive shares for every region
3. `regDriftDecay`
4. `pressureDecay`: stored pressure drops by 3, floored at 0
5. `priorityRegionDecay`, `supportDecay`, `supportAccrual`
6. `partyTierTurn`: reads the new Org to earn or lose regions and move tier
7. `statePartyElections`, `nationalPartyElections`, `nationalCommitteeElections`
8. `partyActionGeneration`: PS and NPP Action Points refill
9. later: `nppBehavior`, then `nppActionProcessing`, which runs the NPP Build Org sweep

The decay write in step 2 is conditional on the unit balance and the clock still matching what the phase read, so a click that lands mid-phase is preserved rather than overwritten. See [parties.md](./parties.md) for the full party phase list.

## Worked trace

Assumptions: a US state of 9,000,000 people where the country mean of `sqrt(population)` is 2,500. Party A (state party, 20 units) shares the region with party B (30 units) and party C (10 units). A's pressure in this state is 2 from earlier clicks. A's state treasury holds 4,000. A state officer clicks Build Org at turn T.

| Step | Calculation | Result |
| --- | --- | --- |
| Shares before | denominator = 100 + 20 + 30 + 10 = 160 | A 12.5%, B 18.75%, C 6.25% |
| Effective PS cost | `min(1 + 2, 8)` | 3 |
| Size multiplier | `sqrt(9,000,000) / 2,500 = 3,000 / 2,500`, inside 0.5 to 2.0 | 1.2 |
| Quoted cash price | `round(37,500 x 0.075 x 3 x 1.2) = round(2,812.5 x 3.6)` | 10,125 |
| Funding check | 4,000 / 10,125 = 0.3951, above 0.25 | accepted, part-funded |
| PS spent | 3, stored pressure 2 to 3 (next click costs 4) | A's state PS down 3 |
| Cash charged | `min(10,125, 4,000)` | 4,000; `fundedFraction` 0.3951; treasury now 0 |
| Units | 20 + 1, `lastOrganizationBuildTurn = T` | A = 21 |
| Shares after | denominator = 161 | A 13.0435%, B 18.6335%, C 6.2112% |
| Ledger rows | A +0.5435 (`action`), B -0.1165 and C -0.0388 (`passive`, note `dilution:build-org:by:<party>`) | 3 `orgRegLedger` rows |

Decay continues the example. If A never clicks again and B and C keep building, nothing happens until turn T + 96. At that turn A's units become `21 x 0.99 = 20.79`, A's share with B and C unchanged at 30 and 10 is `20.79 / 160.79 = 12.9299%`. One turn later A holds 20.5821 units.

## Edge cases and limits

- Leadership election length: 72 turns default, 12 in the founding phase, 168 to 420 custom (`src/lib/nationalPartyElectionConstants.ts`).
- Org percentage is rounded to 4 decimal places and can never reach 100 because the Unaffiliated stake is permanent.
- Legacy rows that stored a plain percentage are converted to units at a regional scale capped at `ORG_LEGACY_UNITS_PER_PERCENT_MAX = 10`, and their decay clock starts at the current turn so deployment causes no cliff.
- Corrupt negative or non-finite balances are clamped to 0 when shares are derived.
- A recruited NPP is never retired when org drops below a slot tier; the party just cannot recruit more until it is under the cap.
- A treasurer has planning access only; chairs and vice chairs keep emergency transfer access. Treasurers cannot click Build Org.
- The size multiplier is neutral (1) when population data is missing or the country has a single region. The country normaliser is cached for 10 minutes (`NORMALIZER_TTL_MS` in `src/lib/politicalStrength/orgBuildStateSize.ts`), so a price can lag a population change by a fraction of a percent.
- Stored pressure is capped at 8, so a heavy builder's cost recovers within a few turns of stopping rather than staying pinned.
- Build Org requests are limited to 60 per minute per user (route rate limit).
- A party with no row is bootstrapped at 0 units only after presence and authority pass.
- The 25% funding floor is re-applied after PS is spent: if a concurrent debit drains the treasury, the reported funded fraction is clamped up to 0.25 (`clampFundedFraction`) and the unit is still deposited.

## Invariants

- Every successful click adds exactly `ORG_BUILD_UNITS_PER_CLICK` unit and nothing else. Enforced by `src/lib/parties/rules/organizationBucket.test.ts` and `src/lib/parties/commands/buildOrganizationBucket.test.ts`.
- The Unaffiliated stake stays 100 and is always in the denominator, so the sum of party shares is below 100. Holds by construction in `deriveOrganizationShares`; no runtime check asserts it.
- A click never overdraws a treasury. `chargeOrgBuildFunds` subtracts `min(amount, max(treasury, 0))` in one atomic update (`src/lib/parties/commands/chargeOrgBuildFunds.test.ts`).
- A refused click spends no PS and raises no pressure, because pricing and funding run before `spendPoliticalStrength`. Covered by the route test.
- Cached `organization` percentages can always be re-derived from `organizationUnits`. Enforced by the reconciliation read in `buildOrganizationBucket` (it re-derives if another click landed during the write); not otherwise audited.
- Concurrent clicks do not lose units: the increment is a single-document pipeline update.

## Failure and recovery

- **Cached percentage drifts from units.** Seen as a stale Org number on a party page. Any next click or the next `partyOrgTurn` re-derives every share in the region from the units; a heal that re-derives shares from units is the repair if many regions are affected.
- **Legacy rows without units.** Seen as a visible Org jump after a deploy. The conversion is idempotent and conditional (`organizationUnits: { $exists: false }`); the one-off backfill is `scripts/migrations/2026-10-04-backfill-party-organization-buckets.ts`.
- **Wrong-party row.** An earlier defect read a drifted state row under the wrong party id. The row lookup now uses the country, region and party triple with a compound-id fallback (`findStatePartyOrgRow`). Repair for a drifted row is a data heal that merges balances onto the canonical row.
- **Treasury drained between quote and debit.** The click still lands at the clamped funded fraction; no repair needed.
- **Lagging presence flag.** `statePartyOrg.hasPresence` is a cache that only refreshes on membership events; the route ignores it and checks live. A stale flag only affects code that reads the cache, such as the NPP sweep's row selection.
- **Decay overwrote a click.** Prevented by the conditional write in `processPartyOrgTurn`; if it were ever suspected, the `orgRegLedger` rows and `treasuryTransactions` rows show what landed.

## Connections

**Driven by:**

- [Parties](./parties.md): treasury taxes and presence feed Build Org.
- Political Strength: spent on every Build Org click (`spendPoliticalStrength` in `src/lib/parties/commands/spendPoliticalStrength.ts`).
- Country economy files: the cash rate per currency.
- NPP autonomy v3: the NPP Build Org sweep (`src/lib/nppAutonomy/v3/party/nppBuildOrg.ts`) spends from the state pool and state treasury at the same prices.

**Affects:**

- [Party influence](./party-influence.md): org tiers set NPP recruitment capacity and the recorded chance of management actions.
- [Party slate](./party-slate.md): analytics find underbuilt states for slate coverage.
- [Caucuses](./caucuses.md) and [Coalitions](./coalitions.md): cross-cutting layers on the same parties.
- Elections: Org share enters vote weight at `share ^ 0.2` (`src/lib/electionEngine/electionFormulaFactors.ts`).
- Party tier: `partyTierTurn` reads Org per region.
- Treasury ledger: each charge is an `org_building` debit.

## Tests

| Area | Test file |
| --- | --- |
| Unit and share maths, decay | `src/lib/parties/rules/organizationBucket.test.ts` |
| Atomic deposit and reconciliation | `src/lib/parties/commands/buildOrganizationBucket.test.ts` |
| Cash price, funding floor | `src/lib/politicalStrength/buildOrgFunding.test.ts` |
| Size multiplier and cache | `src/lib/politicalStrength/orgBuildStateSize.test.ts` |
| Cash debit | `src/lib/parties/commands/chargeOrgBuildFunds.test.ts` |
| Route end to end | `src/app/api/country/[code]/region/[id]/party/[partyId]/build-org/route.test.ts` |
| Decay phase | `src/lib/turn/partyOrg/turnProcessing.test.ts` |
| Presence | `src/lib/turn/partyOrg/presence.test.ts` |
| Tier | `src/lib/parties/partyTier.test.ts`, `src/lib/turn/partyTierTurn.test.ts` |
| Recruitment slots | `src/lib/npp/recruitment.test.ts` |
| NPP build sweep | `src/lib/nppAutonomy/v3/party/nppBuildOrg.test.ts`, `nppBuildOrgSweep.test.ts` |
| Elections | `src/lib/statePartyElections.test.ts`, `src/lib/nationalPartyElections.test.ts` |
| Backfill | `scripts/migrations/2026-10-04-backfill-party-organization-buckets.test.ts` |
| Vote weight | `src/lib/electionEngine/electionFormulaFactors.test.ts` |

Gaps: no test asserts the share-sum invariant across a full region of many parties, no test covers national committee election durations directly, and the treasury planning presets have no balance test.

## Known issues and history

- The legacy `orgBuildingPercent` budget field is still stored, still accepted by the bulk settings route (0 to `MAX_ORG_BUILDING_PERCENT = 75`) and still reset to 0 when presence is lost, but the turn pipeline no longer reads it (comment in `src/lib/turn/demographicTurnoutTurn.ts`). It is inert and a candidate for schema cleanup.
- Earlier text on this page said a national officer can build into vacant states and that presence loss resets Org building. Neither matches the code: presence is required for everyone, and presence loss only resets the legacy budget field.
- The size multiplier averages 1 across regions but not across clicks, because players organise in large states. A replay of a live week put the true cost rise near +13.5% of total spend, which the comment on `ORG_BUILD_SIZE_MULTIPLIER_MIN` records as accepted rather than compensated.
- Dated changes recorded in code comments: Build Org began costing cash on 2026-09-02 (price calibrated that day against the live ledger); the contribution-unit model replaced the capped percentage model, with the backfill migration dated 2026-10-04; PS income was rebalanced on 2026-06-25.

## Related Docs

- [parties.md](./parties.md)
- [party-influence.md](./party-influence.md)
- [party-slate.md](./party-slate.md)
- [caucuses.md](./caucuses.md)
- [coalitions.md](./coalitions.md)

Last checked: 2026-10-29, version 1.18.0
