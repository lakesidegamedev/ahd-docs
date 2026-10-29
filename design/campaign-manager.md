# Campaign Manager System

The Campaign Manager is the per-candidacy campaign page at `/campaign/[id]`: two resource pools (funds and campaign actions), four Strategic Operations trees, donations, endorsements and managers. This page is the exact rules; for how to use the page see the player guide.

Player guide: [Campaign Manager](https://www.ahousedividedgame.com/wiki/campaign-manager)

## Eligibility

A race runs a Campaign doc only when `isCampaignEligibleElection` (`src/lib/campaigns/isCampaignEligible.ts`) returns true:

- **President**: any country whose executive is directly elected (`isDirectElection`). Russia additionally needs a valid `russianPresidentialRound` binding.
- **Other races**: the country must set `campaignManagerNonPresidentialEnabled`, and the election type must be in the country's `campaignRaceFamilies`. The default set, used by the US, is `senate`, `governor`, `house`, `stateSenate`. UK `commons` and the Japanese `shugiin`, `sangiin` and governor races opt in by name. German and Irish races stay off until list and STV systems are mapped onto per-candidate campaigns.

`POST /api/elections/[id]/enter` calls `createInitialCampaign` behind this gate, and the admin routes `start-general` and `place-candidate` use the same gate, so a non-direct-election "president" office never spawns a campaign pool. Some effects are narrower than eligibility: player endorsements count only in presidential races, and the travel presence bonus is presidential-only (see Edge cases).

## Access Tiers

| Viewer                   | Access Level    | What They See                                                   |
| ------------------------ | --------------- | --------------------------------------------------------------- |
| **Campaign owner**       | Full management | All tabs: overview, upgrades, donations, activity log, settings |
| **Same-party member**    | Intelligence    | Basic candidate info, endorsement count, public upgrade levels  |
| **Public / other party** | Summary         | Candidate name, party, office sought, public stats only         |

This creates a "fog of war" mechanic: players cannot see the full details of opponents' campaigns.

## Campaign Resources

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
- `calculateCampaignActions` falls back to a baseline of 1 only if called without one, or with a non-finite or non-positive baseline. The turn processor always passes the real baseline, so live campaigns earn at least 4.
- Governor endorsements are weighted by `GOVERNOR_ENDORSEMENT_CAMPAIGN_ACTIONS = 1.5` (`src/lib/constants/governorOffice.ts`) in non-presidential races only. A governor's presidential endorsement is state-scoped and becomes an in-state vote multiplier instead, so it grants no actions. Executive endorsements are weighted the same way in every race.
- Sources are summed before the square root, so spreading endorsements across source types gives no extra bonus. The square root is the bound on farming arranged endorsements; there is no hard cap on the curve.

Worked example at baseline 4: 0 endorsements gives 4 actions a turn, 4 gives 10, 9 gives 13, 16 gives 16, 25 gives 19, 100 gives 34.

### Action bank cap

`CAMPAIGN_ACTION_BANK_TURNS = 48` (`src/lib/campaigns/actions.ts`). A campaign can hold at most `48 × perTurn` actions from income. `cappedCampaignActionGrant` credits `min(perTurn, cap - current)` and never less than 0. A campaign already over the cap keeps its actions and earns nothing until it spends below the line. Example: 10 a turn caps at 480.

## Strategic Operations (Branch Trees)

Campaigns invest in four levers, each a **starter unlock + three branch sub-tracks** (Strategic Operations v2), not a single flat 0-10/0-5 level. Unlocking a lever's starter node gates its branches; each branch then levels independently 1-3 (`OPS_MAX_BRANCH_LEVEL = 3`). Source: `src/lib/campaigns/upgradeCosts.ts` (`OPS_TREES`), owner-facing tree state in `src/lib/campaigns/dto/campaignView.ts`.

| Lever                    | Starter unlock             | Branches                                                                                                     |
| ------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Fundraising**           | +$35k/turn base income      | **Grassroots** (steady recurring income), **Bundlers** (one-time cash infusion on purchase), **Direct Mail** (multiplies ALL campaign income) |
| **Ground Game**           | base swing-area boost       | **Field Offices** (swing-area performance), **Get-Out-The-Vote** (smaller boost across ALL areas), **Volunteer Corps** (cuts ground game's ongoing upkeep) |
| **Media Spending**        | base favorability gain      | **Broadcast**, **Television** (cheaper favorability, lower upkeep), **Rapid Response** (blunts opponents' opposition research against you) |
| **Opposition Research**   | base favorability drain     | **Dossier** (recurring drain on your target), **Scandal Leak** (one-time hit to current target), **Counter-Intel** (amplifies your recurring drain) |

A legacy flat `fundraisingLevel` / `mediaSpendingLevel` / `groundGameLevel` / `oppositionResearchLevel` (0-10 / 0-5) still exists on the `Campaign` doc as a migrated summary (`migrateCampaignOpsTrees` maps old levels onto a starter + branch state); the branch trees are the live mechanic players invest in.

Upgrade costs (funds and actions) are **1.5× higher** (`GENERAL_PHASE_UPGRADE_MULTIPLIER`, `src/lib/campaigns/upgradeCosts.ts`) once the election is in its general phase: primary closed, election not yet ended. Recurring maintenance is not surcharged. The server gate and the UI price preview both read `getEffectiveBranchCost`, so the displayed and charged costs agree.

The full per-branch cost, upkeep and effect tables (`OPS_TREES`) and the per-race scalar are in [Campaign Strategy](./campaign-strategy.md).

## Opposition Research

Purchasing opposition research requires selecting a target. The target's favorability drains passively each turn (see Timing).

- **Retargeting**: change your target via the campaign page. `OPPOSITION_RESEARCH_COOLDOWN_TURNS = 6` (`src/lib/campaigns/commands/campaignManagementCommands.ts`) turns apply between retargets, stored as `oppositionResearchCooldownUntilTurn` (turn-first, so it freezes when the game is paused). The legacy `oppositionResearchCooldownUntil` date is only read for campaigns that predate the turn field.
- `POST /api/campaigns/[id]/retarget`: owner or manager only; requires the opposition starter (or legacy `oppositionResearchLevel > 0`). The target must be a real opponent in this race: the same list the picker offers (`loadOppositionTargets`) gates the purchase.
- `POST /api/campaigns/[id]/opposition-research/reset` resets research and clears the cooldown.
- **Rapid Response shield**: the target's `oppoShieldPct` (Media Spending branch c) multiplies the drain by `(1 - shield)` before the season multiplier.

## Campaign Season Multiplier

When the election is within 4 turns of closing, the passive media favorability gain and opposition research drain are doubled (2×). No player action required. The rule is `endTurn - currentTurn <= 4` (`src/lib/turn/campaignTurn.ts`), turn-first so it stays aligned with turn-based race resolution even if the game clock drifts; elections without an `endTurn` fall back to `ceil(hoursRemaining) <= 4` against `endTime`. The window matches the vote engine's closing surge so passives and votes intensify together. Income, maintenance and actions are not doubled.

## Donations

Any authenticated player can donate personal Cash on Hand to any active campaign (whole-number amount, minimum $1, `src/app/api/campaigns/[id]/donate/route.ts`). The party chair, vice chair or treasurer can donate from the party treasury, and only to a campaign inside that party.

- **Donation log**: recorded in `campaign.donationLog`, trimmed to the last 100 entries (`$slice: -100`, `src/lib/campaigns/commands/campaignCommands.ts`). Fields: donor name, donor type (`"character"` | `"party"`), amount, turn number.
- `POST /api/campaigns/[id]/donate`: body `{ amount: number, partyId?: string }`. Omit `partyId` for a personal donation; include it for a party donation (officer authorization required). Amounts arrive in anchor currency and are converted to the campaign's local currency at the frozen campaign rate.
- Donations raise `funds` and `totalFundsGenerated`.

## Manager Assignment

A campaign can have up to `MAX_CAMPAIGN_MANAGERS = 3` managers (`src/lib/campaigns/access.ts`).

- **Player route**: `POST /api/campaigns/[id]/manager`, nominee or admin, appoints or clears a manager. A manager must be in the campaign's country and cannot be the candidate. The legacy single `managerId` / `managerCharacterId` pair is still read and mirrored to the first manager, so no migration is needed.
- **Admin route**: `POST /api/admin/campaigns/[id]/assign-manager`.
- **Manager powers**: upgrades, field offices, targeted ads, rally, color, retargeting and opposition reset. Managers cannot withdraw the candidate or change the manager list.
- **Use case**: party leadership delegating campaign oversight, or splitting media, presence and research between players.

## Endorsements

NPP endorsements are **manual-only**. They come from explicit asks in the
player-to-NPP interaction panel rather than organic turn-time re-evaluation.
The endorsement check stays hidden from players, but the panel shows a
`Likely to Accept` / `Likely to Decline` chip based on current relationship and
policy fit. For **presidential elections**, player endorsements also count
toward the campaign actions formula. For all other race types, player
endorsements are cosmetic only.

Active NPP endorsements matter in two ways:

- they feed campaign action generation (the formula above)
- they add a small capped direct favorability boost in race calculations so endorsements are not purely an action-economy stat

Endorsements are swept before campaigns are paid each turn: governor, executive and player-endorsement party sweeps run before `campaignTurn`, so an endorsement withdrawn this turn stops this turn's action grant.

| Viewer | Endorsement visibility          |
| ------ | ------------------------------- |
| Owner  | Full list with influence levels |
| Party  | Count only                      |
| Public | Not shown                       |

## Database Collections

| Collection  | Purpose                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `campaigns` | Campaign state: candidate reference, manager assignment, resource pools, upgrade levels, donation log, fog-of-war snapshots |

### Key `Campaign` Fields

| Field                             | Type                 | Purpose                            |
| --------------------------------- | -------------------- | ---------------------------------- |
| `funds`                           | `number`             | Current campaign fund balance      |
| `actions`                         | `number`             | Current campaign action balance    |
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
| `publicFogOfWar`                  | `CampaignFogOfWar`   | Public-visible upgrade snapshot    |
| `partyFogOfWar`                   | `CampaignFogOfWar`   | Party-visible upgrade snapshot     |

## API Routes

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

## Timing

Everything per-turn runs in `processCampaignTurn` (`src/lib/turn/campaignTurn.ts`), phase `campaignTurn`, inside the `billsCampaignsAndActivity` step of `src/simulation/phases/turnPhaseRegistry.ts`. In order:

1. Governor, executive and player-endorsement sweeps withdraw stale endorsements, so they run before campaigns are paid.
2. Per campaign: skip archived campaigns and suspended candidacies. These draw no income, actions or maintenance.
3. Income is computed (`calculateCampaignIncome`), then actions (`campaignActionsPerTurn` capped by `cappedCampaignActionGrant`).
4. Maintenance is computed at the pre-downgrade levels, then `computeAutoDowngrade` demotes branches if `funds + income` cannot cover it. Passive effects below still use the pre-downgrade levels for this turn; the maintenance charged uses the post-downgrade levels.
5. Passive favorability effects: media gain to self, opposition drain to the target (both times the season multiplier), then presidential travel presence and primary in-state bonuses.
6. Later, in `electionResolutionAndGovernment`: `voteAccumulation` reads the campaign (including `spendThisTurn`), then `campaignSpendReset` clears `spendThisTurn` so the next turn starts at 0.

Fog of war is not part of `campaignTurn`: `updateCampaignFogOfWar` (`src/lib/campaigns/fogOfWar.ts`) runs from a cron on the turn schedule (`src/lib/cron.ts`, also `/api/cron/fog-update`) and is skipped while the game is paused. Purchases, donations, retargeting and rallies take effect immediately in the request, not at turn time.

## Edge cases and limits

- **Archived campaigns** (candidate withdrew, lost a primary or was removed) are kept for history and reactivation but earn nothing and stop refreshing fog.
- **Insolvency**: funds can go negative from earlier overspending; the auto-downgrade stops further drain but does not heal the debt. Details in [Campaign Strategy](./campaign-strategy.md).
- **Action bank cap**: 48 turns of income, never claws back (see Rules).
- **Level and branch caps**: each branch maxes at `OPS_MAX_BRANCH_LEVEL = 3`. Fog of war clamps displayed levels to `[0, max]` so rivals never see an impossible level.
- **Travel presence** (+1.0 favorability a turn while travelling, plus running-mate surrogate presence) is presidential-only and skipped for NPP-run campaigns, because only the presidential travel system records a travel state. Media and opposition passives apply in every eligible race.
- **Opposition target in another country or outside the race** is rejected at purchase and retarget.
- **Currency**: funds are stored in the campaign country's local currency at a frozen rate; costs and income are authored in anchor dollars and converted on write.
- **Donations** are whole numbers of at least 1.
- **Why separate pools**: keeps campaign scale decoupled from personal wealth and character actions, so a rich candidate cannot buy a campaign directly and a campaign cannot bankrupt its candidate.

## Connections

**Driven by**

- [NPP System](./npp-system.md): NPP, governor and executive endorsements feed `campaignActionsPerTurn`. Player endorsements count in presidential races only.
- [Elections](./elections.md): election type decides eligibility and the cost scalar; election phase decides the 1.5x general surcharge; `endTurn` decides the season window.
- [Stats & Actions](./stats-actions.md): `baseActionsPerTurn` sets the action baseline.
- Party treasury: chairs, vice chairs and treasurers donate through `donateToCampaign`.

**Affects**

- Candidate favorability: media gain and opposition drain are applied by `campaignTurn` to the candidate and the target documents, and read by the vote engine.
- Vote tally: ground game swing and turnout effects and field offices are read by the presidential election engine; `spendThisTurn` is read by `voteAccumulation`.
- Finances: `totalFundsGenerated` and ledger entries record campaign income.
- [Campaign Strategy](./campaign-strategy.md): the cost, upkeep and fog tables.
- [Canvassing](./canvassing.md): a separate personal action; it spends character funds and actions, not the campaign pools.

## Related Documentation

- [Elections](./elections.md), Elections Hub and candidacy rules
- [Canvassing](./canvassing.md), The personal turnout action
- [Campaign Strategy](./campaign-strategy.md), Action allocation and win strategies
- [Stats & Actions](./stats-actions.md), Action costs and campaign activities
- [NPP System](./npp-system.md), Endorsement mechanics

Last checked: 2026-10-29, version 1.18.0
