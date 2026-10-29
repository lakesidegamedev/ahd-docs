# Party Influence

## Summary

Party influence gives party leadership direct tools to manage same-party NPPs using party resources (a banked NPP Action Point pool and the party treasury) instead of personal character actions. This page also records the other party-level resources those tools sit beside: Political Strength, budgets, NPP recruitment cost and the Slate acceptance thresholds.

Player guide: [Party Actions](https://www.ahousedividedgame.com/wiki/party-actions)

This page is about party-level actions on NPPs. The separate per-member Party Influence score that grants bonus actions is documented in [parties.md](./parties.md). Player-to-NPP actions from an NPP profile are in [npp-system.md](./npp-system.md). Organization building is in [party-building.md](./party-building.md).

## Rules

### Surfaces

Two separate surfaces exist:

- **National party influence** (`POST /api/country/[code]/parties/[id]/influence`)
- **State / regional party influence** (`POST /api/country/[code]/region/[id]/party/[partyId]/influence`)

Both spend NPP Action Points (AP) and treasury, but they do not have identical scope.

### Live action set

| Action | National | State / regional | NPP AP | Treasury cost (USD tier) | Effect |
| --- | --- | --- | --- | --- | --- |
| `boost_favorability` | yes | yes | 1 | 5,000 | Favorability gain on a diminishing curve |
| `boost_influence` | yes | yes | 1 | 5,000 | Political influence gain on a diminishing curve |
| `boost_loyalty` | yes | yes | 1 | 12,500 | Loyalty +1 to +3 (random integer), max 100 |
| `reduce_stubbornness` | yes | yes | 1 | 12,500 | Stubbornness -1 to -3 (random integer), min 0 |
| `relocate_state` | yes | no | 1 | none | Moves the NPP's home state |

Sources: `NPP_MANAGEMENT_AP_COST` and `nppManagementFundCost` in `src/lib/npp/actionPoints.ts`; action sets in `src/lib/parties/commands/nationalInfluence.ts` (`NATIONAL_PARTY_MANAGEMENT_ACTIONS`) and the state `influence` route (`STATE_PARTY_MANAGEMENT_ACTIONS`); effects in `src/lib/influence/partyExecutorEffects.ts` (`STAT_CHANGE_AMOUNTS`).

Treasury cost is by currency, not country (`NPP_TREASURY_COST_BY_CURRENCY`):

| Currency | Boost | Loyalty or cooperation | Recruit |
| --- | --- | --- | --- |
| USD, GBP, EUR, NGN, SUR, and any currency not listed | 5,000 | 12,500 | 50,000 |
| BRL, CNY | 25,000 | 50,000 | 200,000 |
| JPY | 62,500 | 125,000 | 500,000 |

Relocation costs no treasury.

Stat gain curves (`src/lib/actions/rules.ts`, `src/lib/actions/advertiseGain.ts`):

- Favorability: `max(1, floor(3 - 0.1 x max(0, favorability - 70)))`, then rounded to 0.1 and capped at 100.
- Influence: `max(0.1, 1 - max(0, influence - 50) / 75)`, then rounded to 0.1 and capped at 100.

| Current stat | Favorability gain | Influence gain |
| --- | --- | --- |
| 50 | 3 | 1.0 |
| 70 | 3 | 0.7 (0.733 rounded) |
| 80 | 2 | 0.6 |
| 90 | 1 | 0.5 |
| 100 | 1 | 0.3 (0.333 rounded) |

Both are the same curves an NPP uses for its own advertise and campaign actions, so a chair boost cannot outrun the stat's natural decay and pin an NPP at 100. Influence decays 0.75% of its value per turn (`POLITICAL_INFLUENCE_DECAY_RATE`, `shared/constants/formulas.ts`) and favorability above 60 loses `(favorability - 60) x 0.05` per turn.

### NPP Action Point pools

| Scope | Tier | Pool cap | Regen per turn |
| --- | --- | --- | --- |
| National | Major | 160 | 16 |
| National | Minor | 80 | 8 |
| State | Major | 40 | 4 |
| State | Minor | 20 | 3 |

Source: `NPP_ACTION_POINT_CAP` and `NPP_ACTION_POINT_REGEN` in `src/lib/npp/actionPoints.ts`. A state row takes its owning national party's tier (unknown owner: Minor). A legacy row with no pool is healed to the cap on first use or first refill.

### Recruiting NPPs

Recruiting a new same-party NPP costs `NPP_RECRUITMENT_AP_COST = 5` AP plus the currency's recruit fee (50,000 in the USD tier), paid from the national pool and treasury on the national route (`src/app/api/country/[code]/parties/[id]/recruitment/recruit/route.ts`) and from the state pool and treasury on the state route (`src/app/api/country/[code]/region/[id]/party/[partyId]/recruitment/route.ts`). The number of NPPs a party may have in a region is `calculateRecruitmentSlots(org)`: 2, 3, 4 or 6 at Org 0, 30, 40, 50 (`RECRUITMENT_SLOT_TIERS`, `src/lib/npp/recruitment.ts`). Recruitment is limited to the party's growth frontier.

### Catalog actions that are not offered

`INFLUENCE_ACTIONS` in `src/lib/influence/constants.ts` still defines `endorse_candidate`, `withdraw_election`, `oppose_candidate` and `support_leadership` (base chance 40, 25, 35 and 45). The live management routes reject them ("is not available in NPP Management"), so players cannot use them from the party pages in the live release. Party endorsements arranged this way no longer exist; endorsements come from the player request flow in [npp-system.md](./npp-system.md). The catalog's own `actionCost`, `baseFundCost` and `baseChance` fields for the live actions (3 actions, 10,000 to 50,000) are legacy and are not charged; only the AP and currency tables above apply. The `baseChance` value is still returned by the options (GET) response, where it does not describe the real outcome.

### Success model

Management actions always succeed once validation and payment pass (`outcome` is fixed to success in `src/lib/influence/partyExecutor.ts`). A success chance is still computed and stored on the attempt record (`src/lib/influence/partyExecutorCalculations.ts`):

- `baseChance = round(loyalty x 0.65 + 38)`
- `stubbornnessPenalty = round(stubbornness x 0.32)`
- `organizationBonus = round((org - 50) x 0.1)`
- `partyBonus = 0` for same party, `-15` for another party
- `hiddenBonus = +3` (`STATE_PARTY_INFLUENCE_HIDDEN_BONUS`) on the state surface when the actor is the state chair or vice chair and the action is `boost_loyalty` or `reduce_stubbornness`; otherwise 0
- `clamped = clamp(base - penalty + party + org + hidden, 5, 85)` (`INFLUENCE_LIMITS.MIN_SUCCESS_CHANCE`, `MAX_SUCCESS_CHANCE`)
- `slateScore = round(10 x (loyalty x 0.65 + (100 - stubbornness) x 0.35)) / 10` (`computeSlateAssignmentScore`, `src/lib/slateAssignments.ts`)
- `finalChance = round(max(clamped, slateScore))`. The Slate score is not clamped to 85.

The org term is the state party's organization on the state surface, and the organization of the NPP's home-state party row on the national surface, defaulting to 50 when the row is missing or its value is 0.

### Political Strength and the other party resources

These are the resources that sit beside the NPP pool. Code is in `src/lib/politicalStrength/strengthConstants.ts` unless noted.

| Item | Value | Constant |
| --- | --- | --- |
| Passive PS per turn | 20 national, 5 state, paid even with an empty treasury | `NATIONAL_PASSIVE_PS_PER_TURN`, `STATE_PASSIVE_PS_PER_TURN` |
| Treasury-bought PS | up to 20 PS per turn at the chair-set budget | `PS_INVESTMENT_MAX_TIERS` |
| Cost per bought PS | 5% of the legacy rate: US 12,500 national, 6,250 state | `psInvestmentRate` |
| National PS cap, Major | 280 | `NATIONAL_PS_CAP` |
| National PS cap, Minor | `min(280, 100 + 10 x earned regions)` | `MINOR_PARTY_BASE_PS_CAP`, `MINOR_PARTY_PS_CAP_PER_REGION` in `src/lib/parties/partyTier.ts` |
| State PS cap | 30 with an active player member, 7.5 otherwise (25%) | `STATE_PS_CAP_DEFAULT`, `NPP_ONLY_STATE_PS_CAP_FRACTION` |
| Pressure ladder | +1 PS per spend in the same state, effective cost capped at 8, minus 3 per turn | `PRESSURE_LADDER_INCREMENT`, `PRESSURE_LADDER_MAX_COST`, `PRESSURE_DECAY_PER_TURN` |
| Tier thresholds | earn a region at 20% Org, lose below 10%, demotion grace 240 turns | `TIER_EARN_REGION_ORG_PCT`, `TIER_LOSE_REGION_ORG_PCT`, `MAJOR_DEMOTION_GRACE_TURNS` |

A Major party graduates at `ceil(regions / 3)` earned regions (UK `ceil(regions / 4)`, 3 of 12); the US figure is 17 of 50. Demotion needs Org below 10% in `ceil(2 x regions / 3)` regions and 240 turns without recovery. Detail in [party-building.md](./party-building.md).

The treasury-bought stream is `min(budget, treasury) / rate`, limited to 20 and to the headroom below the cap, and it debits only what it actually bought (`computePartyPsGain`, `src/lib/turn/partyActionGeneration.ts`). The player-active test for the state cap uses the inactivity window in `src/lib/players/playerActivity.ts`.

### Budgets and tax

| Setting | Range | Constant or schema |
| --- | --- | --- |
| GOTV, suppression, registration drive budgets | 0 to 25 percent of revenue each | `MAX_GOTV_PERCENT = 25` in `src/lib/api/schemas/settings.ts` |
| Member tax rate | 0 to 33 percent | `MAX_TAX_RATE = 33` |
| Registration drive effect | at most 0.1 percentage points per state per turn | `REG_DRIVE_MAX_BOOST_PER_STATE` in `src/lib/parties/registrationDrive.ts` |
| Suppression against an unmanned built-in party | halved | `DEFENSE_UNMANNED_CAPTURE_MULTIPLIER = 0.5`, `src/lib/turn/partyOrg/defenseConstants.ts` |

Budgets pause while the party treasury is negative. The old Org-building budget is retired; see [party-building.md](./party-building.md).

### Slate acceptance thresholds

An NPP follows a Slate assignment if loyalty is at least 40 and stubbornness at most 70 (`SLATE_NPP_LOYALTY_THRESHOLD`, `SLATE_NPP_STUBBORNNESS_THRESHOLD` in `src/lib/slateAssignments.ts`). State and regional leaders get 5 points of leeway on each (`STATE_SLATE_ASSIGNMENT_BONUS` in `src/lib/slateAuthority.ts`). See [party-slate.md](./party-slate.md).

### National party influence

Authorization:

- National Chair
- National Vice Chair
- confirmed campaigner (route-level `canUseNationalPartyInfluence` in `src/lib/parties/access.ts`)
- admin override

Scope: the four stat tools plus relocation on same-party NPPs, queued in batches. The batch stops at the first error; earlier items stay charged. Relocation requires the target state to be in the party's growth frontier (regions where it has a member, elected official or active NPP, plus direct neighbours; `src/lib/parties/partyFrontier.ts`), a path that keeps the party's territory connected (`getRelocationTerritory`), and room under `calculateRelocationCapacity` (the greater of the recruitment slots and `ceil(party NPPs / regions x 1.5)`, `RELOCATION_FAIR_SHARE_MULTIPLIER`). A relocated NPP resigns any office it holds, is withdrawn from every open candidacy, and loses any state party leadership in the region it leaves (`performNppRelocation`).

### State / regional party influence

Authorization:

- State / Regional Chair
- State / Regional Vice Chair
- admin override

The state / regional `NPPs` tab is split into `Recruitment` and `Management`. Management offers `boost_favorability`, `boost_influence`, `boost_loyalty` and `reduce_stubbornness`. It does not include relocation.

The panel only targets NPPs who are same-party, not retired, and have `homeState` matching that state / region. It also flags officeholders and active candidates so local leadership can see which NPPs are already in active political use.

## Data

| Collection | Fields | Read or written | Player-visible |
| --- | --- | --- | --- |
| `politicalParties` | `nppActionPoints`, `treasury`, `politicalStrength`, `tier`, `psInvestmentBudget`, `politicalStrengthCap`, `psCapEarnedRegions` | read and debited (national surface) | pool, treasury and PS shown to officers |
| `statePartyOrg` | `nppActionPoints`, `treasury`, `politicalStrength`, `psInvestmentBudget`, `organization`, chair ids | read and debited (state surface) | same |
| `npps` | `favorability`, `politicalInfluence`, `personality.loyalty`, `personality.stubbornness`, `homeState`, `influenceState.lastInfluencedTurn`, `influenceState.totalTimesInfluenced`, `retiredAt` | read and written | NPP profile |
| `nppInfluenceAttempts` | actor, NPP, type, `actionCost`, `fundCost`, `calculation` block, outcome, message, `partyInfluence` scope, turn | written once per action | officers see the result message |
| `partyPoliticalStrengthLedger` | PS gain rows by `source` (`passive`, `treasury`, `decay`) | written each turn | PS history |
| `treasuryTransactions` | `ps_investment` debit rows | written each turn | treasury history |
| `states`, `electionCandidates`, `elections` | read for relocation and withdrawal | read, candidacies set to `withdrawn` on relocation | yes |

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| AP costs, caps, regen, treasury table | 1 / 5 AP; caps 160, 80, 40, 20; regen 16, 8, 4, 3 | `src/lib/npp/actionPoints.ts` (code constants, no `gameConfig` field) |
| Currency for a country's party treasury | per country | `COUNTRY_CURRENCY_MAP` in `src/lib/constants/currencies.ts` |
| Recorded-chance limits | 5 to 85 | `INFLUENCE_LIMITS` in `src/lib/influence/constants.ts` |
| Hidden state bonus | +3 | `STATE_PARTY_INFLUENCE_HIDDEN_BONUS` in `src/lib/influence/partyExecutor.ts` |
| Rate limit | 120 requests per 60 seconds per user, both surfaces | `NPP_MANAGEMENT_LIMITS` in `src/lib/api/rateLimit.ts` |
| PS rates per country | per country | `tax.treasuryPsRate` in `src/lib/countries/<id>/economy.ts` |
| Per-party PS cap override | none | `Party.politicalStrengthCap` |

No era preset or scenario flag changes these values.

## Timing

Party influence runs at request time, not in a turn phase. The attempt is validated, resources are debited atomically (pool and treasury must both cover the cost, otherwise nothing is charged), the NPP's `influenceState` is stamped with the current turn, the effect is written, and the attempt is logged to `nppInfluenceAttempts`. The pool refills each turn in `partyActionGeneration` (`src/lib/turn/partyActionGeneration.ts`). Order of the related phases (`src/simulation/phases/turnPhaseNames.ts`):

1. `partyOrgTurn`: Org decay
2. `pressureDecay`: PS ladder falls by 3
3. `partyTierTurn`: tier and earned regions, which set the AP and PS caps
4. `statePartyElections`, `nationalPartyElections`, `nationalCommitteeElections`: chairs may change
5. `partyActionGeneration`: PS and AP refill, treasury-bought PS debited
6. `nppBehavior`: NPPs vote, file and respond to the Slate using the stats set by earlier management actions

So stat changes made this turn are what the NPPs act on in the same turn's voting and election entry. Because the tier is read in step 5 from step 3, a party that has just been demoted refills toward the lower cap that same turn.

## Worked trace

A US state party (Major, so cap 40 and regen 4) with 10 AP and 20,000 in the state treasury. The state chair boosts an NPP in the state: loyalty 60, stubbornness 50, favorability 80, influence 70. State Org is 70.

| Action | Resource check | Effect |
| --- | --- | --- |
| `boost_loyalty` | AP 10 >= 1 and treasury 20,000 >= 12,500: pass. AP 9, treasury 7,500 | roll an integer 1 to 3, say 2: loyalty `min(100, 60 + 2)` = 62 |
| `boost_favorability` (treasury 7,500 >= 5,000) | AP 8, treasury 2,500 | `floor(3 - 0.1 x (80 - 70))` = 2, favorability 82 |
| `boost_influence` (treasury 2,500 < 5,000) | refused: "Insufficient state party resources", nothing charged | none |

Recorded chance for the first action: `base = round(60 x 0.65 + 38) = 77`, `penalty = round(50 x 0.32) = 16`, `org = round((70 - 50) x 0.1) = 2`, party 0, hidden +3 (state chair, loyalty action). Sum `77 - 16 + 2 + 3 = 66`, inside 5 to 85. Slate score `60 x 0.65 + 50 x 0.35 = 56.5`, lower than 66, so `finalChance = 66`. The attempt row stores 66, 1 AP, 12,500, and outcome success. On the next turn AP refills `min(40, 8 + 4)` = 12.

## Edge cases and limits

- Boost favorability is refused when favorability is already 100, boost influence at 100, boost loyalty at loyalty 100, reduce stubbornness at 0; nothing is charged (`checkTargetStatCap` in `src/lib/influence/partyExecutorValidation.ts`).
- If the pool or the treasury cannot cover the cost, the request fails with "Insufficient party resources" (national) or "Insufficient state party resources" (state) and charges nothing.
- A state party cannot relocate NPPs and cannot touch NPPs outside its own state or party.
- Retired NPPs are not valid targets.
- Management requests are rate limited to 120 per minute (`NPP_MANAGEMENT_LIMITS`).
- Loyalty and stubbornness boosts are random integers 1 to 3, so the exact result is not known before clicking.
- Relocation validates the target, the frontier, connectivity and capacity before any payment; a failed relocation costs nothing.
- The national surface needs a character; an admin without one gets "A character is required to use party influence."
- A national queue is processed in order and ends at the first error.
- A withdrawal that matched no candidacy refunds the AP and treasury and rolls back the influence counter; this path is only reachable if `withdraw_election` is re-enabled.

## Invariants

- AP and treasury move together: either both are debited or neither (one `updateOne` with `$gte` guards on both fields). Covered by `src/lib/influence/partyExecutor.test.ts`.
- Pool never exceeds its cap: `computeNppActionPointGain` clamps at the cap (`src/lib/npp/actionPoints.test.ts`).
- Loyalty and favorability stay at or below 100, stubbornness at or above 0 (clamps in `partyExecutorEffects.ts`, tested in `partyExecutorEffects.test.ts`).
- Only same-party, non-retired NPPs are targeted (`partyExecutorValidation.test.ts`).
- PS never exceeds the cap after a refill; the state cap clamps down even a hoarded balance (`partyActionGeneration.test.ts`).
- A management action always reports success after payment. Enforced by the fixed `outcome` constant, not by a test of chance.

## Failure and recovery

- **Pool never initialised** (a paused or never-refilled world). The guarded debit would not match a missing field, so the executor first heals it to the tier cap before debiting, guarded to be idempotent under concurrent spends.
- **Concurrent spends.** The guarded atomic debit lets only one of two simultaneous clicks pass when only one is affordable.
- **Partial queue.** A national batch that errors midway leaves earlier items applied and charged. The response lists each item's result; there is no automatic rollback.
- **Wrong stat state after relocation.** Relocation recounts presence for both regions via `updatePartyPresence`; if a region still shows the wrong presence flag, a presence recount heal repairs it.
- **Treasury goes negative elsewhere.** NPP management refuses to spend (the `$gte` guard), but budgets also pause until the treasury recovers.

## Connections

**Driven by:**

- [Party building](./party-building.md): tier (Major or Minor) sets the pool size, org level feeds the recorded chance and recruitment slots.
- [Parties](./parties.md): treasury, leadership roles and the growth frontier.

**Affects:**

- [NPP system](./npp-system.md): loyalty and stubbornness change whip compliance and Slate acceptance; favorability and influence feed election scoring.
- [Party slate](./party-slate.md): the Slate assignment score sets the floor on recorded chance, and loyalty and stubbornness decide acceptance.
- [Party whips](./party-whips.md): loyalty and stubbornness gate hard-whip rolls.
- Elections: relocation withdraws an NPP from open candidacies (`performNppRelocation`).

## Tests

| Area | Test file |
| --- | --- |
| Executor, payment, attempt records | `src/lib/influence/partyExecutor.test.ts` |
| Stat effects | `src/lib/influence/partyExecutorEffects.test.ts` |
| Validation and caps | `src/lib/influence/partyExecutorValidation.test.ts` |
| National route | `src/app/api/country/[code]/parties/[id]/influence/route.test.ts` |
| State route | `src/app/api/country/[code]/region/[id]/party/[partyId]/influence/route.test.ts` |
| AP pools and costs | `src/lib/npp/actionPoints.test.ts` |
| Recruitment | `src/lib/npp/recruitment.test.ts` |
| PS refill | `src/lib/turn/partyActionGeneration.test.ts` |
| Tier | `src/lib/parties/partyTier.test.ts` |
| Frontier | `src/lib/parties/partyFrontier.test.ts` |
| Rate limit | `src/lib/api/rateLimit.test.ts` |

Gaps: no test covers the recorded-chance formula against the stated constants end to end, and the national batch stop-on-error behaviour is only covered through the route.

## Known issues and history

- The recorded chance has no gameplay effect (outcome is fixed to success) but is still computed and stored, and the options (GET) responses still show the catalog `baseChance`, which can mislead.
- `getNationalRelocationTargetCost` computes a relocation request cost with `calculateRelocationRequestCost` but discards it; relocation charges 1 AP and no treasury. The cost helper and the recruitment `BASE_COSTS` ladder in `src/lib/npp/recruitment.ts` are not used by live charging.
- The national surface falls back to Org 50 when the home-state Org value is 0, because the lookup uses `||`, so a genuine 0% Org is recorded as 50.
- Four catalog actions (`endorse_candidate`, `withdraw_election`, `oppose_candidate`, `support_leadership`) remain defined but blocked at both routes.
- Code comments date the PS income rebalance to 2026-06-25 (passive 20 and 5, investment up to 20 per turn, state cap 30 with the 25% NPP-only fraction) and remove soft cap bands on 2026-06-28.

## Related Docs

- [npp-system.md](./npp-system.md)
- [parties.md](./parties.md)
- [party-building.md](./party-building.md)
- [party-slate.md](./party-slate.md)

Last checked: 2026-10-29, version 1.18.0
