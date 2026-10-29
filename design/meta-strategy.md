# Meta Strategy

Advanced multi-player tactics for experienced players. This guide covers political alliances, party coordination, and strategic maneuvering beyond individual races.

## The Political Landscape

A House Divided is ultimately a multiplayer game. While NPPs fill most offices, player-vs-player competition is where the real strategy lives.

## Alliance Building

### Within Your Party

- **Coordinate primaries** - Avoid splitting the player vote against NPPs
- **Trade endorsements** - Support each other's candidates in different states
- **Share intelligence** - Party members see campaign levels via party intelligence
- **Pool party resources** - Treasury transfers to support competitive races

### Cross-Party Deals

- **Legislative trades** - Vote for their bill in exchange for support on yours
- **Non-aggression pacts** - Avoid opposing each other's candidates in certain states
- **Cabinet nominations** - Trade Senate confirmation votes for policy concessions

## Party Control Strategy

### Taking Over a Party

1. Win state party chair in your home state
2. Use NPP influence to shape your state's delegation
3. Build allies in other states
4. Coordinate for national party chair
5. Control party tax rates and treasury allocation

### Building a Third Party

- Custom parties build organization from scratch; it is tracked in units against a fixed unaffiliated baseline (`src/lib/constants/partyOrg.ts`)
- Requires dedicated members to build org from scratch
- Advantage: No internal competition; you shape the party platform
- Disadvantage: Low org means fewer votes until you build up

## Congressional Power

### Speaker of the House

- Most powerful legislative position
- Requires majority party membership
- Plurality election - build a coalition within your party
- NPPs vote for the candidate closest to their policy positions

### Senate Leadership

- Pro Tempore, Majority/Minority Leaders
- Control legislative agenda and floor votes
- Senate leadership elections are within-party

### Legislative Coalition Building

- Count votes before proposing bills
- NPPs vote based on ideology - predict their behavior
- Use committee positions strategically

## Presidential Strategy

### The Electoral Map

- Focus on swing states: AZ, GA, MI, NH, NV, PA, WI (~81 EVs)
- Safe states (Left ~222 EVs, Right ~235 EVs) are decided by lean
- Win swing states through superior party org and campaign activity

### Primary vs General Pivot

- Win your party's primary with strong base support
- General election requires broader coalition
- Party org is crucial - build org in swing states before running

### VP Selection

- Choose a VP who complements your weaknesses
- Any character except the current President can be VP
- VP office gives +$25k/hr in fund generation (`src/lib/utils/fundGeneration.ts`)

## Cabinet Nominations

As President:

- Nominate allies to cabinet positions
- Senate must confirm - need majority of voting senators
- Use nominations as political favors to build support
- Can fire cabinet members anytime (no Senate vote needed)

## Advanced Tactics

### Information Warfare

- Campaign pages have tiered access - opponents can't see your full strategy
- Use the fog-of-war mechanic: your campaign details are hidden from non-party members
- Monitor opponents' public stats to gauge their strength

### Timing Attacks

- Enter races at the last moment to deny opponents preparation time
- Surge campaign activity during campaign season for maximum impact
- Time legislation proposals to distract opponents during election season

### Resource Denial

- As party chair, withdraw NPP candidates who would split your vote
- Use oppose-candidate influence to weaken opponent endorsements
- Fundraise aggressively in contested states to outspend opponents

## The Long Game

Political power in A House Divided compounds:

- Office income funds future campaigns
- Party org built today helps elections next cycle
- Allies cultivated now become coalition partners later
- Institutional positions (Speaker, party chair) give outsized influence

## Related Pages

- [Congress Leadership](./congress-leadership.md) - Legislative power structure
- [Campaign Manager](./campaign-manager.md) - Campaign management tools
- [Party Building](./party-building.md) - Growing party strength
- [Min-Maxing Guide](./min-maxing.md) - Individual optimization
- [Cabinet](./cabinet.md) - Presidential nominations
