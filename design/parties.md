# Parties

## Summary

Umbrella technical page for the party system: membership, primaries, funds and taxes, organization, NPP recruitment, leadership, influence, slate, caucuses and coalitions. Each subsystem with its own design doc is linked from Connections. This page holds the constants and formulas that have no page of their own, and points to the dedicated pages for the rest.

Player guide: [Political Parties](https://www.ahousedividedgame.com/wiki/political-parties)

## Rules

### Party system and membership

- **Multi-party system:** Democrat, Republican and custom third parties are supported. Players are Independent by default. Independents use the independent-primary route where that race supports it; party members enter their party's primary. Party membership is required for a named party's primary, not for the independent-primary route.
- **Party formation:** players found custom parties by charter (three human founders, see the player guide). A new party starts with no organization units in any region and builds them through the Build Org action (see Party organization).
- **Joining:** anytime before running for office. A character can only join a party present in, or next to, its home region (growth frontier check in `src/lib/parties/partyFrontier.ts`, called by `canCharacterJoinParty`). Parties with `membershipMode: "approval"` file a pending request that a party leader accepts or declines. Joining resets `partyInfluence` to 0 and stamps `partyJoinedAt`, `partyJoinedTurn` and `lastPartySwitchAt` (`src/lib/parties/applyCharacterPartyJoin.ts`).
- **Switching delay:** 24 hours (real time, `PARTY_SWITCH_COOLDOWN_MS`) from the later of the last join and last switch (`src/lib/parties/antiAbuseGuards.ts`). Leaving to become Independent does not start a new delay and does not clear an existing one. While the admin flag `gameState.freePartyMovesOpen` is on, each character gets one move that ignores the delay (`freePartyMoveUsedAt`).
- **Expulsion rejoin block:** 24 turns for the expelling party only (`PURGE_REJOIN_COOLDOWN_TURNS`, `src/lib/constants/partyActions.ts`).
- **Party NPP controls:** slate and whip controls over NPPs unlock after membership has been stable for 48 hours (`PARTY_NPP_CONTROL_TENURE_MS`), with a 240 hour founding relaxation in worlds that start with no parties (`FOUNDING_NPP_CONTROL_WINDOW_MS`).
- **Leaving:** sets `party` to `independent` and `partyInfluence` to 0, updates `electedOfficials`, and withdraws mismatched primaries (`src/app/api/country/[code]/parties/[id]/leave/route.ts`).
- **Affiliation effects:** primary eligibility, general election ballot line, voter perception (party loyalty demographics) and endorsement opportunities.

### Endorsements

- **NPP endorsements:** players influence NPPs to endorse candidates via the NPP Influence system (see [NPP System](./npp-system.md)). Effect: the NPP publicly endorses a candidate and boosts that candidate's appeal. Cost: 6 actions and $0 on the NPP profile (`request_endorsement` in `CAPITAL_ACTIONS`, `src/lib/capital/actions.ts`); the party-level endorse action costs 3 (see [party-influence.md](./party-influence.md)).
- **Player-to-player endorsements:** implemented for active presidential elections. A human-controlled character may endorse another active candidate in the same country's presidential election. Candidates cannot endorse themselves, and a suspended presidential candidate cannot issue an endorsement.
- **One active endorsement:** posting a new endorsement replaces the character's previous one in that election, and it can be withdrawn. Endorsing a player candidate applies a one-time Support bump; replacing or withdrawing reverses the prior bump. NPP candidates can be endorsed but do not receive the character Support adjustment.

### Primary system

- **Nomination:** primary elections select the party nominee. Only one candidate per party per office advances. Resolution uses the **primary score** (alignment to party position + favorability + influence), not vote accumulation. The winner becomes the party nominee for the general.
- **Uncontested:** a single candidate wins automatically. **No entrants:** the party has no nominee for that race. **Multiple candidates:** the highest primary score per party advances.
- **Dynamics:** players compete within the party for nominations; parties compete in general elections; bipartisan cooperation and cross-party coalitions are possible on legislation.

Election windows come from `DEFAULT_DURATIONS` in `src/lib/constants/electionDurations.ts`. `durationHours` is the total window; the general phase is the trailing 24 turns.

| Election | Total | Primary phase | General phase |
| --- | --- | --- | --- |
| US House (`house`) | 96 | 72 | 24 |
| US Senate (`senate`) | 288 | 264 | 24 |
| Governor, State Senate, President | 192 | 168 | 24 |
| Japan Shugiin | 192 | 168 | 24 |
| Japan Sangiin | 144 | 120 | 24 |
| Most parliamentary lower chambers (Commons, Bundestag, Landtag, snap elections, Eastern-bloc assemblies) | 48 | 24 | 24 |

These are active-election windows. The gap between regular elections is controlled separately by each office's turn cycle.

### Fund generation and party taxes

Source: `src/lib/utils/fundGeneration.ts`. Rates are per turn (one turn is one hour).

| Population tier | Population | Base rate | Donor bonus per level |
| --- | --- | --- | --- |
| small | under 2M | $5,000 | $100 |
| medium | 2M to under 8M | $10,000 | $200 |
| large | 8M to under 20M | $20,000 | $400 |
| mega | 20M and over | $40,000 | $800 |

Office bonus (flat per turn, `OFFICE_FUND_BONUS`): House $5k, State Senate $3k, Senate $15k, Governor $15k, Vice President $25k, President $50k. The same table gives UK Commons $5k and Prime Minister $50k, Bundestag $5k, Chancellor $50k, Minister-President $15k, Landtag $3k, parliamentary and UK cabinet $5k.

Formulas:

- `donorBonus = round(DONOR_BASE_BONUS_PER_LEVEL[tier] * donorBaseLevel * (1 + clamp(stateInfluence, 0, 100) / 100))`; the influence multiplier is 1 when state influence is not supplied. A level 75 donor base adds $7,500 (small) to $60,000 (mega) before the multiplier.
- `gdpScalar = clamp(gdpPerCapita / baseline, 0.9, 1.5)` (`getIncomeGdpScalar`), with a per-country-era baseline from `src/lib/campaigns/rules/gdpBaseline.ts`. It is 1.0 when state GDP is omitted.
- `total = round(base * gdpScalar * priceLevel) + round(donorBonus * gdpScalar * priceLevel) + round(officeBonus * priceLevel)`; `priceLevel` is the between-era deflator and defaults to 1.
- `tax = floor(total * rate / 100)` when `0 < rate <= MAX_TAX_RATE` (33), else 0. The character receives `total - stateTax - nationalTax`.

Party members pay a state tax (to the state party treasury, set by the State Chair) and a national tax (to the national party treasury, set by the National Chair). Independents pay no taxes. `DEFAULT_NPP_STATE_TAX_RATE = 5` applies when no players are in the state party (`src/lib/constants/partyOrg.ts`). NPP generation is 50% of the player rate, with no office bonus, and diminishing returns by funds held: x1.0 up to 50,000, x0.75 to 150,000, x0.5 to 300,000, x0.25 above.

Treasuries: national and state parties both have treasury controls. Treasurers own the planning layer (reserve targets, dashboard and budget posture), while Chairs and Vice Chairs retain emergency access to move funds and adjust spending when needed.

### Party organization

Each state or region party has an organization percentage (0 to 100) that affects electoral performance. It is derived from contribution units, not a cap (`src/lib/parties/rules/organizationBucket.ts`, `src/lib/constants/partyOrg.ts`):

- Every region starts with a permanent 100 unit Unaffiliated stake (`ORG_BUCKET_BASELINE_UNITS`) that never decays and is always counted in the denominator.
- A successful Build Org action deposits one unit (`ORG_BUILD_UNITS_PER_CLICK`) for the acting party and stamps `lastOrganizationBuildTurn`.
- `organization = round(units / (100 + sum of all parties' units) * 100, 4 places)`.
- Decay: once `currentTurn - lastOrganizationBuildTurn >= ORG_DECAY_GRACE_TURNS` (96), units shrink by `ORG_UNIT_DECAY_RATE` (1%) each turn: `units' = units * 0.99`. At that rate an idle balance has a half-life of about 69 turns.
- Legacy rows without units are converted at up to `ORG_LEGACY_UNITS_PER_PERCENT_MAX` (10) units per percent so the permanent stake does not cause a visible drop.

Organization building requires party presence in the state: at least one player character in the party in that state, or at least one elected official (player or NPP) from the party there. When presence is lost, `orgBuildingPercent` resets to 0 and Build Org cannot add units. UK parties have state party org records for each UK region (England, Scotland, Wales, Northern Ireland, London) and the same mechanics apply. Stale party ID healing fixes org records that reference outdated party identifiers after the sequential ID migration.

### Party tier

`partyTierTurn` recomputes each party's Major or Minor tier from per-region Org (`src/lib/parties/partyTier.ts`): a region is earned at `TIER_EARN_REGION_ORG_PCT = 20` and lost below `TIER_LOSE_REGION_ORG_PCT = 10`; graduation needs `ceil(regions * 1/3)` earned regions (`1/4` in the UK, `UK_TIER_GRADUATION_REGION_FRACTION`); a Major party enters a demotion warning when `ceil(regions * 2/3)` regions are below the lose threshold, and is demoted after the `MAJOR_DEMOTION_GRACE_TURNS = 240` countdown unless it recovers. A Minor party's Political Strength cap is `MINOR_PARTY_BASE_PS_CAP = 100` plus `MINOR_PARTY_PS_CAP_PER_REGION = 10` per earned region. Tier selects the NPP Action Point pool below.

### NPP recruitment

Third parties can recruit NPP candidates to build their political bench through two mechanisms.

**Party creation spawn.** When a player creates a custom party, NPPs spawn across the selected states. The rule is `partyCreationNPPs` (`statesRequired`, `lockHomeState`, `nppsPerState`) in each country's `institutionsFacts.ts` (also in `src/lib/constants/countryClientConfig.ts`). Regions = `statesRequired + 1` when the home state is locked; total NPPs = regions x `nppsPerState`.

| Country | States selected | Home state | NPPs per state | Total |
| ------- | --------------- | ---------- | -------------- | ----- |
| US | 4 + home | locked | 2 | 10 |
| BR | 3 + home | locked | 2 | 8 |
| UK, DE, JP, FR, IE, CN, RU and most others | 2 | not locked | 1 | 2 |
| DD, PL, CS, HU, RO, BG, YU | 1 + home | locked | 2 | 4 |

The creation modal shows alignment indicators for each state (good, neutral, poor fit) based on how the party's positions match the state's political lean.

**Ongoing recruitment.** Party leadership recruits additional NPPs from the party Actions tab.

| Role | Scope | Resources used |
| --- | --- | --- |
| State Chair / Vice Chair | Their state only | State pool and treasury |
| National Chair / VC | States without active state leadership | National pool and treasury |

Per-state slots follow the state organization (`RECRUITMENT_SLOT_TIERS`, `src/lib/npp/recruitment.ts`):

| State Org | Max slots |
| --------- | --------- |
| 0 to 29% | 2 |
| 30 to 39% | 3 |
| 40 to 49% | 4 |
| 50% and over | 6 |

Available slots = max slots minus current party NPPs in that state.

Cost: 5 NPP Action Points (`NPP_RECRUITMENT_AP_COST`) plus a flat treasury cost by currency (`nppRecruitmentFundCost`, `src/lib/npp/actionPoints.ts`): 50,000 for USD, GBP, EUR, NGN and SUR (also the default for unlisted currencies); 200,000 for BRL and CNY; 500,000 for JPY. Management actions cost `NPP_MANAGEMENT_AP_COST = 1` AP; the treasury cost is 5,000 (boost) or 12,500 (loyalty) in the base tier, 25,000 or 50,000 in the BRL and CNY tier, 62,500 or 125,000 for JPY.

NPP Action Points are banked per party and refill each turn in `partyActionGeneration`: `balance' = min(cap, balance + regen)`; a legacy row with no balance heals to the cap.

| Scope | Tier | Pool cap | Regen per turn |
| --- | --- | --- | --- |
| National | Major | 160 | 16 |
| National | Minor | 80 | 8 |
| State | Major | 40 | 4 |
| State | Minor | 20 | 3 |

The older scarcity table (5 AP and $100,000 for the first NPP rising to 25 AP and $1,000,000 at four or more, with +1 action and +10% funds per 20 party NPPs, capped at +5 and +100%) still exists as `calculateRecruitmentCost` in `src/lib/npp/recruitment.ts`, but it now only prices relocation requests (25% of that cost, via `calculateRelocationRequestCost`), not recruitment.

**Party-wide NPP capacity** (`src/lib/npp/partyCapacity.ts`): 5 slots per active member for the first 5 members, 4 for members 6 to 10, 3 for members 11 to 20, 2 beyond; clamped to a country ceiling `max(25, 6 x regions)`. A member counts as active with at least `NPP_ACTIVE_MEMBER_MIN_ACTIONS = 2` game actions in the last 14 days and no ban.

**Growth frontier** (`src/lib/parties/partyFrontier.ts`): a party may only recruit into regions where it already has a member, elected official or active NPP, plus their direct neighbours.

**Cooldown:** 24 turns (`RECRUITMENT_COOLDOWN_TURNS`, `src/lib/npp/recruitmentCooldown.ts`). The national party and each state party track their own cooldown independently (`nppRecruitmentCooldownUntil` and `nppRecruitmentCooldownUntilTurn`).

### Party leadership

Each state party and the national party has three elected positions: **Chair** (highest authority; tax rates and treasury transfers), **Vice Chair** (second-in-command; assists with NPP influence operations) and **Treasurer** (treasury planning layer).

- Leadership elections default to 72 turns (`NATIONAL_ELECTION_DURATION_TURNS` in `src/lib/nationalPartyElectionConstants.ts`, `ELECTION_DURATION_TURNS` in `src/lib/statePartyElections.ts`) and are resolved by the turn system. Founding-phase windows are 12 turns (`FOUNDING_CHAIR_ELECTION_DURATION_TURNS`). National parties may set a custom duration of 168 to 420 turns (`NATIONAL_ELECTION_MIN_DURATION_TURNS`, `NATIONAL_ELECTION_MAX_DURATION_TURNS`). National committee elections run 168 turns (`COMMITTEE_ELECTION_DURATION_TURNS`, `src/lib/nationalCommitteeElections.ts`).
- All state party members may vote in all three elections simultaneously. A member may only be a candidate for one position at a time. Ties are broken by earliest declaration time. New elections are created automatically when a term expires.

### Chair Office: purge member (switched off)

The national party Chair can expel a regular member via the **Chair Office** tab. The mechanic is currently off: `PARTY_PURGE_ENABLED = false` in `src/lib/constants/partyActions.ts`, so chairs cannot expel members and the Chair Office hides the controls. When on:

- Only the national Chair can initiate a purge. Vice Chair, Treasurer and national committee members (during their term) cannot be purged, only regular members.
- **Cost to the chair:** infamy `min(100, floor(25 * 1.5^purgeCount))` (`PURGE_CHAIR_INFAMY_COST_BASE`, `PURGE_CHAIR_INFAMY_ESCALATION`, `PURGE_CHAIR_INFAMY_MAX`), added to the chair's infamy and capped at 100 total; and the chair's own party influence is reduced by `floor(target.partyInfluence / 2)`, floored at 0.
- **Effect on target:** `party` becomes `independent`, `partyInfluence` becomes 0, candidacies and state party positions are cleaned up (`withdrawFromMismatchedPrimaries`, `cleanupPartyPositionsOnSwitch`), `electedOfficials` records move to `independent`, a `purgeRejoinBlocks` entry is written, and the target receives a `party_kicked` notification.
- **Cooldown:** 48 turns per party (`PURGE_COOLDOWN_TURNS`), tracked in `PoliticalParty.lastPurgeAtTurn`; `purgeCount` is stored alongside.
- **API:** `POST /api/country/[code]/parties/[id]/purge`, auth `requireAuthWithCharacter` (chair only); body `{ characterId: string }`.

### Speaker of the House

The Speaker is elected by the full House using a multi-candidacy model.

1. Any sitting House member (player or NPP) may declare their own candidacy at any time.
2. Multiple candidacies can be active simultaneously.
3. Each House member casts one vote for one candidate; switching votes is allowed.
4. The first candidate to reach a simple majority of all filled House seats wins and is confirmed Speaker.
5. All other active candidacies are marked `failed`.

US congressional leadership voting is player-only in live NPP behavior: NPPs do not autonomously vote in Speaker, House leadership or Senate leadership elections. Leadership pages and player whip tools still exist for player coordination. API: `GET /api/congress/speaker` returns `activeCandidacies[]`, `houseTotal`, `majority`, `isHouseMember`, `hasActiveCandidacy` and `myVoteId`; `POST /api/congress/speaker` takes actions `declare`, `withdraw` and `vote`.

### NPP influence

See [NPP System](./npp-system.md). Players influence individual NPPs through deterministic actions on the NPP profile page (`/npp/[id]`). Live costs are in `CAPITAL_ACTIONS` (`src/lib/capital/actions.ts`):

| Action | Actions (AP) | Funds |
| --- | --- | --- |
| Request Endorsement | 6 | $0 |
| Private Meeting | 3 | $0 |
| Boost / Reduce Favorability | 5 | $10,000 |
| Boost / Reduce Influence | 6 | $20,000 |

There is no chance roll. Party-level NPP management (stat boosts, loyalty, cooperation, relocation) is separate and spends the party's NPP Action Points and treasury (1 AP each; see [party-influence.md](./party-influence.md)).

- **State or regional party** (Chair and Vice Chair only): local Recruitment and Management surfaces for same-party NPPs in that geography.
- **National party** (Chair and Vice Chair, confirmed campaigners): the same four tools plus relocation across states.
- State and regional management uses a four-action subset: Boost Favorability, Boost Political Influence, Strengthen Party Loyalty, Improve Cooperation. Management actions always succeed once validated and paid for; the roll-style chance is only recorded on the attempt log. Loyalty and cooperation change the stat by 1 to 3; favorability and influence follow diminishing curves.

### Whip system

Party leadership can issue whip directives to players and NPP legislators. NPP congressional leadership voting is not a live turn-system behavior, so the NPP whip gameplay is bill-facing.

- **Access:** state or regional party (Chair and Vice Chair) for local NPP whip authority; national party (Chair and Vice Chair) for federal authority plus whatever local fallback the route supports; caucuses for a caucus-only whip surface.
- **Targets:** bills (the primary active NPP whip target) and player leadership votes.
- **Attempts:** NPP bill whips allow at most 2 attempts per bill and chamber; the player whip allows 1 per chamber (`buildBillWhipPanelData`, `src/lib/congress/billWhipPanelData.ts`). NPP bill whips support `Soft` and `Hard`. State or regional whips take precedence over national whips where both apply.
- **Compliance:** `Hard` whips use a hidden loyalty and stubbornness success roll (`src/lib/partyWhips/whipSuccess.ts`, maximum chance `WHIP_MAX_SUCCESS_CHANCE = 95`) with an immediate vote write on success. `Soft` whips are advisory pressure fed into later autonomous cross-pressure voting. Party pages surface active Defiance, which clears when the NPP comes back into line.
- **API:** `GET /api/parties/[id]/whippable-bills`, `GET /api/parties/[id]/whippable-leadership`, `GET /api/state/[id]/party/[partyId]/whippable-bills`, `POST /api/state/[id]/party/[partyId]/whip`.

### Party influence

Every party member has a Party Influence score that accrues passively each turn they are an active member. Bonus actions are distributed to members in proportion to their share of the party's total influence. Defaults: `DEFAULT_PARTY_INFLUENCE_POOL_MULTIPLIER = 3` and `DEFAULT_PARTY_INFLUENCE_MAX_BONUS = 6` in `src/lib/turn/partyInfluenceTurn.ts`; the code uses the larger of the GameConfig value and the default for both. Other rates fall back to the values below when GameConfig does not set them (`partyInfluenceBaseRate`, `partyInfluenceDecayRate`, `partyInfluenceMaxPenalty`).

1. **Per-turn gain** = `baseRate * closeness + leadershipBonus - infamyPenalty`, with `baseRate = 3`.
2. **Decay then add:** `new = max(0, current * (1 - 0.04) + gain)`. The 4% decay is a half-life of about 17 turns without gain.
3. **Closeness** (0 to 1) = `max(0, 1 - distance / sqrt(200))`, where distance is the Euclidean distance between the member's and the party's (economic, social) positions on the -5..+5 axes.
4. **Leadership bonus** (flat, stackable): National Chair +5, Vice Chair +2, Treasurer +2, National Committee +1, State Chair +2, State Vice Chair +1, Caucus Chair +2, Caucus Vice Chair +1.
5. **Infamy penalty** = `min(maxPenalty, maxPenalty * ln(1 + infamy) / ln(1 + 300))` (`INFAMY_REFERENCE = 300`), with `maxPenalty = 4`.
6. **Bonus action pool** = `poolMultiplier * number of player members`.
7. **Each member's bonus actions** = `min(maxBonus, floor(influence / totalInfluence * pool * closeness))` with `maxBonus = 6`, added to the character's actions up to the Energy-scaled action cap and logged in `actionGrantLog` with source `party`.

Leaving a party resets Party Influence to 0, and rejoining starts fresh. The profile page Party Standing card, the members table and the party page header show the score and bonus actions. Members close to the platform gain influence faster and convert it into more bonus actions, a single active member of a small party can dominate the pool, and switching parties loses all accumulated standing.

### Analytics, slate, caucuses, treasury planning

- **Analytics tab:** national and state or regional pages carry an internal command center with areas Org and Growth, Discipline and Compliance, and Slate and Race Coverage; national pages add Caucus Health. Non-members only see the public Overview and Members views.
- **Slate:** a real assignment surface. National parties manage a map-backed state or region race board; state or regional parties get the scoped board. Same-party NPPs can be Slate-assigned; state or regional chairs and vice chairs get a small hidden acceptance edge on local assignments; defending incumbents can still auto-file, so Slate can create a same-party primary against an incumbent NPP. See [party-slate.md](./party-slate.md).
- **Caucuses:** player and NPP membership, caucus treasury and tax, caucus whip, caucus chair elections, caucus health surfaces and relationship-driven NPP recruitment and retention. Constants: `CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP = 60`, `CAUCUS_NPP_RECRUIT_COOLDOWN_TURNS = 12`, `CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP = 20`, `NPP_RELATIONSHIP_DECAY_PER_TURN = 0.1` (`src/lib/constants/partyOrg.ts`). See [Caucuses](./caucuses.md).
- **Treasury planning:** reserve targets, preset postures, state-funding visibility and override history for party leadership.

### Coalitions

Cross-party alliances where national party chairs band together under a shared banner. See [Coalitions](./coalitions.md) for the dedicated page.

- **Formation:** only national party chairs (party-level `chairId`). Cost: 25 actions, no monetary cost (checked and deducted in `src/app/api/country/[code]/coalitions/route.ts`, refunded on failure). The party must not already be in a coalition. The creator chooses name (unique per country, case-insensitive), abbreviation, color and optional logo. The creator's party becomes the first member and the creator becomes coalition chair.
- **Membership:** a party can belong to at most one coalition; no cap on member parties. The coalition chair sends invites to eligible parties (same country, not in a coalition); the invited party's national chair accepts or declines. A non-coalition national chair can request to join; only one pending request at a time across all coalitions.
- **Leadership and succession:** the coalition chair is always a national chair of a member party. If the chair's party leaves, is kicked or is deleted, chairmanship passes to the member with the earliest `joinedAt`. The chair can transfer ownership voluntarily, and the coalition chair auto-syncs when a party's national chair changes (`src/lib/coalitions/syncCoalitionChair.ts`).
- **Disband vote:** only the coalition chair can start one. It runs for exactly 24 hours (`DISBAND_VOTE_DURATION_HOURS`), with no early resolution. Each member party chair gets one yes or no vote and may change it during the window. More than 50% of total members must vote yes; abstentions count as no. The `coalitionDisbandVotes` phase resolves expired votes each turn.
- **Leaving and kicking:** any member party chair can leave; the coalition chair can kick any member. The coalition is deleted when zero members remain. A kicked party's chair is notified.
- **Priorities:** up to `MAX_ACTIVE_COALITION_PRIORITIES = 3` (`src/lib/coalitions/priorities.ts`); policy, bill or leadership-goal targets; public or internal visibility; member-party chair voting; cohesion summary (Strong, Mixed, Fractured, Unaligned).
- **UI:** nested under the Political Parties page as a Coalitions tab; detail page with Overview, Parties, Priorities, Chair's Office (chair only) and Admin (admin only) tabs. Invite acceptance follows the CEO acceptance pattern (warning banner with Accept and Decline).

### Constants summary

| Constant | Value | Source |
| --- | --- | --- |
| Org baseline (Unaffiliated stake) | 100 units | `ORG_BUCKET_BASELINE_UNITS`, `src/lib/constants/partyOrg.ts` |
| Units per Build Org click | 1 | `ORG_BUILD_UNITS_PER_CLICK`, same |
| Org decay grace / rate | 96 turns / 1% of units per turn | `ORG_DECAY_GRACE_TURNS`, `ORG_UNIT_DECAY_RATE`, same |
| Recruitment slots | 2 / 3 / 4 / 6 at org 0 / 30 / 40 / 50 | `RECRUITMENT_SLOT_TIERS`, `src/lib/npp/recruitment.ts` |
| Recruitment cost | 5 NPP AP plus $50,000 (USD) | `src/lib/npp/actionPoints.ts` |
| NPP AP pool cap / regen | National 160 / 16 (Major), 80 / 8 (Minor); State 40 / 4, 20 / 3 | `src/lib/npp/actionPoints.ts` |
| Recruitment cooldown | 24 turns | `src/lib/npp/recruitmentCooldown.ts` |
| Purge enabled | false | `PARTY_PURGE_ENABLED`, `src/lib/constants/partyActions.ts` |
| Purge cooldown / rejoin cooldown | 48 / 24 turns | same |
| Purge infamy | base 25, x1.5 per successive purge, max 100 | same |
| Party switch delay | 24 hours | `PARTY_SWITCH_COOLDOWN_MS`, `src/lib/parties/antiAbuseGuards.ts` |
| Max tax rate | 33% | `MAX_TAX_RATE`, `src/lib/utils/fundGeneration.ts` |
| Leadership election length | 72 turns; founding 12; custom 168 to 420 | `src/lib/nationalPartyElectionConstants.ts` |
| Primary and general windows | table in Primary system | `src/lib/constants/electionDurations.ts` |
| Party influence pool / max bonus | 3x members / 6 per turn | `src/lib/turn/partyInfluenceTurn.ts` |
| Coalition creation | 25 actions | `src/app/api/country/[code]/coalitions/route.ts` |
| Coalition priorities | max 3 active | `src/lib/coalitions/priorities.ts` |
| Coalition disband vote | 24 hours | `DISBAND_VOTE_DURATION_HOURS`, `src/app/api/country/[code]/coalitions/[id]/disband/start/route.ts` |

## Data

| Collection | Fields read or written | Player visible |
| --- | --- | --- |
| `politicalParties` | `sequentialId`, `countryId`, `name`, `abbreviation`, `chairId`, `viceChairId`, `treasurerId`, `committeeIds`, `coalitionId`, `membershipMode`, `pendingJoinRequests`, `regimeStatus`, `nppActionPoints`, `nppRecruitmentCooldownUntil`, `lastPurgeAtTurn`, `purgeCount`, tier and earned-region fields | Yes, except counters and cooldown stamps |
| `statePartyOrg` | `organization`, `organizationUnits`, `lastOrganizationBuildTurn`, `nppActionPoints`, `nppRecruitmentCooldownUntil`, `nppRecruitmentCooldownUntilTurn` | Org percentage yes; units and stamps no |
| `characters` | `party`, `partyInfluence`, `partyJoinedAt`, `partyJoinedTurn`, `lastPartySwitchAt`, `freePartyMoveUsedAt`, `foundedPartyId`, `purgeRejoinBlocks`, `infamy`, `actions`, `actionGrantLog` | Party and influence yes |
| `electedOfficials` | `party` rewritten on join, leave and purge | Yes |
| `coalitions` | embedded `members`, `pendingInvites`, `joinRequests`, `disbandVote`; priorities | Yes |
| `states` | read for population tier, GDP and region counts | Yes |
| `gameState` | `freePartyMovesOpen`, `currentTurn` | No |
| `gameConfig` | `partyInfluenceDecayRate`, `partyInfluenceBaseRate`, `partyInfluenceMaxPenalty`, `partyInfluencePoolMultiplier`, `partyInfluenceMaxBonus`, `firstJoinerBecomesPartyChair` | No |
| `treasuryTransactions` | written on tax, transfer and NPP spending | Treasurers and chairs |

Also: `coalitionId` on `PoliticalParty` for quick lookups, per-country sequential IDs for URLs (`/parties/coalition/3?country=uk`), and 10 notification types for coalition events.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `partyInfluenceBaseRate` / `partyInfluenceDecayRate` / `partyInfluenceMaxPenalty` | 3 / 0.04 / 4 | `src/lib/turn/partyInfluenceTurn.ts` fallbacks; override in `gameConfig` (`src/lib/db/types/gameConfig.ts`) |
| `partyInfluencePoolMultiplier` / `partyInfluenceMaxBonus` | 3 / 6 (the code takes the maximum of the config value and the default, so config cannot lower them) | same |
| `firstJoinerBecomesPartyChair` | on unless explicitly false | `gameConfig`, read in the join route |
| `gameState.freePartyMovesOpen` | off | admin flag, read by `isFreePartyMoveWindowOpen` |
| `membershipMode` | open; `"approval"` files a request | per party |
| `partyCreationNPPs` | per country, see table | `src/lib/countries/<id>/institutionsFacts.ts` |
| `PARTY_PURGE_ENABLED` | false | `src/lib/constants/partyActions.ts` |
| National election duration | 72 turns, custom 168 to 420 | per national party, bounds in `nationalPartyElectionConstants.ts` |
| Era price level, GDP baseline | 1 and per-country-era baseline | `fundGeneration.ts`, `src/lib/campaigns/rules/gdpBaseline.ts` |
| Major party ids | per country | `majorPartyIds` in country configs (UK: LAB and CON; DE: SPD and CDU; US: Democrat and Republican) |

## Timing

Party work runs in these turn phases, in order (`src/simulation/phases/turnPhaseNames.ts`):

```
actionRefresh
fundGeneration            (income and taxes)
partyInfluenceTurn        (influence gain, decay, bonus actions)
caucusTax
nppFundGeneration
turnoutDecay
partyGOTV
partyOrgTurn              (organization decay and build resolution)
supportDecay, supportAccrual
partyTierTurn             (Major or Minor tier, after partyOrgTurn)
statePartyElections
nationalPartyElections
nationalCommitteeElections
partyActionGeneration     (NPP AP refill, after partyTierTurn)
expireCharters
emptyPartyCleanup
coalitionDisbandVotes
nppRelationshipMaintenance
...
nppBehavior               (later in the same turn)
primaryResolution         (before electionResolution)
electionResolution
```

Tier must run after `partyOrgTurn` and before `partyActionGeneration`, which generates Political Strength up to the tier-derived cap. Party influence accrues after the action refresh, so bonus actions land on top of the refreshed pool. Player endorsements, joins and leaves are request-time writes between turns.

## Worked trace

**Income.** A House member in a medium state (population 5,000,000; GDP scalar 1.0), donor base level 40, state influence 50, state tax 10%, national tax 5%.

1. Base: medium tier, $10,000.
2. Donor bonus: `200 * 40 = 8,000`, times `1 + 50/100 = 1.5` gives $12,000.
3. Office: House, $5,000.
4. Total: `10,000 + 12,000 + 5,000 = 27,000`.
5. State tax `floor(27,000 * 0.10) = 2,700`; national tax `floor(27,000 * 0.05) = 1,350`.
6. The character receives `27,000 - 2,700 - 1,350 = 22,950`. A 40% state tax would pay 0 tax, not 40%.

**Organization.** Region with party A at 30 units and party B at 10 units. Denominator `100 + 40 = 140`; A is `30 / 140 = 21.4286%`. A Build Org click makes A 31 units, denominator 141, A `21.9858%` (delta `+0.5572`), B drops from `7.1429%` to `7.0922%`. If A then goes 96 turns with no build, its units shrink by 1% a turn: after one decay turn `31 * 0.99 = 30.69`.

**Party influence.** Member at (1, 1), party at (2, -1), current influence 40, no leadership role, infamy 0, party of 4 players, total influence 100.

1. Distance `sqrt(1 + 4) = 2.2361`; closeness `1 - 2.2361 / 14.1421 = 0.8419`.
2. Gain `3 * 0.8419 + 0 - 0 = 2.5257`.
3. New influence `40 * 0.96 + 2.5257 = 40.93`.
4. Pool `3 * 4 = 12`; raw share `40 / 100 * 12 = 4.8`; `floor(4.8 * 0.8419) = floor(4.04) = 4` bonus actions, under the cap of 6.
5. With infamy 50 the penalty is `4 * ln(51) / ln(301) = 2.756`, so the gain would be `-0.23` and new influence 38.17.

**Recruitment.** A USD state party at 45% org holds 3 NPPs. Slots: 4 (40 to 49% tier), available `4 - 3 = 1`. Recruiting spends 5 AP and $50,000 from the state pool and treasury, and sets the cooldown to `currentTurn + 24`. A national pool at Major tier with 150 AP refills `min(160, 150 + 16) = 160`. Party-wide capacity for 7 active members is `5*5 + 2*4 = 33`, clamped to a ceiling of `max(25, 6 x regions)`: a 4 region country caps at 25, a 50 region country at 300 (33 stays).

## Edge cases and limits

- Independents pay no taxes and have no party influence.
- Leaving or switching party sets party influence to 0. Switching starts the 24 hour delay; leaving to be independent does not restart it but does not clear an existing one.
- Tax rates above 33% pay nothing rather than being clamped.
- Org presence is required to build: with no player or elected official in the region, `orgBuildingPercent` resets to 0.
- Recruitment slots count current party NPPs in the state. A region that falls below a tier keeps its NPPs but cannot recruit until it is under the cap again.
- Recruitment into a region outside the growth frontier is refused. Joining a party outside the frontier is refused for non-admins.
- Purge is switched off in the live release, so the purge rules are dormant.
- A coalition cannot hold the same party twice, and one party can only be in one coalition. Only one pending join request per chair across all coalitions.
- Tied leadership elections go to the earliest declaration.
- In a one-party state a new party starts banned and the ruling party always counts as Major; see [one-party-states-as-shipped.md](./one-party-states-as-shipped.md).
- Empty custom parties are deleted by `emptyPartyCleanup` unless they hold a ratified charter.
- Party influence has no upper clamp in `computeNewInfluence`; the steady state for a perfectly aligned member with no role is `3 / 0.04 = 75`, and a National Chair at `(3 + 5) / 0.04 = 200` before infamy.

## Invariants

- Organization shares plus the Unaffiliated stake sum to 100% of the denominator: structural in `deriveOrganizationShares`, covered by `src/lib/parties/rules/organizationBucket.test.ts`.
- The Unaffiliated stake never decays and is always in the denominator: structural, same test.
- Taxes never exceed the generated total: `calculateTaxAmount` returns 0 above 33%, and two rates of at most 33% each leave the character at least 34% of the total; covered by `src/lib/utils/fundGeneration.test.ts`.
- Party NPP Action Points never exceed the pool cap: `computeNppActionPointGain` clamps, covered by `src/lib/npp/actionPoints.test.ts`.
- A member's bonus actions never exceed `maxBonus` and never push actions past the Energy cap: enforced in `partyInfluenceTurn.ts` and tested in `partyInfluenceTurn.test.ts`.
- A character belongs to at most one party and a party to at most one coalition: enforced by the join routes and coalition routes; there is no database-level uniqueness constraint, so a data repair is the recovery.
- The sum of a coalition disband tally uses total member count as the denominator: not covered by a dedicated test beyond the route tests.

## Failure and recovery

- **Stale party id on org rows** after the sequential id migration: org records reference outdated identifiers and Build Org or tier computation misreads them. Repaired by the stale party id healing pass.
- **Orphaned leadership:** a chair or vice chair who left the party keeps a leadership seat. `vacateDepartedLeadership` clears it; if it missed one, a data repair clears the seat and the next leadership election fills it.
- **Member count drift:** `recomputePartyMemberCount` recomputes the cached count; rerun after bulk membership repairs.
- **Coalition chair not matching the party chair:** repaired by `syncCoalitionChair`; a coalition left with zero members is deleted.
- **Stuck join:** a character blocked by the switch delay or an expulsion block can only be freed by an admin override (admins bypass the delay and frontier check) or by the free party move window.
- **Recruitment cooldown stuck:** legacy rows with only the `Date` cooldown and no turn field are read through the date fallback; a heal can backfill the turn field.
- **Wrong treasury or tax after a bad transfer:** repaired by compensating treasury transactions, not by editing balances directly.
- **Period of missing org presence:** units decay silently; recovery is rebuilding presence and then Build Org.

## Connections

**Driven by:**

- [Elections](./elections.md): primary windows and results change party standing.
- [NPP system](./npp-system.md): NPP stats feed recruitment, whips and slate.
- [Party building](./party-building.md): org units determine recruitment slots.

**Affects:**

- [Party influence](./party-influence.md): party actions on NPPs.
- [Coalitions](./coalitions.md): chair-level alliances.
- [Caucuses](./caucuses.md): sub-party groups sharing treasury and whip.
- [Parliamentary government](./parliamentary-government.md): seat counts per party decide who forms a government.

**Related:**

- [Coalitions](./coalitions.md): full coalition system documentation (formation, priorities, invites, disband votes, chair mechanics).
- [Getting Started](./getting-started.md): party membership overview for new players.
- [Elections](./elections.md): how party affiliation affects primaries and generals.
- [Core Systems](./core-systems.md): turn processing, party elections phase.

## Tests

- Funds: `src/lib/utils/fundGeneration.test.ts`, `fundGeneration.era.test.ts`, `fundGeneration.projection.test.ts`.
- Organization: `src/lib/parties/rules/organizationBucket.test.ts`, `src/lib/parties/partyTier.test.ts`.
- NPP recruitment: `src/lib/npp/recruitment.test.ts`, `actionPoints.test.ts`, `partyCapacity.test.ts`, `recruitmentCooldown.test.ts`, `recruitmentScope.test.ts`, `src/lib/parties/partyFrontier.test.ts`.
- Membership guards: `src/lib/parties/antiAbuseGuards.test.ts`.
- Influence: `src/lib/turn/partyInfluenceTurn.test.ts`; capital actions: `src/lib/capital/actions.test.ts`.
- Leadership elections: `src/lib/nationalPartyElections.test.ts`, `src/lib/statePartyElections.test.ts`; durations: `src/lib/constants/electionDurations.test.ts`.
- Purge: `src/app/api/country/[code]/parties/[id]/purge/route.test.ts`.
- Coalitions: `src/app/api/country/[code]/coalitions/route.test.ts`, `src/lib/coalitions/priorities.test.ts`, `syncCoalitionChair.test.ts`, `absorbParty.test.ts`.

Gaps: no test pins the leader election tie-break rule or the disband vote majority in one place; the join route's free-party-move path and the expulsion block have no end-to-end test; the Speaker flow is covered by its own page rather than here.

## Known issues and history

- Purge infamy escalation never takes effect: the route resets `purgeCount` to 0 whenever 48 turns have passed since the last purge, and the purge cooldown is also 48 turns, so any purge that is allowed after the first sees a count of 0 and pays the base 25. Dormant while `PARTY_PURGE_ENABLED` is false.
- Party influence is described as a 0 to 100 score, but `computeNewInfluence` applies no upper clamp, so leaders can exceed 100.
- Earlier text on this page said party switching has no cooldown and carries favorability and Political Influence penalties. The code applies a 24 hour switch delay and resets party influence to 0; no favorability or Political Influence penalty is applied in the join or leave paths.
- Earlier text gave primary phases of 48, 240 and 144 turns; the code windows are 72 (House), 264 (Senate) and 168 (Governor, State Senate, President), with totals unchanged at 96, 288 and 192.
- The player whip allows one attempt per chamber, not two; only NPP bill whips allow two.
- The recruitment treasury cost and Action Point costs moved from the scarcity table to flat per-currency costs; `calculateRecruitmentCost` is retained for relocation pricing only.
- The older NPP Speaker-voting design is no longer the intended format; NPPs do not vote in US leadership elections.

Last checked: 2026-10-29, version 1.18.0
