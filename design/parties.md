# Parties

## Party System

### Current Implementation

- **Multi-Party System**: Democrat, Republican, and custom third parties are supported
- **Default Status**: Players are **Independent by default**. Independents use the independent-primary route where that race supports it; party members enter their party's primary.
- **Party Formation**: Players can create custom parties; new parties start with the base organization cap (15) in all states, which grows based on election performance

## Party Membership

### Joining a Party

- **Timing**: Anytime before running for office
- **Requirement**: Party membership is required for a named party's primary, not for the independent-primary route
- **Default**: Independent

### Switching Parties

- **Allowed**: Yes
- **Penalty**:
  - Favorability drop
  - Political Influence drop
- **No Cooldown**: Can switch anytime (but penalties apply)

### Party Affiliation Effects

- Primary eligibility (can only run in your party's primary)
- General election ballot line
- Voter perception (party loyalty demographics)
- Endorsement opportunities

## Endorsements

### NPP Endorsements

- Players can influence NPPs to **endorse candidates** via the NPP Influence system (see [NPP System](./npp-system.md))
- **Effect**: NPP publicly endorses a candidate in an election; boosts that candidate's appeal
- **Cost**: 6 actions on the NPP profile (Request Endorsement, `src/lib/capital/actions.ts`); the party-level endorse action costs 3 (see [party-influence.md](./party-influence.md))

### Player-to-Player Endorsements

- **Status**: Implemented for active presidential elections
- **Eligibility**: A human-controlled character may endorse another active candidate in the same country's presidential election. Candidates cannot endorse themselves, and a suspended presidential candidate cannot issue an endorsement.
- **One active endorsement**: Posting a new endorsement replaces the character's previous endorsement in that election. It can also be withdrawn.
- **Effect**: Endorsing a player candidate applies a one-time Support bump. Replacing or withdrawing the endorsement reverses the prior bump. NPP candidates can be endorsed, but do not receive that character Support adjustment.

## Primary System

### Party Nomination

- Primary elections select party nominee
- Only one candidate per party per office advances
- Resolution uses **primary score** (alignment to party position + favorability + influence), not vote accumulation
- Winner becomes party nominee for general election

### Primary Timeline

- Duration varies by race type (see [Election Mechanics](./elections.md))
- **US House**: 48h primary / 96h total
- **US Senate**: 240h primary / 288h total
- **US Governor and State Senate**: 144h primary / 192h total
- **US President**: 144h primary / 192h total
- **Most parliamentary races**: 24h primary / 48h total. Japan's regular Shūgiin and Sangiin races use longer country-specific windows.

These are active-election windows. The gap between regular elections is controlled separately by each office's turn cycle.

### Primary Rules

- **Uncontested**: Single candidate wins automatically
- **No Entrants**: Party has no nominee for that race
- **Multiple Candidates**: Highest primary score per party advances

## Party Dynamics

### Intra-Party Competition

- Players compete within party for nominations
- Primary elections determine party candidates
- Party unity vs. personal ambition

### Inter-Party Competition

- Parties compete in general elections
- Bipartisan cooperation possible on legislation
- Party loyalty vs. cross-party coalitions

## Fund Generation & Party Taxes

Each turn, characters receive funds from:

- **Base rate**: By state population tier (small <2M: $5k/hr, medium: $10k, large: $20k, mega >20M: $40k)
- **Donor base bonus**: +$500-$4,000/hr per level (scaled by state tier)
- **Office bonus**: House +$5k, State Senate +$3k, Senate +$15k, Governor +$15k, VP +$25k, President +$50k

**Party members** pay taxes (0-33% each):

- **State tax** → state party treasury (set by State Chair)
- **National tax** → national party treasury (set by National Chair)
- Independents pay no taxes

**Treasury**: National and state parties both have treasury controls. Treasurers own the planning layer (reserve targets, dashboard, and budget posture), while Chairs and Vice Chairs retain emergency access to move funds and adjust spending when needed.

## Party Organization

### Organization Shares

Each state or region party has an organization percentage (0-100) that affects electoral performance. It is derived from contribution units, not a cap (`src/lib/parties/rules/organizationBucket.ts`, `src/lib/constants/partyOrg.ts`):

- Every region starts with a permanent 100-unit Unaffiliated stake (`ORG_BUCKET_BASELINE_UNITS`) that never decays and is always counted in the denominator.
- A successful Build Org action deposits one unit (`ORG_BUILD_UNITS_PER_CLICK`) for the acting party.
- A party's organization is its units divided by the Unaffiliated stake plus all parties' units, as a percentage.

### Presence Requirement

Organization building requires **party presence** in the state:

- At least one player character in the party in that state, OR
- At least one elected official (player or NPP) from the party in that state

When presence is lost:

- `orgBuildingPercent` resets to 0
- Org building cannot add units
- Organization decays toward 0

### UK Commons Support

The party organization system extends to UK House of Commons constituencies. UK parties have state party org records for each UK region (England, Scotland, Wales, Northern Ireland, London). The same organization mechanics apply. Stale party ID healing automatically fixes org records that reference outdated party identifiers after the sequential ID migration.

## NPP Recruitment

Third parties can recruit NPP candidates to build their political bench through two mechanisms.

### Party Creation Spawn

When a player creates a new custom party, NPPs are automatically spawned across selected states:

| Country | States Selected | Home State | NPPs per State | Total NPPs |
| ------- | --------------- | ---------- | -------------- | ---------- |
| US      | 4 + home locked | Locked     | 2              | 10         |
| UK      | 2               | Not locked | 1              | 2          |

The party creation modal shows alignment indicators for each state (good/neutral/poor fit) based on how the party's positions match the state's political lean.

### Ongoing Recruitment

Party leadership can recruit additional NPPs through the party Actions tab:

| Role                     | Scope                                  | Resources Used    |
| ------------------------ | -------------------------------------- | ----------------- |
| State Chair / Vice Chair | Their state only                       | State treasury    |
| National Chair / VC      | States without active state leadership | National treasury |

### Recruitment Slots

Per-state maximum slots based on state party organization:

| State Org | Max Slots |
| --------- | --------- |
| 0-29%     | 2         |
| 30-39%    | 3         |
| 40-49%    | 4         |
| 50%+      | 6         |

Tiers are `RECRUITMENT_SLOT_TIERS` in `src/lib/npp/recruitment.ts`.

Available slots = Max slots − Current party NPPs in that state.

### Recruitment Costs

**Base cost by state NPP count:**

| Party NPPs in State | Actions | Funds      |
| ------------------- | ------- | ---------- |
| 0 (first)           | 5       | $100,000   |
| 1                   | 8       | $200,000   |
| 2                   | 12      | $350,000   |
| 3                   | 18      | $600,000   |
| 4+                  | 25      | $1,000,000 |

**Party-wide modifier (applied to base):**

- **Actions**: +1 per 20 total party NPPs (capped at +5)
- **Funds**: +10% per 20 total party NPPs (capped at +100%)

### Cooldown

- **Duration**: 24 turns (24 hours)
- **Scope**: Party-wide (shared between state and national leadership)

After any recruitment, the entire party must wait 24 turns before recruiting again.

## Party Leadership

### Positions

Each state party (and national party) has three elected leadership positions:

- **Chair** - highest authority; controls tax rate adjustments and treasury transfers
- **Vice Chair** - second-in-command; assists with NPP influence operations
- **Treasurer** - view-only treasury access

### Elections

- Leadership elections default to **72 turns (72 hours)** (`NATIONAL_ELECTION_DURATION_TURNS` / `ELECTION_DURATION_TURNS`) and are resolved by the turn system. Founding-phase windows are 12 turns. National parties may set a custom duration of 168-420 turns.
- All state party members may vote in all three elections simultaneously
- A member may only be a candidate for one position at a time
- Ties are broken by earliest declaration time
- New elections are created automatically when a term expires

### Chair Office - Purge Member

The national party Chair can expel a regular member from their party via the **Chair Office** tab.

**Rules:**

- The mechanic is currently switched off (`PARTY_PURGE_ENABLED = false` in `src/lib/constants/partyActions.ts`): chairs cannot expel members and the Chair Office hides the controls.
- Only the national Chair can initiate a purge.
- Leadership roles (Vice Chair, Treasurer) cannot be purged - only regular members.
- **Cost to chair:** base +25 infamy, escalating ×1.5 per successive purge up to 100, minus `floor(target.partyInfluence / 2)` from the chair's own party influence (floored at 0).
- **Effect on target:** `party → "independent"`, `partyInfluence → 0`; existing candidacies and state party positions cleaned up via `withdrawFromMismatchedPrimaries` + `cleanupPartyPositionsOnSwitch`; any `electedOfficials` records for the target are updated to `party: "independent"`; target receives a `party_kicked` notification.
- **Cooldown:** 48 turns per party, tracked via `PoliticalParty.lastPurgeAtTurn`. Constant: `PURGE_COOLDOWN_TURNS` in `src/lib/constants/partyActions.ts`. A purged member must also wait 24 turns (`PURGE_REJOIN_COOLDOWN_TURNS`) before rejoining the party that purged them.

**API:** `POST /api/country/[code]/parties/[id]/purge` - auth: `requireAuthWithCharacter` (chair only); body `{ characterId: string }` (MongoDB ObjectId hex).

## Speaker of the House

The Speaker is elected by the full House of Representatives using a real-life multi-candidacy model:

### Process

1. Any sitting House member (player or NPP) may **declare their own candidacy** at any time.
2. Multiple candidacies can be active simultaneously.
3. Each House member casts **one vote for one candidate**; switching votes is allowed.
4. The first candidate to reach a **simple majority** of all filled House seats wins and is confirmed Speaker.
5. All other active candidacies are marked `failed`.

### NPP Voting

See [NPP System](./npp-system.md) for full documentation. US congressional leadership voting is
currently **player-only** in live NPP behavior.

- NPPs do not autonomously vote in Speaker, House leadership, or Senate
  leadership elections
- leadership pages and player whip tools still exist for player coordination
- the older NPP Speaker-voting design is no longer the intended current format

### API

- `GET /api/congress/speaker` - returns `activeCandidacies[]`, `houseTotal`, `majority`, `isHouseMember`, `hasActiveCandidacy`, `myVoteId`.
- `POST /api/congress/speaker` - actions: `declare`, `withdraw`, `vote`.

## NPP Influence

See [NPP System](./npp-system.md) for full documentation.

### Player Actions

Players can influence individual NPPs through deterministic direct-interaction actions on the NPP's profile page (`/npp/[id]`). Live costs are in `CAPITAL_ACTIONS` (`src/lib/capital/actions.ts`): Request Endorsement 6 AP / $0, Private Meeting 3 AP / $0, Boost/Reduce Favorability 5 AP / $10k, Boost/Reduce Influence 6 AP / $20k. There is no chance roll. Withdrawal, opposition, and leadership-support asks are **party-level** influence actions (3 AP each; see [party-influence.md](./party-influence.md)), not profile actions.

### Party-Level Influence

- **State / Regional Party** (Chair/Vice Chair only) - local `Recruitment` and
  `Management` surfaces for same-party NPPs in that geography
- **National Party** (Chair/Vice Chair only) - broader party-management tools,
  endorsements, withdrawals, and relocation

### Success Calculation

State / regional management now explicitly uses the local four-action subset:

- `Boost Favorability`
- `Boost Political Influence`
- `Strengthen Party Loyalty`
- `Improve Cooperation`

The loyalty / cooperation asks are hidden-roll style discipline requests rather
than guaranteed stat nudges, and state / regional leadership gets a small local
edge on those two asks.

## Whip System

Party leadership can issue whip directives to both players and NPP legislators.
The key intended distinction is that NPP congressional leadership voting is no
longer a live turn-system behavior, so the important NPP whip gameplay is now
bill-facing rather than leadership-facing.

### Access

- **State / Regional Party** (Chair/Vice Chair only) - local NPP whip authority
  in their own geography
- **National Party** (Chair/Vice Chair only) - federal whip authority plus
  whatever local fallback the route supports
- **Caucuses** - caucus-only whip surface for caucus members

### Targets

- **Bills** - the primary active NPP whip target for party NPP legislators
- **Player leadership votes** - still relevant on the player side of the whip
  system

### Mechanics

- Maximum **2 whip attempts** per target / chamber combination
- NPP bill whips now support `Soft` and `Hard`
- state / regional whips take precedence over national whips where both apply

### Compliance

NPP whip behavior is now split:

- `Hard` bill whips -> hidden loyalty / stubbornness success roll; immediate
  vote write on success
- `Soft` bill whips -> advisory pressure only, fed into later autonomous
  cross-pressure voting

The party pages also surface active **Defiance** instead of a permanent
compliance history. If an NPP later comes back into line, that defiance entry
clears.

### API

- `GET /api/parties/[id]/whippable-bills` - federal bills where party has NPP legislators
- `GET /api/parties/[id]/whippable-leadership` - player-facing leadership whip targets
- `GET /api/state/[id]/party/[partyId]/whippable-bills` - state-level bills for state party
- `POST /api/state/[id]/party/[partyId]/whip` - issue whip directive; returns compliance estimate

## Party Influence

Every party member has a **Party Influence** score (0-100) that accrues passively each turn they are an active member. At the start of each turn, the party distributes **bonus actions** to all members proportional to their share of the party's total influence pool.

### How It Works

1. **Total pool** = `partyInfluencePoolMultiplier` × number of player members (configurable; default 3×)
2. **Each member's share** = their `partyInfluence` / total party influence (across all members)
3. **Closeness scalar**: Members whose policy positions (economic, social) are close to the party's official platform extract more value from the same raw influence score - up to a 2× multiplier
4. **Bonus actions** = share × pool × closeness scalar, capped at `partyInfluenceMaxBonus` per turn (default 6)

### What Drives Party Influence

- Passive accrual each turn while actively engaged in party operations
- Maintained by staying active; neglected members see their influence stagnate relative to active members
- Leaving a party resets your Party Influence to 0; rejoining starts fresh

### Visibility

- **Profile page**: Party Standing card shows your current party influence and bonus actions per turn
- **Party members table**: Party influence column visible for all player members
- **Party page header**: Shows total bonus actions granted across all members this turn

### Strategic Implications

- Members ideologically close to the party platform get more out of the same influence score - this rewards picking a party that matches your character's positions
- A single highly active member in a small party can dominate the bonus action allocation; larger parties distribute more evenly
- Party Influence is a long-term investment: switching parties loses all accumulated standing

---

## Party Analytics

National and state / regional party pages now use an `Analytics` tab as an
internal command-center surface.

Current phase-one areas:

- `Org & Growth`
- `Discipline & Compliance`
- `Slate & Race Coverage`
- national pages also surface `Caucus Health`

Analytics is internal-facing rather than public. Non-members only get the
public-facing `Overview` and `Members` views.

## Slate

Party `Slate` is now a real assignment surface rather than a concept-only note.

- national parties can view and manage a map-backed state / region race board
- state / regional parties get the same scoped race board without the national
  map
- same-party NPPs can be Slate-assigned
- state / regional chairs and vice chairs get a small hidden acceptance edge on
  local Slate assignments
- defending incumbents can still auto-file, so Slate can intentionally create a
  same-party primary against an incumbent NPP

## Caucuses

Caucuses are no longer planned-only.

Current intended caucus systems:

- player and NPP membership
- caucus treasury and caucus tax
- caucus whip
- caucus chair elections
- caucus health surfaces
- relationship-driven NPP recruitment and retention

See [Caucuses](./caucuses.md) for the dedicated system doc.

## Coalitions

Cross-party alliances where national party chairs band together under a shared
banner. Coalitions are still lighter than parties, but they are no longer only
organizational.

### Formation

- **Who can create:** National party chairs only (party-level `chairId`)
- **Cost:** 25 actions (no monetary cost)
- **Requirements:** Party must not already be in a coalition
- **Creator chooses:** Name, abbreviation, color, optional logo
- **Result:** Creator's party becomes the first member; creator becomes coalition chair

### Membership

- A party can belong to at most one coalition at a time
- No cap on how many parties a coalition can have
- **Invites:** Coalition chair sends invites to eligible parties (same country, not in a coalition). The invited party's national chair receives a notification and can accept or decline from the coalition page.
- **Join requests:** A non-coalition national chair can request to join a coalition. Only one pending request at a time (across all coalitions). The coalition chair accepts or declines.

### Leadership & Succession

- The coalition chair is always a national party chair of a member party
- If the chair's party leaves, is kicked, or is deleted: chairmanship passes to the member with the earliest `joinedAt` (seniority)
- The chair can voluntarily transfer ownership to another member party's national chair
- When a party's national chair changes (election, admin), the coalition chair auto-syncs if that party is the chair's party

### Disband Vote

- Only the coalition chair can initiate a disband vote
- Runs for exactly 24 real hours, no early resolution
- Each member party chair gets one vote (yes/no); votes can be changed during the window
- Majority threshold: >50% of total members must vote yes (abstentions count as no)
- Resolved by a turn processing phase that checks for expired votes each hour

### Leaving & Kicking

- Any member party chair can leave voluntarily
- Coalition chair can kick any member
- Coalition is deleted when zero members remain (the last party can leave)
- Kicked party's chair receives a notification

### UI

- Nested under the Political Parties page as a Coalitions tab (alongside
  Parties tab)
- Coalition detail page with tabs: Overview, Parties, Priorities, Chair's
  Office (chair only), Admin (admin only)
- Overview shows averaged economic/social positions, leadership list by seniority, active disband vote panel
- Invite acceptance banner follows the CEO acceptance pattern (warning-colored banner with Accept/Decline)

### Data Model

- `coalitions` collection with embedded `members`, `pendingInvites`, `joinRequests`, `disbandVote` arrays
- `coalitionId` field on `PoliticalParty` for quick lookups
- Per-country sequential IDs for URLs (`/parties/coalition/3?country=uk`)
- 10 notification types for coalition events

---

## Ongoing Systems

### Coalition Priorities

Coalition priorities are now live.

- up to `3` active priorities
- policy, bill, or leadership-goal targets
- public or internal visibility
- member-party chair voting
- cohesion summary (`Strong`, `Mixed`, `Fractured`, `Unaligned`)

### Treasury Planning

Party treasury surfaces now include a planning layer rather than just raw send /
transfer controls.

- reserve targets
- preset postures
- state-funding visibility
- override history for party leadership

---

## Related

- [Coalitions](./coalitions.md) - Full coalition system documentation (formation, priorities,
  invites, disband votes, chair mechanics)
- [Getting Started](./getting-started.md) - Party membership overview for new players
- [Elections](./elections.md) - How party affiliation affects primaries and generals
- [Core Systems](./core-systems.md) - Turn processing, party elections phase
