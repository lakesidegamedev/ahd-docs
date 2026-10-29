# Campaign Manager System

## Summary

The Campaign Manager is the per-candidacy campaign page at `/campaign/[id]`: two resource pools (funds and campaign actions), four Strategic Operations trees, donations, endorsements and managers. This page is the exact rules; for how to use the page see the player guide. Costs, upkeep and fog tables are in [Campaign Strategy](./campaign-strategy.md).

Player guide: [Campaign Manager](https://www.ahousedividedgame.com/wiki/campaign-manager)

## Rules

### Eligibility

A race runs a Campaign doc only when `isCampaignEligibleElection` (`src/lib/campaigns/isCampaignEligible.ts`) returns true:

- **President**: any country whose executive is directly elected (`isDirectElection`). Russia additionally needs a valid `russianPresidentialRound` binding (round 1 or 2, positive `mandateSinceTurn`, positive `registeredVoters`).
- **Other races**: the country must set `campaignManagerNonPresidentialEnabled`, and the election type must be in the country's `campaignRaceFamilies`. The default set, used by the US, is `senate`, `governor`, `house`, `stateSenate`. UK (`commons`, `special_commons`) and Japan (`shugiin`, `snap_shugiin`, `sangiin`, `governor`) opt in by name. German and Irish races stay off until list and STV systems are mapped onto per-candidate campaigns.

`POST /api/elections/[id]/enter` calls `createInitialCampaign` behind this gate, and the admin routes `start-general` and `place-candidate` use the same gate, so a non-direct-election "president" office never spawns a campaign pool. Some effects are narrower than eligibility: player endorsements count only in presidential races, and the travel presence bonus is presidential-only (see Edge cases and limits).

### Access tiers

| Viewer                   | Access Level    | What They See                                                   |
| ------------------------ | --------------- | --------------------------------------------------------------- |
| **Campaign owner**       | Full management | All tabs: overview, upgrades, donations, activity log, settings |
| **Same-party member**    | Intelligence    | Basic candidate info, endorsement count, public upgrade levels  |
| **Public / other party** | Summary         | Candidate name, party, office sought, public stats only         |

This creates a "fog of war" mechanic: players cannot see the full details of opponents' campaigns. In code the tiers are `owner`, `party` and `public` (`src/lib/campaigns/queries/campaignQueries.ts`); nominee, managers, admins and the presidential running mate all get the owner view, with a narrower action set for the running mate.

### Campaign resources

Each campaign has two independent resource pools:

- **Campaign Funds**: fundraising income per turn, player donations and party donations. Spent on upgrades, maintenance, field offices and ads.
- **Campaign Actions**: generated per turn by `campaignActionsPerTurn` in `src/lib/campaigns/actions.ts`. Spent on upgrades and field offices.

These are entirely separate from the candidate's personal funds and character actions, so a campaign cannot drain the candidate and the candidate cannot spend campaign money on themselves. Leftover funds are not paid back to the candidate.

### Campaign actions per turn

```
perTurn = baseline + floor( sqrt( weightedEndorsements ) × 3 )
weightedEndorsements = npp + (presidential ? player : 0)
                     + (governor + executive) × GOVERNOR_ENDORSEMENT_CAMPAIGN_ACTIONS
```

- `baseline` is `max(baseActionsPerTurn, 4)` from game config (`src/lib/campaigns/actions.ts`). NPP-run campaigns use `max(1, floor(baseline / 2))`.
- `calculateCampaignActions` falls back to a baseline of 1 only if called without one, or with a non-finite or non-positive baseline. A negative or non-finite endorsement count returns the bare baseline. The turn processor always passes the real baseline, so live campaigns earn at least 4.
- Governor endorsements are weighted by `GOVERNOR_ENDORSEMENT_CAMPAIGN_ACTIONS = 1.5` (`src/lib/constants/governorOffice.ts`) in non-presidential races only. A governor's presidential endorsement is state-scoped and becomes an in-state vote multiplier instead, so it grants no actions. Executive endorsements are weighted the same way in every race.
- Sources are summed before the square root, so spreading endorsements across source types gives no extra bonus. The square root is the bound on farming arranged endorsements; there is no hard cap on the curve.

Reference values at baseline 4: 0 endorsements gives 4 actions a turn, 4 gives 10, 9 gives 13, 16 gives 16, 25 gives 19, 100 gives 34.

### Action bank cap

`CAMPAIGN_ACTION_BANK_TURNS = 48` (`src/lib/campaigns/actions.ts`). A campaign can hold at most `48 × perTurn` actions from income. `cappedCampaignActionGrant` credits `min(perTurn, cap - current)` and never less than 0. A campaign already over the cap keeps its actions and earns nothing until it spends below the line. Example: 10 a turn caps at 480.

### Strategic Operations (branch trees)

Campaigns invest in four levers, each a **starter unlock + three branch sub-tracks** (Strategic Operations v2), not a single flat 0-10/0-5 level. Unlocking a lever's starter node gates its branches; each branch then levels independently 1-3 (`OPS_MAX_BRANCH_LEVEL = 3`). Source: `src/lib/campaigns/upgradeCosts.ts` (`OPS_TREES`), owner-facing tree state in `src/lib/campaigns/dto/campaignView.ts`.

| Lever                    | Starter unlock             | Branches                                                                                                     |
| ------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Fundraising**           | +$35k/turn base income      | **Grassroots** (steady recurring income), **Bundlers** (one-time cash infusion on purchase), **Direct Mail** (multiplies ALL campaign income) |
| **Ground Game**           | base swing-area boost       | **Swing Canvassing** (swing-area performance), **Get-Out-The-Vote** (smaller boost across ALL areas), **Volunteer Corps** (cuts ground game's ongoing upkeep) |
| **Media Spending**        | base favorability gain      | **Broadcast**, **Television** (cheaper favorability, lower upkeep), **Rapid Response** (blunts opponents' opposition research against you) |
| **Opposition Research**   | base favorability drain     | **Dossier** (recurring drain on your target), **Scandal Leak** (one-time hit to current target), **Counter-Intel** (amplifies your recurring drain) |

A legacy flat `fundraisingLevel` / `mediaSpendingLevel` / `groundGameLevel` / `oppositionResearchLevel` (0-10 / 0-5) still exists on the `Campaign` doc as a migrated summary (`migrateCampaignOpsTrees` maps old levels onto a starter + branch state); the branch trees are the live mechanic players invest in.

Upgrade costs (funds and actions) are **1.5× higher** (`GENERAL_PHASE_UPGRADE_MULTIPLIER`, `src/lib/campaigns/upgradeCosts.ts`) once the election is in its general phase: primary closed, election not yet ended. Recurring maintenance is not surcharged. The server gate (`upgradeCampaign`, `src/lib/campaigns/commands/campaignCommands.ts`) and the UI price preview both read `getEffectiveBranchCost`, so the displayed and charged costs agree. Fundraising is also the one lever a running-mate surrogate may upgrade; the other three are manager or nominee only.

The full per-branch cost, upkeep and effect tables (`OPS_TREES`) and the per-race scalar are in [Campaign Strategy](./campaign-strategy.md).

### Opposition Research

Purchasing opposition research requires selecting a target. The target's favorability drains passively each turn (see Timing).

- **Retargeting**: change your target via the campaign page. `OPPOSITION_RESEARCH_COOLDOWN_TURNS = 6` (`src/lib/campaigns/commands/campaignManagementCommands.ts`) turns apply between retargets, stored as `oppositionResearchCooldownUntilTurn` (turn-first, so it freezes when the game is paused). The legacy `oppositionResearchCooldownUntil` date is only read for campaigns that predate the turn field.
- `POST /api/campaigns/[id]/retarget`: owner or manager only; requires the opposition starter (or legacy `oppositionResearchLevel > 0`). The target must be a real opponent in this race: the same list the picker offers (`loadOppositionTargets`) gates the purchase, including the first purchase of the starter. You cannot research your own candidate.
- `POST /api/campaigns/[id]/opposition-research/reset` resets research and clears the cooldown.
- **Rapid Response shield**: the target's `oppoShieldPct` (Media Spending branch c) multiplies the drain by `(1 - shield)` before the season multiplier. If several campaigns shield the same character the largest shield is used.

### Campaign season multiplier

When the election is within 4 turns of closing, the passive media favorability gain and opposition research drain are doubled (2×). No player action required. The rule is `endTurn - currentTurn <= 4` (`src/lib/turn/campaignTurn.ts`), turn-first so it stays aligned with turn-based race resolution even if the game clock drifts; elections without an `endTurn` fall back to `ceil(hoursRemaining) <= 4` against `endTime`. The window matches the vote engine's closing surge so passives and votes intensify together. Income, maintenance and actions are not doubled.

### Passive favorability gains are bent near the top

After the season multiplier, the summed positive passive gain on a candidate (media, travel presence, primary in-state bonus) goes through `diminishPassiveFavorabilityGain` (`src/lib/actions.ts`):

```
penalty = favorability > 80 ? (favorability - 80) × 0.15 : 0     // PASSIVE_FAV_DIMINISH_THRESHOLD, PASSIVE_FAV_DIMINISH_RATE
gain    = max(0.5, rawGain - penalty)                            // PASSIVE_FAV_MIN_PER_TURN
```

Negative nets (opposition research) pass through untouched. A missing favorability is read as 50.

### Donations

Any authenticated player can donate personal Cash on Hand to any active campaign (whole-number amount, minimum $1, `src/app/api/campaigns/[id]/donate/route.ts`). The party chair, vice chair or treasurer can donate from the party treasury, and only to a campaign inside that party.

- **Donation log**: recorded in `campaign.donationLog`, trimmed to the last 100 entries (`$slice: -100`, `src/lib/campaigns/commands/campaignCommands.ts`). Fields: donor name, donor type (`"character"` | `"party"`), amount, turn number.
- `POST /api/campaigns/[id]/donate`: body `{ amount: number, partyId?: string }`. Omit `partyId` for a personal donation; include it for a party donation (officer authorization required). Amounts arrive in anchor currency and are converted to the campaign's local currency at the frozen campaign rate.
- Donations raise `funds` and `totalFundsGenerated`.

### Manager assignment

A campaign can have up to `MAX_CAMPAIGN_MANAGERS = 3` managers (`src/lib/campaigns/access.ts`).

- **Player route**: `POST /api/campaigns/[id]/manager`, nominee or admin, appoints or clears a manager. A manager must be in the campaign's country and cannot be the candidate. The legacy single `managerId` / `managerCharacterId` pair is still read and mirrored to the first manager, so no migration is needed.
- **Admin route**: `POST /api/admin/campaigns/[id]/assign-manager`.
- **Manager powers**: upgrades, field offices, targeted ads, rally, color, retargeting and opposition reset. Managers cannot withdraw the candidate or change the manager list.
- **Use case**: party leadership delegating campaign oversight, or splitting media, presence and research between players.

### Endorsements

NPP endorsements are **manual-only**. They come from explicit asks in the player-to-NPP interaction panel rather than organic turn-time re-evaluation. The endorsement check stays hidden from players, but the panel shows a `Likely to Accept` / `Likely to Decline` chip based on current relationship and policy fit. For **presidential elections**, player endorsements also count toward the campaign actions formula. For all other race types, player endorsements are cosmetic only.

Active NPP endorsements matter in two ways:

- they feed campaign action generation (the formula above)
- they add a small capped direct favorability boost in race calculations so endorsements are not purely an action-economy stat

Endorsements are swept before campaigns are paid each turn: governor, executive and player-endorsement party sweeps run before `campaignTurn`, so an endorsement withdrawn this turn stops this turn's action grant.

| Viewer | Endorsement visibility          |
| ------ | ------------------------------- |
| Owner  | Full list with influence levels |
| Party  | Count only                      |
| Public | Not shown                       |

### API routes

| Route                                      | Method | Access        | Purpose                                          |
| ------------------------------------------ | ------ | ------------- | ------------------------------------------------ |
| `/api/campaigns/[id]`                      | GET    | Tiered        | Campaign detail (access level shapes response)   |
| `/api/campaigns/mine`                      | GET    | Authenticated | Current user's active campaign                   |
| `/api/campaigns/[id]/upgrade`              | POST   | Owner/Manager | Purchase an upgrade (1.5× cost in general phase) |
| `/api/campaigns/[id]/donate`               | POST   | Authenticated | Donate funds (personal or party treasury)        |
| `/api/campaigns/[id]/retarget`             | POST   | Owner/Manager | Change opposition research target (6-turn cooldown) |
| `/api/admin/campaigns/[id]/assign-manager` | POST   | Admin         | Assign a manager character to a campaign         |
| `/api/campaigns/[id]/campaign-strength` | POST | Authenticated | Contribute campaign strength (presidential) |
| `/api/campaigns/[id]/rally` | POST | Manager/Nominee | Fire a one-shot rally |
| `/api/campaigns/[id]/rally-tour` | POST | Manager/Nominee | Toggle the ongoing rally tour |
| `/api/campaigns/[id]/field-offices` | GET/POST | Public / Manager | List field offices; open a new office |
| `/api/campaigns/[id]/targeted-ads` | GET/POST | Manager/Nominee | Quote and buy a regional ad bonus |
| `/api/campaigns/[id]/suspend-endorse` | POST | Nominee | Suspend a presidential campaign and endorse another ticket |
| `/api/campaigns/[id]/color` | POST | Manager/Owner | Set the campaign display color |
| `/api/campaigns/[id]/manager` | POST | Nominee/Admin | Appoint or clear the campaign manager |
| `/api/campaigns/[id]/opposition-research/reset` | POST | Manager/Owner | Reset opposition research and the retarget cooldown |

## Data

| Collection  | Purpose                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `campaigns` | Campaign state: candidate reference, manager assignment, resource pools, upgrade levels, donation log, fog-of-war snapshots |
| `electionCandidates` | Read by `campaignTurn` for `travelState`, `runningMateTravelState`, `primaryCampaignState`, suspension; `primaryCampaignTicks` is incremented there |
| `characters` / `npps` | `favorability` is written by the passive effects (media gain to self, opposition drain to the target) |
| `elections` | Read for `electionType`, `endTurn`, `primaryEndTurn`, `countryId` (scalar, phase and season window) |

### Key `Campaign` fields

Field types are in `src/lib/db/types/campaign.ts`.

| Field                             | Type                 | Purpose                            |
| --------------------------------- | -------------------- | ---------------------------------- |
| `funds`                           | `number`             | Current campaign fund balance, in the campaign's local currency |
| `actions`                         | `number`             | Current campaign action balance    |
| `status`                          | `"active" \| "archived"` | Archived campaigns are skipped by the turn |
| `fundraisingTree` etc.            | `{ starter, a, b, c }` | Live branch-tree state per lever (`fundraisingTree`, `groundGameTree`, `mediaSpendingTree`, `oppositionResearchTree`) |
| `fundraisingLevel`                | `number` (0-10)      | Legacy flat level, read only for un-migrated rows |
| `mediaSpendingLevel`              | `number` (0-5)       | Legacy flat level                  |
| `groundGameLevel`                 | `number` (0-5)       | Legacy flat level                  |
| `oppositionResearchLevel`         | `number` (0-5)       | Legacy flat level                  |
| `oppositionResearchCooldownUntilTurn` | `number \| null` | Turn the retarget cooldown ends    |
| `activityHistory`                 | array                | Capped at `CAMPAIGN_ACTIVITY_HISTORY_CAP = 200` (`src/lib/campaigns/constants/activityHistory.ts`) |
| `oppositionTargetId`              | `ObjectId \| null`   | Current opposition research target |
| `oppositionResearchCooldownUntil` | `Date \| null`       | Legacy date form of the cooldown   |
| `donationLog`                     | `CampaignDonation[]` | Last 100 donation entries          |
| `managers`, `managerId`, `managerCharacterId` | array, legacy pair | Up to 3 managers; the legacy pair mirrors the first |
| `totalFundsGenerated`, `totalFundsSpent`, `totalActionsGenerated`, `totalActionsSpent` | `number` | Lifetime counters, written by the turn and by purchases |
| `spendThisTurn`, `spendStock`     | `number`             | Money driver for the vote engine (see Timing) |
| `publicFogOfWar`                  | `CampaignFogOfWar`   | Public-visible upgrade snapshot    |
| `partyFogOfWar`                   | `CampaignFogOfWar`   | Party-visible upgrade snapshot     |

Shown to players: the owner sees everything above. Party viewers see fogged levels and an endorsement count; the public sees the public fog snapshot. Counters, the donation log and `activityHistory` are owner-facing.

## Configuration

| Setting | Default | Set in | Effect |
| ------- | ------- | ------ | ------ |
| `gameConfig.baseActionsPerTurn` | 4 | `src/lib/seeds/reference/gameConfig.ts` (type in `src/lib/db/types/gameConfig.ts`) | Campaign action baseline, floored at 4 |
| `CountryConfig.campaignManagerNonPresidentialEnabled` | off unless set | `src/lib/countries/{us,uk,jp}/institutionsFacts.ts` (type in `src/lib/constants/countries.ts`) | Allows non-presidential campaigns |
| `CountryConfig.campaignRaceFamilies` | US default set (`senate`, `governor`, `house`, `stateSenate`) | UK and Japan facts files override | Which race types get campaigns |
| `gameConfig.campaignEraPriceLevelEnabled` | unset (off, price level 1) | `src/lib/db/types/gameConfig.ts` | When on, costs, income, upkeep and lump sums scale by the era price level (`src/lib/campaigns/rules/priceLevel.ts`) |
| `gameConfig.politicalMediaMarketEnabled` | unset (off) | `src/lib/db/types/gameConfig.ts` | When on and media upkeep is owed, upkeep is paid through a political media order and its favorability effect is applied by that order |
| Election `endTurn`, `primaryEndTurn`, `electionType` | per race | election doc | Season window, general-phase surcharge, race scalar |

Era price levels when the flag is on (`ERA_PRICE_LEVEL`): 1953 0.03673, 1979 0.16688, 1991 0.35808, 1999 0.49707, 2007 0.6562, 2019 1, 2023 1.14996, 2027 1.28579. Unknown presets resolve to 1. Costs scale in funds only, not actions.

## Timing

Everything per-turn runs in `processCampaignTurn` (`src/lib/turn/campaignTurn.ts`), phase `campaignTurn`, inside the `billsCampaignsAndActivity` step of `src/simulation/phases/turnPhaseRegistry.ts`. In order:

1. Governor, executive and player-endorsement sweeps withdraw stale endorsements, so they run before campaigns are paid.
2. `selfHealMissingCampaigns` creates or reactivates a campaign for any active player candidate in an eligible race that lacks one.
3. Per campaign: skip archived campaigns and suspended candidacies. These draw no income, actions or maintenance.
4. Income is computed (`calculateCampaignIncome`), then actions (`campaignActionsPerTurn` capped by `cappedCampaignActionGrant`).
5. Maintenance is computed at the pre-downgrade levels, then `computeAutoDowngrade` demotes branches if `funds + income` cannot cover it. Passive effects below still use the pre-downgrade levels for this turn; the maintenance charged uses the post-downgrade levels.
6. One `$inc` writes `funds += income - maintenance`, `actions`, the lifetime counters and `spendThisTurn += maintenance`.
7. Passive favorability effects: media gain to self, opposition drain to the target (both times the season multiplier), then presidential travel presence and primary in-state bonuses; positive sums are bent by `diminishPassiveFavorabilityGain`.
8. After the campaign step: field-office upkeep (`campaignFieldOffices`).
9. Later, in `electionResolutionAndGovernment`: `voteAccumulation` reads the campaign (including `spendThisTurn`), then `campaignSpendReset` sets `spendStock = spendStock × SPEND_STOCK_RETENTION (0.8) + spendThisTurn` (values under `SPEND_STOCK_DUST_CUTOFF = 1` are dropped, `src/lib/electionEngine/electionFormulaFactors.ts`) and unsets `spendThisTurn`.

Fog of war is not part of `campaignTurn`: `updateCampaignFogOfWar` (`src/lib/campaigns/fogOfWar.ts`) runs from a cron on the turn schedule (`src/lib/cron.ts`, also `/api/cron/fog-update`) and is skipped while the game is paused. Purchases, donations, retargeting and rallies take effect immediately in the request, not at turn time.

## Worked trace

A governor campaign (race scalar 0.5), no price level, baseline 4. The campaign has 5 NPP endorsements, 2 governor endorsements, 1 executive endorsement, 620 banked actions, $300,000 in funds, a Fundraising tree of starter + Grassroots 1 + Direct Mail 1, and no other maintenance-bearing levers. Last turn's `spendStock` was 10,000.

1. Weighted endorsements: `5 + (2 + 1) × 1.5 = 9.5`. `floor(sqrt(9.5) × 3) = floor(9.2466) = 9`. perTurn = `4 + 9 = 13`.
2. Bank cap: `48 × 13 = 624`. Headroom `624 - 620 = 4`, so the grant is `min(13, 4) = 4`. Actions become 624.
3. Income: `round((35,000 + 200,000) × 1.15 × 0.5) = 135,125`.
4. Maintenance: Direct Mail 1 upkeep is 8,000, fundraising has no upkeep multiplier, `round(8,000 × 1 × 0.5) = 4,000`. Projected funds `300,000 + 135,125` cover it, so no downgrade.
5. Write: `funds = 300,000 + 135,125 - 4,000 = 431,125`; `totalFundsGenerated += 135,125`; `spendThisTurn = 4,000`.
6. After `voteAccumulation`: `spendStock = 10,000 × 0.8 + 4,000 = 12,000`, `spendThisTurn` removed.

## Edge cases and limits

- **Archived campaigns** (candidate withdrew, lost a primary or was removed) are kept for history and reactivation but earn nothing and stop refreshing fog.
- **Insolvency**: funds can go negative from earlier overspending; the auto-downgrade stops further drain but does not heal the debt. Details in [Campaign Strategy](./campaign-strategy.md).
- **Action bank cap**: 48 turns of income, never claws back (see Rules).
- **Level and branch caps**: each branch maxes at `OPS_MAX_BRANCH_LEVEL = 3`. A starter must be bought before any branch, and a branch cannot be bought on a lever without its starter ("Unlock this lever's starter before buying a branch"). Fog of war clamps displayed levels to `[0, max]` so rivals never see an impossible level.
- **Concurrent purchases**: the upgrade write is guarded on affordability and on the exact tree state it costed against, so a race returns 409 instead of double-applying.
- **Travel presence** (+1.0 favorability a turn while travelling, plus the running mate's presence at `vpTravelPresenceWeight`, 1 in the current ruleset in `src/lib/elections/presidentialRuleset.ts`) is presidential-only and skipped for NPP-run campaigns, because only the presidential travel system records a travel state. Media and opposition passives apply in every eligible race.
- **Primary in-state bonus**: a presidential player camped in a state during the primary gets `PRIMARY_CAMPAIGN_NATIONAL_FAV_BONUS = 1` favorability a turn and one tick of `primaryCampaignTicks` per turn up to `PRIMARY_CAMPAIGN_TICK_CAP = 5` (`src/lib/electionEngine/constants.ts`).
- **Opposition target in another country or outside the race** is rejected at purchase and retarget.
- **Currency**: funds are stored in the campaign country's local currency at a frozen rate; costs and income are authored in anchor dollars and converted on write.
- **Donations** are whole numbers of at least 1.
- **Why separate pools**: keeps campaign scale decoupled from personal wealth and character actions, so a rich candidate cannot buy a campaign directly and a campaign cannot bankrupt its candidate.

## Invariants

- Banked actions from income never exceed `48 × perTurn`, and the cap never removes actions already held. Enforced by `cappedCampaignActionGrant`; tested in `src/lib/campaigns/actions.cap.test.ts`.
- A branch level is at most 3 and never bought before its starter. Enforced at the purchase gate (`upgradeCampaign`); cost behaviour tested in `src/lib/campaigns/upgradeCosts.test.ts`.
- The charged upgrade cost equals the displayed cost, because both call `getEffectiveBranchCost`. Not enforced by a test comparing the two surfaces.
- The desk's promised action rate equals the engine's grant, because both call `campaignActionsPerTurn`. Enforced by sharing one function.
- At most 3 managers, and a manager is in the campaign's country and is not the candidate. Enforced in the manager command and route (`src/app/api/campaigns/[id]/manager/route.test.ts`).
- Insolvency demotion terminates (64-step guard) and never drops a zero-upkeep branch. Tested in `src/lib/campaigns/autoDowngrade.test.ts`.
- `funds` can be negative; nothing enforces a floor. Not enforced.

## Failure and recovery

- **Candidate active but no campaign** (legacy entry path, seeded roster, re-entry after archival, data wipe): `selfHealMissingCampaigns` repairs it within one turn, and the Campaign Manager page would otherwise show "Campaign not found".
- **Negative funds**: the auto-downgrade stops the bleed but the debt stays. Recovery is donations or zero-upkeep income branches, or an operator heal of the balance if the debt came from a bug.
- **Stale fog**: the fog job is separate from the turn and skipped while paused, so snapshots can lag. They refresh on the next run.
- **Concurrent writes**: purchases that lose a race return 409 and charge nothing; the player retries.
- **Wrong totals after an incident**: counters and `spendStock` can be rebuilt by a data heal; the turn does not recompute them from history.

## Connections

**Driven by**

- [NPP System](./npp-system.md): NPP, governor and executive endorsements feed `campaignActionsPerTurn`. Player endorsements count in presidential races only.
- [Elections](./elections.md): election type decides eligibility and the cost scalar; election phase decides the 1.5x general surcharge; `endTurn` decides the season window.
- [Stats & Actions](./stats-actions.md): `baseActionsPerTurn` sets the action baseline.
- Party treasury: chairs, vice chairs and treasurers donate through `donateToCampaign`.

**Affects**

- Candidate favorability: media gain and opposition drain are applied by `campaignTurn` to the candidate and the target documents, and read by the vote engine.
- Vote tally: ground game swing and GOTV effects are read by the presidential election engine (`src/lib/presidentialElectionEngine.ts`) and, for every other race, by the generic tally through `src/lib/campaigns/raceCampaignEffects.ts`, together with field offices; `spendThisTurn` is read by `voteAccumulation`.
- Finances: `totalFundsGenerated` and ledger entries record campaign income.
- [Campaign Strategy](./campaign-strategy.md): the cost, upkeep and fog tables.
- [Canvassing](./canvassing.md): a separate personal action; it spends character funds and actions, not the campaign pools.

Related pages: [Elections](./elections.md) (Elections Hub and candidacy rules), [Canvassing](./canvassing.md) (the personal turnout action), [Campaign Strategy](./campaign-strategy.md) (action allocation and win strategies), [Stats & Actions](./stats-actions.md) (action costs and campaign activities), [NPP System](./npp-system.md) (endorsement mechanics).

## Tests

- `src/lib/campaigns/actions.test.ts`, `src/lib/campaigns/actions.cap.test.ts`: action formula and bank cap.
- `src/lib/campaigns/income.test.ts`, `src/lib/campaigns/maintenance.test.ts`, `src/lib/campaigns/upgradeCosts.test.ts`, `src/lib/campaigns/autoDowngrade.test.ts`: income, upkeep, costs, insolvency.
- `src/lib/campaigns/isCampaignEligible.test.ts`, `src/lib/campaigns/access.test.ts`, `src/lib/campaigns/selfHealCampaigns.test.ts`, `src/lib/campaigns/fogOfWar.test.ts`.
- `src/lib/turn/campaignTurn.test.ts`, `src/lib/turn/elections/campaignSpendReset.test.ts`: the per-turn pass and the spend reset.
- Routes: `src/app/api/campaigns/[id]/donate/route.test.ts`, `retarget/route.test.ts`, `manager/route.test.ts`, `opposition-research/reset/route.test.ts`, `color/route.test.ts`; end to end in `src/app/api/campaigns/__tests__/campaign-system.integration.test.ts`.
- Gaps: no test file references `diminishPassiveFavorabilityGain` by name; no test compares the displayed and charged upgrade cost; no test in `campaignTurn.test.ts` references the political media market path.

## Known issues and history

- Fog of war is built from the legacy flat level fields, but `upgradeCampaign` only changes the branch trees. For campaigns bought entirely through trees, the fog snapshots can show legacy values (0 on new campaigns) rather than anything derived from the trees. Read from code, not confirmed against live data.
- Ground Game's vote effect applies to every eligible race, not only the presidency (`src/lib/campaigns/raceCampaignEffects.ts`). Earlier wording of this page said the presidential engine only.
- A Ground Game branch is named Swing Canvassing in code; field offices are a separate system with their own routes.
- The desk once promised 15 actions a turn while the engine credited 8, because the two derived the rate separately. Both now call `campaignActionsPerTurn` (noted in `src/lib/campaigns/actions.ts`).

Last checked: 2026-10-29, version 1.18.0
