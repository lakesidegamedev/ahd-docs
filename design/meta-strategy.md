# Meta Strategy

## Summary

Advanced multi-player tactics for experienced players: political alliances, party coordination, and strategic maneuvering beyond individual races. This is a strategy guide rather than a single mechanic, so this page ties each tactic to the rule and source file that makes it work, and corrects tactics that the live release no longer supports.

Player guide: [Advanced Strategy](https://www.ahousedividedgame.com/wiki/advanced-strategy) and [Power Player Guide](https://www.ahousedividedgame.com/wiki/power-player-guide)

A House Divided is ultimately a multiplayer game. While NPPs fill most offices, player-vs-player competition is where the real strategy lives.

This guide is written around the US offices. Parliamentary countries (UK, DE, JP and others) differ: the executive comes from the legislature, so coalitions and confidence votes matter more than the offices below. See [Coalitions](./coalitions.md), [Parliamentary Government](./parliamentary-government.md) and [UK Cabinet](./uk-cabinet.md).

[NPP Opponents](./npp-opponents.md) and [Min-Maxing Guide](./min-maxing.md) cover the single-player side of the same decisions.

## Rules

### Alliance building

Within your party:

- **Coordinate primaries.** Avoid splitting the player vote against NPPs. Entering early does not remove NPP challengers; see the NPP entry limits under Edge cases.
- **Trade endorsements.** Support each other's candidates in different states.
- **Share intelligence.** Party members see rivals' campaign levels with less fog than the public: public viewers see a level within plus or minus 3 of the truth, party members within plus or minus 1 (`src/lib/campaigns/fogOfWar.ts`, see [campaign-strategy.md](./campaign-strategy.md)).
- **Pool party resources.** Treasury transfers support competitive races.

Cross-party deals:

- **Legislative trades.** Vote for their bill in exchange for support on yours.
- **Non-aggression pacts.** Avoid opposing each other's candidates in certain states.
- **Cabinet nominations.** Trade Senate confirmation votes for policy concessions.

Nothing in the game enforces a deal. Every trade rests on the players keeping their word.

### Party control strategy

Taking over a party:

1. Win state party chair in your home state (72-turn leadership election, `ELECTION_DURATION_TURNS` in `src/lib/statePartyElections.ts`).
2. Use NPP management to shape your state's delegation: the chair and vice chair can boost favorability, influence, loyalty and cooperation of same-party NPPs in the state, using the state AP pool and treasury ([party-influence.md](./party-influence.md)).
3. Build allies in other states.
4. Coordinate for national party chair (72-turn default election; 168 to 420 turns if the party adopted a custom length, `src/lib/nationalPartyElectionConstants.ts`).
5. Control party tax rates and treasury allocation. The chair, vice chair and treasurer can all set the tax rate, 0 to 33 percent (`src/app/api/country/[code]/parties/[id]/tax/route.ts`, `MAX_TAX_RATE`).

Building a third party:

- Custom parties build organization from scratch; it is tracked in units against a permanent 100-unit Unaffiliated stake in each region (`src/lib/constants/partyOrg.ts`).
- Requires dedicated members to build org from scratch: each Build Org click is one unit, costs PS and cash, and needs a member, official or NPP present in the region ([party-building.md](./party-building.md)).
- Advantage: no internal competition; you shape the party platform.
- Disadvantage: low org means fewer votes until you build up. Org enters the general election vote weight as `share ^ 0.2`, so the first points matter most and a 3 to 1 lead is worth only about 1.25 to 1.
- New custom parties start Minor, with a national PS cap of 100 plus 10 per region held at 20% Org or more (`src/lib/parties/partyTier.ts`).

### Congressional power

Speaker of the House:

- Most powerful legislative position.
- Open to any seated House member of any party: `speaker_of_the_house` uses the `any-seated` policy (`POLICY_BY_ROLE` in `src/lib/congress/leadership/rolePolicy.ts`). Majority party membership is not required.
- Plurality election: the Speaker election runs for 24 hours and the most votes wins (`src/lib/congress/speaker/actions.ts`). Because every party votes, a cross-party deal is a real route to the chair.
- A motion to vacate the chair needs an absolute majority of all seats, `floor(seats / 2) + 1` (`vacateThreshold` in `src/lib/congress/speaker/resolveVacateMotion.ts`). See [Congress Speaker](./congress-speaker.md).
- NPPs do not choose a Speaker on their own. Congressional leadership elections are player-only; NPP votes enter only through a player's party whip (`castLeadershipVote` in `src/lib/turn/npp/leadershipVoting.ts`). On a motion to vacate, NPP blocs that were not whipped get a graded ballot once the voting window closes (`autoVoteNppsForVacateMotion`).

Senate leadership:

- Pro Tempore, Majority and Minority Leaders and Whips.
- Control legislative agenda and floor votes.
- Elections are party-gated 24-hour plurality races: Pro Tempore, Majority Leader and Majority Whip belong to the largest single party, Minority Leader and Whip to non-coalition members (`largest-single-party` and `non-coalition` in `rolePolicy.ts`). See [Congress Leadership](./congress-leadership.md).

Legislative coalition building:

- Count votes before proposing bills.
- NPPs vote based on ideology, whip pressure and local factors; predict their behavior ([npp-system.md](./npp-system.md)).
- Use committee positions strategically.

### Presidential strategy

The electoral map:

- Focus on the close states. Which states are close depends on the era preset and current lean (see the Lean map overlay in [Map Services](./map-services.md)); electoral votes follow the live apportionment, not a fixed table, so check the map rather than a memorised list.
- Safe states are decided by lean.
- Win swing states through superior party org and campaign activity.

Primary versus general pivot:

- Win your party's primary with strong base support.
- General election requires a broader coalition.
- Party org is crucial: build org in swing states before running. Inside a party's primary every candidate shares the same org, so org only pays off in the general.

VP selection:

- Choose a VP who complements your weaknesses.
- Only countries that define a vice-presidential office elect on a ticket (US, Brazil and Nigeria; `src/lib/elections/runningMateEligibility.ts`).
- The Vice President office gives +25,000 per turn in fund generation, against 50,000 for the President and 5,000 for a House member (`OFFICE_FUND_BONUS` in `src/lib/utils/fundGeneration.ts`).

### Cabinet nominations

As President:

- Nominate allies to cabinet positions.
- Senate must confirm with a simple majority of votes cast (`votesFor > votesAgainst`), except the White House Chief of Staff, who needs no vote. Vice President nominations need a majority in both chambers (see [Cabinet](./cabinet.md)).
- Use nominations as political favors to build support.
- Can fire cabinet members anytime (no Senate vote needed). A change of government dismisses the whole cabinet.

### Advanced tactics

Information warfare:

- Campaign pages have tiered access: opponents cannot see your exact upgrade levels, only a fogged estimate (public plus or minus 3, party plus or minus 1).
- Monitor opponents' public stats to gauge their strength.

Timing attacks:

- Enter races at the last moment to deny opponents preparation time. Entry is only possible while the primary window is open.
- Surge campaign activity in the closing turns. In the final 4 turns before an election closes, campaign passives (media, opposition research, travel) are doubled (`seasonMultiplier` in `src/lib/turn/campaignTurn.ts`) and canvassing is doubled (`checkActiveCampaignSeason` in `src/app/api/canvassing/route.ts`).
- Time legislation proposals to distract opponents during election season.

Resource denial:

- As party chair, keep NPP candidates from splitting your vote by slating them into a different race in the same state: a compliant NPP is withdrawn from its old race and filed into the new one ([party-slate.md](./party-slate.md)).
- A national chair can also relocate an NPP to another state; the move withdraws it from every open candidacy and resigns its office ([party-influence.md](./party-influence.md)).
- Fundraise aggressively in contested states to outspend opponents.
- The old "oppose candidate", "request withdrawal" and "request endorsement" party influence actions are no longer offered to party leaders. Endorsements come from the request flow on an NPP profile ([npp-system.md](./npp-system.md)).

### The long game

Political power compounds:

- Office income funds future campaigns.
- Party org built today helps elections next cycle, but decays 1% per turn after 96 idle turns.
- Allies cultivated now become coalition partners later.
- Institutional positions (Speaker, party chair) give outsized influence.

## Data

This page does not own any state. The tactics read the following, owned by other pages.

| Tactic | Collections and fields | Player-visible |
| --- | --- | --- |
| Party takeover | `statePartyElections`, `nationalPartyElections` rows and chair, vice chair and treasurer ids on `statePartyOrg` and `politicalParties` | yes |
| Third party and org | `statePartyOrg.organization`, `organizationUnits`, `lastOrganizationBuildTurn`; `orgRegLedger` | percent yes, units to officers |
| Speaker and vacate | `speakerVacateMotions` (`_id: "current"`, `status`, `votes`), leadership nominations | yes |
| Cabinet | cabinet nominations and `cabinetMembers` | yes |
| Fog of war | `publicFogOfWar`, `partyFogOfWar` on the campaign document | fogged values only |
| Campaign season | `elections.endTurn` | yes |
| Slate and relocation | `recruitmentSlates` rows, `npps.homeState`, `electionCandidates.status` | yes |

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| Era preset | per world | `gameState.preset`; decides which states are close and the era price level |
| `campaignEraPriceLevelEnabled` | off | `gameConfig`; scales campaign money when on ([campaign-strategy.md](./campaign-strategy.md)) |
| NPP autonomy level | per world, live world runs V6 | per-country setting read by `nppAutonomyAtLeast`; V3 or higher turns on NPP primary challengers |
| Speaker policy | `any-seated` | `POLICY_BY_ROLE` in `src/lib/congress/leadership/rolePolicy.ts` |
| Running mate | countries with a `vicePresident` office | `src/lib/elections/runningMateEligibility.ts` |
| Party election length | 72 turns; custom 168 to 420 | `src/lib/nationalPartyElectionConstants.ts` |

## Timing

Most tactics depend on when things resolve, not only how. Turn order for the systems named above (`src/simulation/phases/turnPhaseNames.ts`):

1. `partyOrgTurn`: org decay.
2. `partyTierTurn`: tier and earned regions.
3. `statePartyElections`, `nationalPartyElections`, `nationalCommitteeElections`: party chairs change.
4. `partyActionGeneration`: PS and NPP Action Points refill.
5. `nppBehavior`: NPPs vote, file and answer Slate assignments.
6. `campaignTurn`: campaign passives, doubled when the election ends within 4 turns.
7. `primaryResolution`, then `electionResolution`.

Request-time events: Build Org, party NPP management, canvassing, Speaker and leadership nominations (24 hours), motions to vacate (24 hours), cabinet nominations. A chair's Slate assignment resolves on the next turn, never immediately.

## Worked trace

Goal: a new custom party wants to qualify a region for tier credit (20% Org) in an average-size US state where a Democratic-style party holds 120 units and a Republican-style party holds 100 units, and no one else is building.

| Step | Calculation | Result |
| --- | --- | --- |
| Starting share | 0 / (100 + 120 + 100) | 0% |
| Units needed for 20% | `n / (320 + n) = 0.20`, so `n = 0.25 x 320` | 80 units, so 80 clicks |
| Check | `80 / 400` | 20.0% exactly |
| Cost per click, one click per turn so the ladder stays at 0 | `round(37,500 x 0.075 x 1 x 1.0) = round(2,812.5)` | 2,813 cash and 1 PS |
| Total cash | 80 x 2,813 | 225,040 |
| Total PS | 80 x 1 | 80, covered by 5 PS per turn of state passive income |
| Time | one click per turn | 80 turns |
| Effect | one earned region adds 10 to the Minor national PS cap | 100 to 110 |

The rivals lose nothing in units, but their shares fall: the larger rival from `120 / 320` = 37.5% to `120 / 400` = 30%. Spending the same 80 clicks as 10 per turn would cost far more: the ladder climbs by 1 PS per click and reaches the 8 PS ceiling on the eighth click, and the cash price scales with it.

## Edge cases and limits

- Entering a primary early does not stop NPP challengers. In countries at NPP autonomy V3 or higher (V4 or higher where players are enabled, per the code comments) an NPP can join an already filled primary with a base 15% chance per cycle scaled by the NPP's office-seeking trait, halved in countries with players, capped per country, and at most once per player candidate (`CHALLENGER_BASE_PROBABILITY`, `PLAYER_COUNTRY_CHALLENGER_MULT` in `src/lib/turn/npp/electionEntry.ts`). In player countries NPPs do not challenge the presidency.
- The Speaker is not tied to the majority party, so a minority-party member can win with cross-party votes.
- A vacate motion can pass early as soon as the threshold is met, but a motion that has not reached it waits for the 24-hour window.
- Org shares can drop with no action of yours when a rival builds, because the denominator grows.
- Parliamentary countries have no direct election for head of government, so the presidential section does not apply there.
- Fog is random per update, so the same rival can show different levels on different turns.

## Invariants

- Rivals' Org units are never reduced by your Build Org clicks; only their shares fall. Enforced by `src/lib/parties/rules/organizationBucket.test.ts`.
- A motion to vacate cannot carry without `floor(seats / 2) + 1` seat-weighted votes. Enforced by `src/lib/congress/speaker/resolveVacateMotion.test.ts`.
- The cabinet confirmation rule is `votesFor > votesAgainst`; ties fail ([cabinet.md](./cabinet.md)).
- Nothing enforces cross-player agreements; they are social only.

## Failure and recovery

- **Vacant leadership seat.** A vacated Speaker seat opens a fresh 24-hour election immediately (`openSpeakerElection`), and the `leadershipPartyEligibility` phase vacates party-gated seats whose holder left the qualifying party. A race that closes with no candidates leaves the seat vacant until the next election opens; an admin reopening the election is the repair.
- **Stale fog.** Fog values refresh every turn on the cron path and are skipped while the game is paused; a frozen display after a pause is expected and clears on the next live turn.
- **Slate or relocation surprises.** If an NPP vanished from a race after a Slate move or relocation, the Slate row and `electionCandidates.status` show it as withdrawn; a chair can reassign it on the Slate.

## Connections

**Driven by:**

- [Parties](./parties.md), [Party building](./party-building.md), [Party influence](./party-influence.md) and [Party slate](./party-slate.md): the party levers.
- [Congress Leadership](./congress-leadership.md) and [Congress Speaker](./congress-speaker.md): chamber leadership rules.
- [Cabinet](./cabinet.md): nomination and confirmation rules.
- [Campaign Manager](./campaign-manager.md) and [Campaign Strategy](./campaign-strategy.md): fog, season and upgrades.
- [NPP system](./npp-system.md): NPP voting, endorsements and entry.

**Affects:**

- Player decisions only; this page changes no state. [Min-maxing](./min-maxing.md) uses the same rules from the single-player side.

## Tests

The tactics are covered by the owning systems:

| Area | Test file |
| --- | --- |
| Org units and shares | `src/lib/parties/rules/organizationBucket.test.ts` |
| Vacate threshold | `src/lib/congress/speaker/resolveVacateMotion.test.ts` |
| Running mate eligibility | `src/lib/elections/runningMateEligibility.test.ts` |
| NPP primary challengers | `src/lib/turn/npp/electionEntry.test.ts` |
| Endorsements | `src/lib/nppEndorsements.test.ts` |
| Party election timing | `src/lib/statePartyElections.test.ts`, `src/lib/nationalPartyElections.test.ts` |
| Tier | `src/lib/parties/partyTier.test.ts` |

Gaps: no test checks that this guide's advice matches the rules, and cross-party deal making has nothing to test.

## Known issues and history

- Earlier text said the Speaker requires majority party membership and that NPPs vote for the Speaker candidate closest to their positions. Neither matches the code: the Speaker is open to any seated member, and NPPs vote only when whipped. Fixed here.
- Earlier text suggested using oppose-candidate influence, requesting NPP withdrawals and using influence to clear a primary. Those party influence actions are blocked at both routes in the live release. Fixed here; the Slate and relocation routes remain.
- Earlier text said campaign details are hidden from non-party members. The code shows a fogged estimate to everyone, with less fog for party members. Fixed here.

## Related Pages

- [Congress Leadership](./congress-leadership.md) - Legislative power structure
- [Campaign Manager](./campaign-manager.md) - Campaign management tools
- [Party Building](./party-building.md) - Growing party strength
- [Min-Maxing Guide](./min-maxing.md) - Individual optimization
- [Cabinet](./cabinet.md) - Presidential nominations
- [Congress Speaker](./congress-speaker.md) - Speaker election and vacate motion
- [NPP Opponents](./npp-opponents.md) - How NPPs behave against players

Last checked: 2026-10-29, version 1.18.0
