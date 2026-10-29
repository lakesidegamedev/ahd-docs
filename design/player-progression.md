# Player Progression

How a character grows from a new independent to holding the top office: the career phases, what each office pays in actions and campaign funds, and how the main stats move turn to turn. This page covers the US and UK ladders in detail; other countries use the same stat and action rules with their own offices (see each country's wiki pages).

## Summary

Player guide: [Player Progression](https://www.ahousedividedgame.com/wiki/player-progression)

A character starts with a fixed kit, wins offices through primaries and general elections, and each office adds a flat bonus to actions, campaign funds and National Influence every turn. Everything here is applied by the hourly turn processor except character creation (a request) and office changes (election resolution). Wiki-facing numbers are in the tables below with their source files.

## Rules

### Character creation

When a player first joins the game (`POST /api/auth/character`, `src/app/api/auth/character/route.ts`):

1. **Choose Country**: any country enabled for players (admins bypass; US and UK are detailed below)
2. **Create Character**: choose name and avatar
3. **Select Starting State / Region**:
   - US: pick any of the 50 states (affects PI, fund generation base, election eligibility); Alaska and Hawaii are playable homes before statehood (see [Statehood Admission](./statehood-admission.md))
   - UK: pick ENG, SCO, WAL, or NIR (determines Commons election eligibility)
4. **Set Policy Positions**: choose economic and social positions (rounded to whole numbers, -5 to +5 scale)
5. **Optionally allocate 28 RPG stat points** when the RPG stats flag is on; without an allocation the character goes through a grandfather allocation flow on next login
6. **Initial resources:**

| Resource | Start | Source |
| --- | --- | --- |
| Actions | 25 (`startingActions`), +10 if the account was referred | `src/lib/seeds/reference/gameConfig.ts`; referral in the route |
| Campaign Funds | 250,000 (`startingFunds`), scaled by the world's era price level, held in the home currency when forex is on | `gameConfig.ts`, `resolveCampaignPriceLevel` |
| Cash on Hand | wealth background: 1,000,000 (low), 2,500,000 (middle) or 5,000,000 (high), era-scaled; referral adds 500,000 (era-scaled) | `WEALTH_BONUS`, `getWealthBonus`, `src/lib/constants/characterWealth.ts` |
| Political Influence | 10 (`max(startingPoliticalInfluence, NEW_CHARACTER_STARTING_INFLUENCE)`); referral raises it by 10% (floor) | `startingPoliticalInfluence` is 0 in `gameConfig.ts`; the 10 floor is `NEW_CHARACTER_STARTING_INFLUENCE` in `shared/constants/formulas.ts` |
| National Influence | 0 | route |
| Favorability | 50 (`startingFavorability`); referral raises it by 10% (floor) | `gameConfig.ts` |
| Infamy | 0 (`startingInfamy`) | `gameConfig.ts` |
| Donor Base Level | 1 (`max(startingDonorBaseLevel, MIN_STARTING_DONOR_BASE_LEVEL)`) | `gameConfig.ts`; `MIN_STARTING_DONOR_BASE_LEVEL = 1` in the route |
| Party Influence | 0 | route |
| Position update vouchers | 0 | route |

7. **Starting status:** Independent by default, or a chosen open party (approval-only and defunct parties are refused; membership starts the party tenure clock). Not in office.
8. **Account limit:** one character per account (a higher test-mode limit exists). Creation is refused during maintenance for non-admins and when a Discord link is required and missing.

### Changing home state

`POST /api/character/relocate` (`src/app/api/character/relocate/route.ts`):

- **Allowed**: yes, with a 72-turn (3 real days) cooldown since the last relocation, and the destination country must be enabled for players (admins bypass).
- **Penalty**: Political Influence, Donor Base Level and group favorability always reset to 0 (regional political capital). National Influence resets on a country change. Party and Party Influence reset on a confirmed move outside the party's live frontier.
- **Side effects**: active candidacies are withdrawn; state or region-bound offices auto-resign (country-scoped offices only on a country change); a CEO role resigns unless the move is with the corporation; a central-bank chair resigns on a country change; a `relocated` entry is added to career history.
- **Use case**: strategic repositioning to a different political landscape.

---

### US career path

#### Phase 1: Build foundation

- Players start as independents with no office
- Build stats: Political Influence, Favorability, Donor Base
- Raise funds through Fundraising and per-turn fund generation
- Can campaign, fundraise, build donor base, run ads, commission polls
- Can Support/Attack other politicians (raise or lower their Favorability)
- Can Barnstorm for allies (raises the ally's Political Influence: +2 if you share their home state, +1 otherwise, capped at 100; the price is what Campaign would cost you for that gain times 1.25, `priceExternalBoost`, `src/lib/influence/rules.ts`)
- Can boost/influence NPPs from their profile pages
- **Cannot** write bills or vote on legislation

#### Phase 2: Join party

- Join a default or custom party, or remain independent and use the independent primary path
- Party membership starts building **Party Influence** - the higher your party influence relative to other members, the more bonus actions you receive each turn from the party pool
- Policy alignment to the party platform amplifies how efficiently your party influence converts to bonus actions
- Can switch parties later (with stat penalties: Favorability and PI drop)

#### Phase 3: Primary election

- Declare candidacy during primary phase (before `primaryEndTime`)
- Primary resolution uses **primary score** (alignment to party position + favorability + influence)
  - State races (House, Senate, Governor, State Senate): uses **Political Influence (PI)**
  - Presidential race: uses **National Political Influence (NPI)**
- Highest primary score per party advances to the general
- See [Election Mechanics](./elections.md)

#### Phase 4: General election

- Compete against other party nominees
- Vote accumulation each turn; the final 4 turns receive 30% of the vote pool
- Sustained campaigning matters; policy alignment and Favorability affect votes
- **State races**: Political Influence (PI) drives reach and appeal
- **Presidential race**: NPI drives reach and appeal. The general-election curve is `sqrt(min(NPI, 100) / 100)`, capped at 1 (`normalizeNPI`, `src/lib/utils/normalizeNPI.ts`); the presidential primary uses diminishing returns `1 - exp(-NPI / 45)` (`normalizeNationalReachPresidentialPrimary`, same file)
- Winner takes office

##### Presidential candidate: Travel

During a presidential **general election**, active candidates can **Travel** to any US state (`POST /api/elections/[id]/travel`). The cost is based on the state's electoral-vote tier: 3, 5, 7, or 10 actions. While traveling:

- You earn **+1% Favorability per turn** passively (no action needed; applied in `src/lib/turn/campaignTurn.ts` for presidential races)
- Your travel state appears as a badge on the electoral map and candidate row, signaling your focus to opponents
- Switching states pays the destination state's current travel cost
- Strategic travel compensates for lower NPI in swing states

#### Phase 5: In office

- Gain bonus actions per turn (tiered by office)
- Can write bills (if in Congress)
- Can vote on legislation (if in Congress)
- Voting shifts policy positions (+-0.25 per vote in direction of bill; see [Policy System](./policy-system.md))
- Per-turn fund generation includes office bonus
- Face re-election at end of term

#### Phase 6: Re-election / advancement

- Run for re-election in same office
- Or seek higher office (House -> Senate -> Governor -> President)
- Only one office at a time
- **Note**: Moving toward a presidential run shifts the key influence stat from PI to NPI. NPI gains each turn from state PI plus a bonus for the highest position held, and decays 1% per turn, so it settles where gain equals decay. Maintaining high state influence early accelerates NPI growth (`src/lib/turn/actionRefresh.ts`)

---

### UK career path

#### Phase 1: Build foundation (same as US)

- Build PI, Favorability, Donor Base; join a party before running

#### Phase 2: Commons election

- UK players run in **regional Commons elections** for England, Scotland, Wales, or Northern Ireland
- Multi-seat proportional allocation - more than one candidate per party can win seats in the same region
- Candidacy limited to your home region

#### Phase 3: Hold an MP seat

- **MPs**: Vote on UK legislation passing through Parliament
- Fund generation and action bonuses work the same as US offices
- Face re-election each Commons cycle (perpetual scheduling)

#### Phase 4: Prime Minister

- After each Commons cycle resolves, seat totals are summed nationally by party
- The **largest-party leader** is nominated as Prime Minister candidate
- A **confidence vote** among all MPs determines whether they're confirmed
- Confirmed PMs gain the highest action bonus and fund generation in the game
- **No-confidence motions**: MPs from the ruling block can trigger a vote to remove the sitting PM; if it passes, a new confidence process begins
- Use the UK Government hub at `/executive/uk` for seat totals, government status, and confidence votes

---

### Office benefits

#### Action bonus (per turn)

| Office | Bonus | Total (Base 4) |
| --- | --- | --- |
| House | +1 | 5 |
| State Senate | +1 | 5 |
| Senate | +2 | 6 |
| Vice President | +2 | 6 |
| Governor | +2 | 6 |
| President | +4 | 8 |
| UK MP (Commons) | +1 | 5 |
| UK Prime Minister | +4 | 8 |
| Cabinet seat (US, UK and parliamentary cabinets) | +1, stacks on the holder's seat | |

The base is at least 4 per turn (`MIN_BASE_ACTIONS_PER_TURN` in `src/lib/stats/statsConstants.ts`; `baseActionsPerTurn: 4` in `src/lib/seeds/reference/gameConfig.ts`). The office bonus resolves in this order (`resolveOfficeActionBonusForType`, `src/lib/actions/officeBonusRegistry.ts`): an admin override keyed `<country>:<office>` in `gameConfig.officeActionBonus`, then the country's office registry (`actionBonus` per office, for the US in `src/lib/countries/us/institutionsFacts.ts`), then the bare key in `gameConfig.officeActionBonus`. The following stack on top of an elected office (`src/lib/actions/positionNiBonus/rules.ts`, `gameConfig`):

| Role | Action bonus | Rule |
| --- | --- | --- |
| Central bank chair | +3 (`chairActionBonus`) | stacks |
| Supreme Court justice | +2 (`JUSTICE_ACTION_BONUS`) | stacks |
| Speaker (and equivalents) | +3 | highest leadership role only |
| Majority or minority leader, Leader of the Opposition | +2 | highest leadership role only |
| Whips, president pro tempore | +1 | highest leadership role only |
| Shadow cabinet member | +1 | highest leadership role only |

#### National Influence position bonus (per turn)

The highest qualifying tier applies (`resolvePositionNiBonus`, `src/lib/actions/positionNiBonus/rules.ts`; `resolveOfficeNiBonus`, `src/lib/actions/officeBonusRegistry.ts`):

| Role | NI per turn |
| --- | --- |
| National head of government or executive head of state (President, PM, Chancellor) | 2.5 |
| Deputy executive (Vice President), party chair, Speaker and majority leader tier | 2.0 |
| Governor and other sub-national executives, confirmed cabinet member, central bank chair, justice, minority leader, party vice chair or treasurer | 1.5 |
| National legislator, ceremonial head of state | 1.0 |
| State or regional legislator, state party chair | 0.5 |
| Acting cabinet member | 0.75 |
| Major-company CEO / other qualifying CEO | 0.3 / 0.15 |
| International organisation head | +1.0 on top of the domestic tier |

#### Fund generation bonus (per turn)

| Office | Bonus |
| --- | --- |
| House | +$5,000 |
| State Senate | +$3,000 |
| Senate | +$15,000 |
| Vice President | +$25,000 |
| Governor | +$15,000 |
| President | +$50,000 |

Values are `OFFICE_FUND_BONUS` in `src/lib/utils/fundGeneration.ts`, paid per turn (a turn is 60 minutes, `turnLengthMinutes` in `gameConfig.ts`). The flat office bonus is not scaled by state wealth, but it is scaled by the world's era price level (`getTotalFundGeneration`); the base rate and donor bonus scale with both. UK equivalents: MP $5,000, Prime Minister $50,000; cabinet members $5,000.

#### Vice President

- **Selection**: running mate chosen by the Presidential candidate
- **Powers**: breaks tie votes in the Senate
- **Action Bonus**: +2 per turn

#### Legislative powers

- **House Members**: can write bills and vote on House legislation
- **Senators**: can write bills and vote on Senate legislation
- **Vice President**: breaks tie votes in Senate
- **Governors**: can appoint players to vacant Senate seats in their state
- **President**: sign or veto bills passed by Congress

---

### Party Influence over time

Party Influence accrues passively each turn you're a member and accumulates relative to other party members. It translates to **bonus actions per turn** from the shared party pool:

- Members with high party influence extract more bonus actions each turn
- Policy closeness to the party's platform amplifies efficiency
- Staying active and invested in party operations keeps your standing high
- Leaving and rejoining a party resets your Party Influence to 0

Mechanics (`processPartyInfluenceTurn`, `src/lib/turn/partyInfluenceTurn.ts`): influence = `max(0, current x (1 - decayRate) + turnGain)`; bonus actions = `min(maxBonus, floor(myInfluence / totalInfluence x pool x closeness))`. Defaults: decay 0.04 per turn, base gain 3, max penalty 4, pool = 3 x member count (`partyInfluencePoolMultiplier`), max bonus 6 (`partyInfluenceMaxBonus`), all `gameConfig` fields with floors in code. Party Influence is visible on your profile (Party Standing section) and in the party members table. See [Political Parties](./parties.md) for the full calculation.

---

### Out of office activities

When not holding office, players can:

- Campaign (any state, with cost multipliers for out-of-state)
- Run Ads
- Fundraise
- Build Donor Base
- Commission polls (Quick, Full Demographic)
- Support or Attack other politicians (Favorability changes)
- Barnstorm for allies (+PI, see Phase 1)
- Influence NPPs (Endorse, Withdraw, Oppose, Support Leadership)
- Send Wire Transfers (Cash on Hand) from Portfolio

**Cannot**:

- Write bills
- Vote on legislation
- Use office-specific powers (Travel is presidential-candidates-only during general)

---

### Stat progression summary

| Stat | Starting | How to Increase | Notes |
| --- | --- | --- | --- |
| Political Influence | 10 | Campaign (+1%) | 0-100, decays 0.75% per turn (`POLITICAL_INFLUENCE_DECAY_RATE = 0.0075`), up to 2x faster for the party holding the national executive (`2 - approval / 100`) |
| National Influence | 0 | State PI term + position bonus per turn | Decays 1% per turn (`NATIONAL_INFLUENCE_DECAY_RATE`); state PI term below; settles at 100 x gain |
| Favorability | 50 | Ads, Campaign, Travel (+1%/turn while active) | 0-100; drained by (Favorability - 60) x 0.05 above 60, by (Infamy - 20) x 0.05 above 20 infamy, by government accountability, and by attacks |
| Infamy | 0 | Attack or NPP lower actions; policy shift (+5) | 0-100, decays 5% per turn (x0.95) |
| Campaign Funds | 250k (era-scaled) | Fundraise, fund generation, donor base | Spent on campaign actions |
| Cash on Hand | wealth background | See [Stats & Actions](./stats-actions.md) | Wire transfers only |
| Donor Base Level | 1 | Build Donor Network | Fund cost (3,000 + 1,500 x level) x GDP-per-capita scalar (0.85 to 2.0) x era price level (`getBuildDonorBaseFundCost`, `src/lib/actions/rules.ts`) |
| Actions | 25 initial | +4 base + office bonus + party bonus per turn | Cap 200 (up to 250 with Energy 10); lose 4 per turn above 100 (up to 125) |
| Party Influence | 0 | Passive accrual while party member | Drives bonus action share per turn |

National Influence state term (`calculateNationalInfluenceGain`, `shared/constants/formulas.ts`), with SI the character's current Political Influence: `SI/50 - 0.5` for SI up to 50, and `0.5 + (SI - 50) x 0.03` above 50. SI 0 gives -0.5, SI 25 gives 0, SI 50 gives +0.5, SI 75 gives +1.25, SI 100 gives +2.0.

## Data

| Collection | Fields | Read or written |
| --- | --- | --- |
| `characters` | `actions`, `funds`, `cashOnHand`, `currencyBalances`, `politicalInfluence`, `nationalInfluence`, `partyInfluence`, `favorability`, `infamy`, `donorBaseLevel`, `policies`, `party`, `partyJoinedTurn`, `homeState`, `countryId`, `currentOffice`, `positionUpdateVouchers`, `stats`, `statXp`, `roleActionBonus`, `positionNiBonus`, `politicalInfluenceDecayMultiplier`, `ceoNiTier`, `ceoNiTenure`, `actionGrantLog` | created by the route; refreshed each turn by `processActionRefresh` |
| `users` | `referredBy` | read at creation |
| `gameConfig` (`_id: "default"`) | starting values, `baseActionsPerTurn`, `officeActionBonus`, `chairActionBonus`, party influence fields | read |
| `centralBanks`, `supremeCourtSeats`, `congressLeaders`, `politicalParties`, `statePartyOrg`, `caucuses`, `cabinetMembers`, `electedOfficials` | role holders (chair, justice, leader, party chair, cabinet seat) | read to compute bonuses |
| `npps` | `politicalInfluence`, `favorability` | decayed in the same pass (NPP influence floor 10, no infamy) |
| `elections` / `electionCandidates` | travel state | read and written by the travel route |

Player-visible: the profile and dashboard show every stat above, the Party Standing section, and the per-turn grant log; `roleActionBonus` and `positionNiBonus` feed the stat tooltips. `startingPoliticalInfluence` is recorded on the character so onboarding metrics can tell real growth from the start.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `startingFunds`, `startingActions`, `startingFavorability`, `startingInfamy`, `startingPoliticalInfluence`, `startingDonorBaseLevel` | 250000, 25, 50, 0, 0, 1 | `src/lib/seeds/reference/gameConfig.ts` |
| `baseActionsPerTurn` | 4 (raised to 4 if lower) | `gameConfig.ts`; floor `MIN_BASE_ACTIONS_PER_TURN` in `src/lib/stats/statsConstants.ts` |
| `turnLengthMinutes` | 60 | `gameConfig.ts` |
| `officeActionBonus` | map of office key (or `<country>:<office>`) to bonus | `gameConfig.ts`; country registries in `src/lib/countries/*/institutionsFacts.ts` |
| `chairActionBonus` | 3 (fallback 3) | `gameConfig.ts` |
| `partyInfluenceDecayRate`, `partyInfluenceBaseRate`, `partyInfluenceMaxPenalty`, `partyInfluencePoolMultiplier`, `partyInfluenceMaxBonus` | 0.04, 3, 4, 3, 6 | code defaults in `partyInfluenceTurn.ts`; pool and max bonus also in `gameConfig.ts` |
| `campaignEraPriceLevelEnabled` | on in fresh worlds | `gameConfig`; scales starting funds by era |
| RPG stats flag | per world | `isRpgStatsEnabled`; gates the 28-point allocation and the Energy-based caps |
| World preset | per world | `gameState.preset`; era-scales wealth bonus, referral bonus and funds |
| Energy cap and hoard values | 200 to 250, 100 to 125 | `src/lib/stats/statsConstants.ts` |

## Timing

Progression is applied by the hourly turn processor. `processActionRefresh` in `src/lib/turn/actionRefresh.ts` runs once per turn for every character and does, in one pass: action refresh (base + office + chair/justice/leadership bonuses, then the Energy cap), influence decay, national influence gain and decay, infamy decay (x0.95) and the favorability drains (computed from pre-decay infamy), and RPG stat drift. Fund generation is computed separately from `src/lib/utils/fundGeneration.ts`. Party bonus actions are applied after the refresh by `processPartyInfluenceTurn`, with the same Energy cap. Office and election results change a character's office between turns, so a new officeholder's bonuses first apply on the next refresh. Election phases are described in [Election Mechanics](./elections.md).

```
turn: election resolution   -> sets currentOffice
turn: processActionRefresh  -> actions, PI, NI, infamy, favorability (reads currentOffice)
turn: processPartyInfluenceTurn -> party influence, bonus actions (after refresh)
turn: fund generation       -> office bonus + base + donor bonus, taxed
request: relocate / create  -> immediate
```

## Worked trace

A US House member (Energy stat absent, so Energy 1 limits apply: cap 200, hoard threshold 100) with 90 actions, PI 40, NI 0, Favorability 55, Infamy 30, not in the executive party, no other roles. One refresh turn.

1. Actions. Refresh = base 4 + House 1 = 5. Hoard check: 90 is not above 100, so no penalty. New actions = `min(200, 90 - 0 + 5) = 95`.
2. Political Influence. `40 x (1 - 0.0075) = 39.70`.
3. National Influence. State term for SI 40: `40/50 - 0.5 = 0.30`. Position bonus: national legislator 1.0. Gain 1.30. NI = `0 - 0 + 1.30 = 1.30`. Settles at 130 if sustained.
4. Favorability. Above-60 penalty: 0 (55 is under 60). Infamy drain from pre-decay infamy: `(30 - 20) x 0.05 = 0.50`. No government accountability drain assumed. New favorability = `55 - 0 - 0.5 = 54.5`.
5. Infamy. `30 x 0.95 = 28.5`.
6. Funds. Office bonus $5,000 (House), scaled by the world's price level, added to base and donor legs before tax.
7. Stored on the character in one bulk write; the stored `roleActionBonus` is 0 and `positionNiBonus` 1.0.

If the same member had 130 actions: hoard threshold exceeded, so `130 - 4 + 5 = 131`.

## Edge cases and limits

- **Action cap.** The cap is Energy based: 200 at Energy 1, up to 250 at Energy 10 (`ENERGY_BASE_ACTION_CAP`, `ENERGY_MAX_ACTION_CAP` in `src/lib/stats/statsConstants.ts`, interpolated by `energyActionLimits`, `src/lib/stats/statDrift.ts`). Characters with no Energy stat use the baseline.
- **Hoarding.** Above the threshold (100 at Energy 1, up to 125 at Energy 10, `ENERGY_BASE_HOARD_THRESHOLD`, `ENERGY_MAX_HOARD_THRESHOLD`) a character loses 4 actions per turn (`ACTION_HOARD_PENALTY`). It stops banked actions being spent in one burst before an election.
- **Base floor.** A config value below 4 is raised to 4.
- **Home state change.** Costs all Political Influence in every state, plus donor base and group favorability.
- **Party switch.** Leaving and rejoining resets Party Influence to 0.
- **Infamy.** Floors at 0; favorability drain applies only above 20 infamy.
- **Influence caps.** PI is clamped to 0 to 100 in the decay formula; decay never goes below 0 for players and never below 10 for NPPs.
- **Travel.** Presidential general-election candidates only. Cost by electoral votes (`getTravelActionCost`, `src/lib/constants/states.ts`): 5 or fewer EV costs 3, 6 to 10 costs 5, 11 to 20 costs 7, above 20 costs 10 actions.
- **Stacking.** Offices do not stack with each other (one office at a time); a cabinet seat stacks with the holder's legislative seat; chair, justice and leadership bonuses stack with an office, but leadership roles do not stack with each other (highest only).
- **Executive party decay.** Members of the party holding the national executive lose PI up to twice as fast: multiplier `2 - approval / 100` (1.0 at 100% approval, 1.5 at 50%, 2.0 at 0%).
- **Referral.** +10 actions, +10% starting PI and Favorability, and an era-scaled 500,000 Cash on Hand; donor base is not boosted.
- **Missing numeric action refresh.** A character whose computed refresh is not a number is skipped and logged.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Actions never exceed the Energy cap and never go below 0 | `$min` / `$max` in the refresh update; `actionRefresh.test.ts` |
| Hoarding penalty applies only above the threshold | `actionRefresh.test.ts` ("applies hoarding penalty when actions > 100") |
| Base actions are at least 4 | `Math.max(config, MIN_BASE_ACTIONS_PER_TURN)`; `actionRefresh.test.ts` |
| Favorability and PI stay within 0 to 100 | Clamps in the refresh and formulas; `shared/constants/formulas.test.ts` |
| NI settles at 100 x gain | `shared/constants/formulas.test.ts` ("settles at 100 x gain") |
| NPPs never decay below influence 10 | `applyPoliticalInfluenceDecay` floor; `formulas.test.ts` |
| Highest leadership and NI tier wins, not a sum | `src/lib/actions/positionNiBonus.test.ts` |
| One character per account | Atomic slot reservation in the creation route; `discordGate.test.ts` covers the Discord gate only, so the slot rule has no dedicated test |
| Refresh writes are not applied to a character edited mid-pass | Compare-and-set filter on the stat fields in the second bulk update; not directly tested |

## Failure and recovery

- **Wrong action balance after a turn.** The grant is computed from live `actions` inside the update, so a balance spent mid-turn is not overwritten (tested). Each grant is recorded in `actionGrantLog`, which is how a disputed balance is reconstructed.
- **Stats not refreshed.** A character edited between the read and the compare-and-set write skips the stat update for that turn and is picked up on the next turn; the action grant is a separate update and still applies.
- **Missing role bonus.** A holder of a chair, justice seat or leadership post who does not receive the bonus usually has a stale role document (the role collection does not point at the character). Repair is to correct the role document; the next refresh applies the bonus.
- **Stuck low influence from a bad reset.** Player decay floors at 0 and refreshes every turn; a wrong value is corrected by a data repair on the character.
- **Creation failures.** Creation reserves the account slot before inserting and returns clear errors for maintenance, disabled country, Discord link and unavailable party; a failed insert after a reserved slot is a data repair.
- **Seed or reset.** A world reset recreates characters from scratch; there is no partial recovery path for starting values beyond editing the character.

## Connections

**Driven by**
- [Election Mechanics](./elections.md): office won or lost sets the action and fund bonuses (`currentOffice` read in `src/lib/turn/actionRefresh.ts`).
- [Political Parties](./parties.md): Party Influence sets the bonus-action share from the party pool.
- [Stats & Actions](./stats-actions.md): Energy sets the action cap and hoard threshold (`energyActionLimits`, `src/lib/stats/statDrift.ts`).

**Affects**
- [NPP System](./npp-system.md): NPP stat decay mirrors player decay in the same refresh pass (with an influence floor of 10 and no infamy).
- Fund generation: office bonus feeds `src/lib/utils/fundGeneration.ts`.
- [Election Mechanics](./elections.md): PI and NPI drive primary scores and general election reach.
- [Policy System](./policy-system.md): the policy shift action spends actions, influence and infamy.

## Tests

| File | Covers |
| --- | --- |
| `src/lib/turn/actionRefresh.test.ts` | Refresh, live-balance grants, hoarding penalty |
| `src/lib/turn/actionRefreshRoles.test.ts` | Role lookups for bonuses |
| `src/lib/turn/partyInfluenceTurn.test.ts` | Party influence and bonus actions |
| `shared/constants/formulas.test.ts` | Favorability and infamy drains, PI and NI formulas, executive decay |
| `src/lib/actions/officeActionBonus.test.ts`, `officeBonusRegistry.test.ts`, `positionNiBonus.test.ts` | Office, NI and leadership bonus resolution |
| `src/app/api/elections/[id]/travel/route.test.ts`, `src/lib/constants/states.test.ts` | Travel route and cost tiers |
| `src/app/api/auth/character/discordGate.test.ts` | Discord gate at character creation |
| `src/lib/actions/rules.test.ts` | Action rules including donor base cost |

Gaps: no test pins the full starting kit (Cash on Hand, referral bonuses, PI floor of 10) end to end, and the relocation penalty list has no test listed here.

## Known issues and history

- Corrected 2026-10-29: the page previously stated Political Influence starts at 0, Cash on Hand at $0, and that NPI is uncapped with logarithmic scaling. The code starts PI at 10 (the NPP seed), Cash on Hand from the wealth background, and caps general-election NPI reach with a square-root curve. The page now matches the code and the player guide.
- Donor base cost is `3,000 + 1,500 x level` scaled by state GDP per capita, not `$50k + $25k x level`.
- Barnstorm is priced from the Campaign quote, not a fixed 5 actions and $100k.
- The code comment on `normalizeNPI` and a stray comment in `demographicAppeal.ts` disagree on the cap (1.0 versus 2.0); the function clamps to 100 and returns at most 1.
- The player guide's "Phase 0" kit (25 actions, 250,000 funds, wealth-based cash, PI 10) matches the code.

Last checked: 2026-10-29, version 1.18.0
