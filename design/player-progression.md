# Player Progression

## Character Creation

When a player first joins the game:

1. **Choose Country**: US or UK
2. **Create Character**: Choose name and avatar
3. **Select Starting State / Region**:
   - US: Pick any of the 50 states (affects PI, fund generation base, election eligibility)
   - UK: Pick ENG, SCO, WAL, or NIR (determines Commons election eligibility)
4. **Set Policy Positions**: Choose economic and social positions (−5 to +5 scale)
5. **Initial Resources**:
   - **Actions**: 25 initial bonus actions
   - **Campaign Funds**: $250,000 starting funds
   - **Cash on Hand**: $0
   - **Political Influence**: 0
   - **National Influence**: 0
   - **Favorability**: 50 (neutral)
   - **Infamy**: 0
   - **Donor Base Level**: 0
   - **Party Influence**: 0
6. **Starting Status**: Independent (not in a party), not in office
7. **Account Limit**: One character per account

## Changing Home State

- **Allowed**: Yes
- **Penalty**: Lose all Political Influence (in all states)
- **Use Case**: Strategic repositioning to a different political landscape

---

## US Career Path

### Phase 1: Build Foundation

- Players start as independents with no office
- Build stats: Political Influence, Favorability, Donor Base
- Raise funds through Fundraising and per-turn fund generation
- Can campaign, fundraise, build donor base, run ads, commission polls
- Can Support/Attack other politicians (raise or lower their Favorability)
- Can Barnstorm for allies (5 actions + $100k to boost their Political Influence)
- Can boost/influence NPPs from their profile pages
- **Cannot** write bills or vote on legislation

### Phase 2: Join Party

- Join a default or custom party, or remain independent and use the independent primary path
- Party membership starts building **Party Influence** - the higher your party influence relative to other members, the more bonus actions you receive each turn from the party pool
- Policy alignment to the party platform amplifies how efficiently your party influence converts to bonus actions
- Can switch parties later (with stat penalties: Favorability and PI drop)

### Phase 3: Primary Election

- Declare candidacy during primary phase (before `primaryEndTime`)
- Primary resolution uses **primary score** (alignment to party position + favorability + influence)
  - State races (House, Senate, Governor, State Senate): uses **Political Influence (PI)**
  - Presidential race: uses **National Political Influence (NPI)**
- Highest primary score per party advances to the general
- See [Election Mechanics](./elections.md)

### Phase 4: General Election

- Compete against other party nominees
- Vote accumulation each turn; the final 4 turns receive 30% of the vote pool
- Sustained campaigning matters; policy alignment and Favorability affect votes
- **State races**: Political Influence (PI) drives reach and appeal
- **Presidential race**: NPI drives reach and appeal - uncapped, logarithmic scaling rewards long-term accumulation
- Winner takes office

#### Presidential Candidate: Travel

During a presidential **general election**, active candidates can **Travel** to any US state. The cost is based on the state's electoral-vote tier: 3, 5, 7, or 10 actions. While traveling:

- You earn **+1% Favorability per turn** passively (no action needed)
- Your travel state appears as a badge on the electoral map and candidate row, signaling your focus to opponents
- Switching states pays the destination state's current travel cost
- Strategic travel compensates for lower NPI in swing states

### Phase 5: In Office

- Gain bonus actions per turn (tiered by office)
- Can write bills (if in Congress)
- Can vote on legislation (if in Congress)
- Voting shifts policy positions (±0.25 per vote in direction of bill)
- Per-turn fund generation includes office bonus
- Face re-election at end of term

### Phase 6: Re-Election / Advancement

- Run for re-election in same office
- Or seek higher office (House → Senate → Governor → President)
- Only one office at a time
- **Note**: Moving toward a presidential run shifts the key influence stat from PI to NPI. NPI accrues passively every turn (+state PI ÷ 100), so maintaining high state influence early accelerates NPI growth

---

## UK Career Path

### Phase 1: Build Foundation (same as US)

- Build PI, Favorability, Donor Base; join a party before running

### Phase 2: Commons Election

- UK players run in **regional Commons elections** for England, Scotland, Wales, or Northern Ireland
- Multi-seat proportional allocation - more than one candidate per party can win seats in the same region
- Candidacy limited to your home region

### Phase 3: Hold an MP Seat

- **MPs**: Vote on UK legislation passing through Parliament
- Fund generation and action bonuses work the same as US offices
- Face re-election each Commons cycle (perpetual scheduling)

### Phase 4: Prime Minister

- After each Commons cycle resolves, seat totals are summed nationally by party
- The **largest-party leader** is nominated as Prime Minister candidate
- A **confidence vote** among all MPs determines whether they're confirmed
- Confirmed PMs gain the highest action bonus and fund generation in the game
- **No-confidence motions**: MPs from the ruling block can trigger a vote to remove the sitting PM; if it passes, a new confidence process begins
- Use the UK Government hub at `/executive/uk` for seat totals, government status, and confidence votes

---

## Office Benefits

### Action Bonus (per turn)

| Office         | Bonus | Total (Base 4) |
| -------------- | ----- | -------------- |
| House          | +1    | 5              |
| State Senate   | +1    | 5              |
| Senate         | +2    | 6              |
| Vice President | +2    | 6              |
| Governor       | +2    | 6              |
| President      | +4    | 8              |

The base is at least 4 per turn (`MIN_BASE_ACTIONS_PER_TURN` in `src/lib/turn/actionRefresh.ts`); office bonuses come from `src/lib/countries/us/institutionsFacts.ts`.

### Fund Generation Bonus (per turn)

| Office         | Bonus    |
| -------------- | -------- |
| House          | +$5,000  |
| State Senate   | +$3,000  |
| Senate         | +$15,000 |
| Vice President | +$25,000 |
| Governor       | +$15,000 |
| President      | +$50,000 |

Base rate + donor bonus also apply. See `src/lib/utils/fundGeneration.ts`.

### Vice President

- **Selection**: Running mate chosen by the Presidential candidate
- **Powers**: Breaks tie votes in the Senate
- **Action Bonus**: +2 per turn

### Legislative Powers

- **House Members**: Can write bills and vote on House legislation
- **Senators**: Can write bills and vote on Senate legislation
- **Vice President**: Breaks tie votes in Senate
- **Governors**: Can appoint players to vacant Senate seats in their state
- **President**: Sign or veto bills passed by Congress

---

## Party Influence Over Time

Party Influence accrues passively each turn you're a member and accumulates relative to other party members. It translates to **bonus actions per turn** from the shared party pool:

- Members with high party influence extract more bonus actions each turn
- Policy closeness to the party's platform amplifies efficiency
- Staying active and invested in party operations keeps your standing high
- Leaving and rejoining a party resets your Party Influence to 0

Party Influence is visible on your profile (Party Standing section) and in the party members table. See [Political Parties](./parties.md) for the full calculation.

---

## Out of Office Activities

When not holding office, players can:

- Campaign (any state, with cost multipliers for out-of-state)
- Run Ads
- Fundraise
- Build Donor Base
- Commission polls (Quick, Full Demographic)
- Support or Attack other politicians (Favorability changes)
- Barnstorm for allies (+PI, 5 actions + $100k)
- Influence NPPs (Endorse, Withdraw, Oppose, Support Leadership)
- Send Wire Transfers (Cash on Hand) from Portfolio

**Cannot**:

- Write bills
- Vote on legislation
- Use office-specific powers (Travel is presidential-candidates-only during general)

---

## Stat Progression Summary

| Stat                | Starting   | How to Increase                               | Notes                                            |
| ------------------- | ---------- | --------------------------------------------- | ------------------------------------------------ |
| Political Influence | 0          | Campaign (+1%)                                | 0-100, decays each turn                          |
| National Influence  | 0          | +state PI/100 per turn                        | Uncapped; logarithmic scaling in president races |
| Favorability        | 50         | Ads, Campaign, Travel (+1%/turn while active) | 0-100, drained by Infamy >20%, attacks           |
| Infamy              | 0          | Attack or NPP lower actions                   | 0-100, decays 5%/turn                            |
| Campaign Funds      | $250k      | Fundraise, fund gen, donor base               | Spent on campaign actions                        |
| Cash on Hand        | $0         | Personal campaign donations (50%)             | Wire transfers only                              |
| Donor Base Level    | 0          | Build Donor Network                           | $50k + $25k×level per level                      |
| Actions             | 25 initial | +3 base + office bonus + party bonus per turn | Cap 200; hoarding penalty above 100              |
| Party Influence     | 0          | Passive accrual while party member            | 0-100; drives bonus action share per turn        |

---

## Related Documentation

- [Stats & Actions](./stats-actions.md) - Action costs, effects, full tables
- [Election Mechanics](./elections.md) - Primary scores, vote accumulation, FPTP vs proportional
- [Political Parties](./parties.md) - Party influence, leadership, action pool
- [NPP System](./npp-system.md) - NPP influence and boost
- [United Kingdom](./united-kingdom.md) - UK-specific rules: Commons, PM formation, confidence votes
