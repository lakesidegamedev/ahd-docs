# Campaign Manager System

The Campaign Manager is scoped to **US presidential races only** (more precisely: `electionType === "president"` AND the country's `executiveFormation === "direct_election"`). Senate, house, governor, UK commons, JP shugiin / sangiin, and other parliamentary races run candidates, endorsements, and vote tallies without a Campaign doc.

When a candidate enters a US presidential race (primary or general), `POST /api/elections/[id]/enter` calls `createInitialCampaign`, gated by `isCampaignEligibleElection`. The same gate is enforced in admin routes (`start-general`, `place-candidate`) so a future non-direct-election "president" office (e.g. parliament-appointed figurehead) will not spawn a Campaign Manager pool.

Each eligible candidacy has an associated campaign with a dedicated page at `/campaign/[id]`. The page adapts based on who is viewing it.

## Access Tiers

| Viewer                   | Access Level    | What They See                                                   |
| ------------------------ | --------------- | --------------------------------------------------------------- |
| **Campaign owner**       | Full management | All tabs: overview, upgrades, donations, activity log, settings |
| **Same-party member**    | Intelligence    | Basic candidate info, endorsement count, public upgrade levels  |
| **Public / other party** | Summary         | Candidate name, party, office sought, public stats only         |

This creates a "fog of war" mechanic: players cannot see the full details of opponents' campaigns.

## Campaign Resources

Each campaign has two independent resource pools:

- **Campaign Funds**, Earned from fundraising income per turn, player donations, and party donations. Spent on upgrades.
- **Campaign Actions**, Generated per turn from endorsements (`baseline + floor(sqrt(endorsements) × 3)`, where the baseline is the player's own base action gain per turn and is at least 1; `src/lib/campaigns/actions.ts`). Spent on upgrades.

These are entirely separate from the candidate's personal funds and character actions.

## Strategic Operations (Branch Trees)

Campaigns invest in four levers, each a **starter unlock + three branch sub-tracks** (Strategic Operations v2), not a single flat 0-10/0-5 level. Unlocking a lever's starter node gates its branches; each branch then levels independently 1-3 (`OPS_MAX_BRANCH_LEVEL = 3`). Source: `src/lib/campaigns/upgradeCosts.ts` (`OPS_TREES`), owner-facing tree state in `src/lib/campaigns/dto/campaignView.ts`.

| Lever                    | Starter unlock             | Branches                                                                                                     |
| ------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Fundraising**           | +$35k/turn base income      | **Grassroots** (steady recurring income), **Bundlers** (one-time cash infusion on purchase), **Direct Mail** (multiplies ALL campaign income) |
| **Ground Game**           | base swing-area boost       | **Field Offices** (swing-area performance), **Get-Out-The-Vote** (smaller boost across ALL areas), **Volunteer Corps** (cuts ground game's ongoing upkeep) |
| **Media Spending**        | base favorability gain      | **Broadcast**, **Television** (cheaper favorability, lower upkeep), **Rapid Response** (blunts opponents' opposition research against you) |
| **Opposition Research**   | base favorability drain     | **Dossier** (recurring drain on your target), **Scandal Leak** (one-time hit to current target), **Counter-Intel** (amplifies your recurring drain) |

A legacy flat `fundraisingLevel` / `mediaSpendingLevel` / `groundGameLevel` / `oppositionResearchLevel` (0-10 / 0-5) still exists on the `Campaign` doc as a migrated summary (`migrateCampaignOpsTrees` maps old levels onto a starter + branch state); the branch trees are the live mechanic players invest in.

Upgrade costs are **1.5× higher** once the election enters the general phase (`primaryEndTime ≤ now < endTime`).

## Opposition Research

Purchasing opposition research requires selecting a target. The target's favorability drains passively each turn based on your level.

- **Retargeting**, Change your target at any time via the campaign page. A **6-turn cooldown** (`oppositionResearchCooldownUntilTurn`) applies between retargets.
- `POST /api/campaigns/[id]/retarget`, Owner or manager only; requires `oppositionResearchLevel > 0`.

## Campaign Season Multiplier

In the final 4 turns before `election.endTime`, all passive effects from media spending and opposition research are automatically doubled (2×). No player action required.

## Donations

Any authenticated player can donate personal Cash on Hand to any active campaign (minimum $1). The national party chair can donate from the party treasury.

- **Donation log**, All donations are recorded in `campaign.donationLog` (last 100 entries). Fields: donor name, donor type (`"character"` | `"party"`), amount, turn number.
- `POST /api/campaigns/[id]/donate`, Body: `{ amount: number, partyId?: string }`. Omit `partyId` for personal donation; include it for a party donation (chair authorization required).

## Manager Assignment

An admin can assign a campaign manager character to any campaign:

- **API**: `POST /api/admin/campaigns/[id]/assign-manager`
- **Effect**: The assigned character gains limited management access to the campaign
- **Use case**: Party leadership delegating campaign oversight

## Endorsements

NPP endorsements are now **manual-only**. They come from explicit asks in the
player-to-NPP interaction panel rather than organic turn-time re-evaluation.
The endorsement check stays hidden from players, but the panel shows a
`Likely to Accept` / `Likely to Decline` chip based on current relationship and
policy fit. For **presidential elections**, player endorsements also count
toward the campaign actions formula. For all other race types, player
endorsements are cosmetic only.

Active NPP endorsements now matter in two ways:

- they continue to feed campaign action generation
- they also add a small capped direct favorability boost in race calculations so endorsements are not purely an action-economy stat

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
| `fundraisingLevel`                | `number` (0-10)      | Fundraising upgrade level          |
| `mediaSpendingLevel`              | `number` (0-5)       | Media spending upgrade level       |
| `groundGameLevel`                 | `number` (0-5)       | Ground game upgrade level          |
| `oppositionResearchLevel`         | `number` (0-5)       | Opposition research upgrade level  |
| `oppositionTargetId`              | `ObjectId \| null`   | Current opposition research target |
| `oppositionResearchCooldownUntil` | `Date \| null`       | Cooldown expiry for retargeting    |
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

## Related Documentation

- [Elections](./elections.md), Elections Hub and candidacy rules
- [Campaign Strategy](./campaign-strategy.md), Action allocation and win strategies
- [Stats & Actions](./stats-actions.md), Action costs and campaign activities
- [NPP System](./npp-system.md), Endorsement mechanics
