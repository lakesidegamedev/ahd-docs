# Primary vs General Tactics

## Summary

Primaries and general elections require different strategies. This page holds the verified rules behind the pivot: how a primary score is built, how ballots and votes accumulate, and what changes when the primary ends.

Player guide: [Primary vs General Tactics](https://www.ahousedividedgame.com/wiki/primary-general-tactics). That wiki page is the full version; this page keeps the verified numbers.

## Rules

### Primary elections

Primaries determine your party's nominee. You compete against members of your own party.

- **Who votes.** Only members of your party in that state.
- **Duration.** Fixed per office in `DEFAULT_DURATIONS`, `src/lib/constants/electionDurations.ts`, and followed by a 24-turn general for every type. One turn is one game hour and 48 turns are one game year.

| Office | Total turns | Primary turns | General turns |
| --- | --- | --- | --- |
| House | 96 | 72 | 24 |
| Senate | 288 | 264 | 24 |
| Governor, State Senate, President | 192 | 168 | 24 |
| Shugiin | 192 | 168 | 24 |
| Sangiin | 144 | 120 | 24 |
| UK Commons, regional council, Bundestag, Landtag, snap and by-elections | 48 | 24 | 24 |

- **Scoring.** State and legislative primaries score up to 100 points (`calcPrimaryScore` in `src/lib/primaryScore.ts`), then multiply by an infamy penalty.

| Component | Points | Formula |
| --- | --- | --- |
| State alignment | 25 | `max(0, 25 - (econDiff + socialDiff) * 1.25)` against the state's cached lean |
| Party alignment | 15 | `max(0, 15 - (econDiff + socialDiff) * 0.75)` against the party platform |
| Party-only alignment (fallback when no state lean is available) | 40 | `max(0, 40 - (econDiff + socialDiff) * 2.0)` |
| Favorability | 35 | `favorability / 100 * 35`, favorability clamped to 0 to 100 |
| In-state political influence | 25 | `sqrt(min(100, influence) / 100) * 25` (`normalizeNPI` in `src/lib/utils/normalizeNPI.ts`) |
| Infamy multiplier | x 1.0 down to x 0.95 | `1 - 0.05 * (infamy / 100)`, `infamyPenaltyMultiplier` in `src/lib/utils/infamy.ts` |

The result is rounded to one decimal. Both lean values must be present to use the split alignment.

- **NPP competition.** NPPs still compete. When a party's primary has a player candidate, an NPP's score is multiplied by 0.5 (`NPP_PRIMARY_SCORE_MULTIPLIER` in `src/lib/electionEngine/constants.ts`, applied in `scorePrimaryCandidate`).
- **Ad bonus.** In races on campaign rules version 1 (`CAMPAIGN_RULES_VERSION`, stamped on newly created races only), a targeted-ad bonus b capped at 0.25 (`AD_BONUS_CAP`) adds `8 * ln(1 + b)` to the score (`campaignPrimaryScore`, using `PRIMARY_SHARE_SOFTMAX_TEMPERATURE` 8).
- **Display share.** The share players see is a softmax with temperature 8 (`primarySharePctSoftmax`). It never reorders candidates; the winner comes from raw score.
- **Ballots.** Standings are recorded every turn, but ballots only count over the last `min(primary length, general length)` turns of the primary (`primaryBallotWindow` in `src/lib/turn/primaryBallots.ts`), weighted with the same three-tier shape as the general (see below). A late entrant therefore faces a fair field.

### Presidential primary

- Uses national political influence (not state-level) for the reach term, and the candidate's own accumulated `partyInfluence`.
- One candidate per party advances.

| Component | Points | Formula |
| --- | --- | --- |
| Policy alignment | 40 | `max(0, 40 - (econDiff + socialDiff) * 2.0)` |
| Favorability | 25 | `favorability / 100 * 25` (`PRESIDENT_PRIMARY_FAVORABILITY_WEIGHT`) |
| Party influence | 20 at influence 150, uncapped above | `partyInfluence / 150 * 20` (`PRESIDENT_PRIMARY_PARTY_INFLUENCE_WEIGHT`, `PRESIDENTIAL_PRIMARY_PARTY_INFLUENCE_SCALE`) |
| National reach | 15 | `(1 - exp(-influence / 45)) * 15` (`PRESIDENT_PRIMARY_NATIONAL_REACH_WEIGHT`, `PRESIDENTIAL_PRIMARY_NATIONAL_REACH_TAU`) |

The same infamy multiplier applies. For the displayed presidential standing, a party with a live delegate projection uses the delegate-consistent standing instead of the raw formula (`presStandingByCandidate` in `src/lib/turn/primarySnapshots.ts`, ticket #3022). Party chairs get no inherent presidential-primary multiplier: `effectivePartyInfluenceForPresidentialPrimary` returns raw party influence and ignores the role arguments. NPPs pass a party influence of 0.

### General elections

The general election pits party nominees against each other.

- **All voters** in the state can vote, not just your party.
- **Vote accumulation.** Votes accumulate over the 24 general turns from the general start (`turnVoteWeight` in `src/lib/electionEngine/voteCalculations.ts`).

| Tier | Turns | Share of the vote pool | Constant |
| --- | --- | --- | --- |
| Early | everything before the ramp, 12 of 24 | 50 percent | `EARLY_POOL_SHARE` |
| Ramp | the 8 turns before the final 4 | 20 percent | `RAMP_TURNS`, `RAMP_POOL_SHARE` |
| Election day | final 4 turns | 30 percent | `ELECTION_DAY_TURNS`, `FINAL_POOL_SHARE` |

A window of 4 turns or fewer spreads the pool evenly. If the early band is empty, its share folds into the ramp so the pool is always fully used.

- **State lean.** Blue or red lean gives a structural advantage to the aligned party, through the voter groups in each state.
- **Favorability multiplier.** Each voter group's vote for a candidate is scaled by `approvalScalar = (effectiveFavorability / 100) ^ 0.8` (`APPROVAL_SCALAR_EXPONENT` in `src/lib/utils/demographicAppeal.ts`), where effective favorability is favorability plus half the group's archetype approval, clamped to 0 to 100.
- **Party organization.** A party's normalized share of state organization is raised to the power 0.2 (`ORG_WEIGHT_EXPONENT` in `src/lib/electionEngine/electionFormulaFactors.ts`), so returns diminish. A party with no presence in a populated state gets 0.
- **Government approval.** It does not multiply every candidate's vote. It acts as a coattail on down-ballot generals: `1 + clamp((approval - 50) / 25, -1, 1) * 0.09` on the sitting executive's party (`approvalCoattailMultiplier`, `COATTAIL_MAX_BONUS` 0.09, `COATTAIL_APPROVAL_SATURATION` 25 in `src/lib/electionEngine/constants.ts`; base approval 50 in `src/lib/utils/governmentApproval.ts`). It does not apply to the executive's own race.
- **Campaign season.** Canvassing effectiveness doubles when a race in the state ends within 4 turns, or a presidential race for the country does (`checkActiveCampaignSeason` in `src/app/api/canvassing/route.ts`, `canvassingBoost` in `src/lib/campaignTargeting/rules.ts`).

### Pivoting from primary to general

1. **Your positions do not change when the primary ends.** They move only through bill votes in office.
2. **Shift ad targeting.** Move ads from base demographics to swing groups.
3. **Increase campaign activity.** The campaign-season multiplier makes every canvass more valuable.
4. **Watch your opponent.** If they have higher influence, you need to out-fundraise and out-advertise.

### Office-specific notes

| Office | Key Factor |
| --- | --- |
| House | State party org strength; many districts mean many NPP opponents |
| Senate | Statewide appeal; need broad demographic coverage |
| Governor | Statewide; government approval coattail matters most |
| President | Electoral College; win the swing states, which depend on the era and the current state leans |

## Data

| Collection | Fields | Read or written | Player-visible |
| --- | --- | --- | --- |
| `elections` | `electionType`, `startTurn`, `primaryEndTurn`, `endTurn`, `campaignRulesVersion`, `status` | Read for phase and window; `campaignRulesVersion` is stamped at creation | Phase and timing yes; version no |
| `electionCandidates` | `characterId`, `nppId`, `isNPP`, `party`, `status`, `targetedAds` | Read for scoring; written by entry, withdrawal and ad purchases | Yes |
| `primarySnapshots` | per-turn `byParty` entries of `primaryScore` and `sharePct` per candidate | Written each turn of an open primary | Yes, as trend and standings |
| `electionVoteTallies` | accumulated votes per candidate | Written each turn during the general and the ballot window | Yes |
| `characters` | `policies.economic` and `policies.social`, `favorability`, `politicalInfluence`, `nationalInfluence`, `partyInfluence`, `infamy` | Read only for scoring | Yes, own stats and public stats |
| `npps` | `policies`, `favorability`, `politicalInfluence` | Read for NPP candidates | Partly |
| `politicalParties` | `economicPosition`, `socialPosition` (platform) | Read for party alignment | Yes |
| State demographics and turnout modifiers | group shares, turnout, canvass buckets | Canvassing writes turnout buckets; the engine reads them | Partly |

## Configuration

Primary and general scoring read no `gameConfig` field and have no era override. Values are code constants. Duration and cycle timing come from the election type and the canonical schedule.

| Setting | Default | Where set |
| --- | --- | --- |
| Primary and general lengths per type | table above | `DEFAULT_DURATIONS` in `src/lib/constants/electionDurations.ts` |
| Canonical cycle anchors per country and era preset | per country | `src/lib/elections/canonicalCycle.ts` |
| Primary component weights | 25/15/35/25 (state) and 40/25/20/15 (presidential) | `src/lib/primaryScore.ts` |
| `NPP_PRIMARY_SCORE_MULTIPLIER` | 0.5 | `src/lib/electionEngine/constants.ts` |
| `INFAMY_PENALTY_MAX` | 0.05 | `src/lib/utils/infamy.ts` |
| `PRIMARY_SHARE_SOFTMAX_TEMPERATURE` | 8 | `src/lib/primaryScore.ts` |
| `PRESIDENTIAL_PRIMARY_USE_DIMINISHING_RETURNS` | true | `src/lib/utils/normalizeNPI.ts` |
| Closing surge shares | 50/20/30 percent, 8 and 4 turns | `src/lib/electionEngine/voteCalculations.ts` |
| `APPROVAL_SCALAR_EXPONENT`, `ORG_WEIGHT_EXPONENT` | 0.8, 0.2 | `src/lib/utils/demographicAppeal.ts`, `src/lib/electionEngine/electionFormulaFactors.ts` |
| `CAMPAIGN_RULES_VERSION`, `AD_BONUS_CAP`, `CANVASS_BASE_BOOST` | 1, 0.25, 2 | `src/lib/campaignTargeting/rules.ts` |
| `campaignRulesVersion` on an election | stamped by `withCampaignRules` on new races only | `src/lib/campaignTargeting/rules.ts` |

## Timing

Each turn, for every open primary, the primary snapshot pass records standings (`src/lib/turn/primarySnapshots.ts`). Non-presidential primaries accrue ballots only inside the ballot window, the final `min(primary, general)` turns of the primary. When the primary ends, `resolvePrimariesIfNeeded` (`src/lib/turn/primaryResolution.ts`) selects nominees from raw score and the race enters its 24-turn general. During the general, vote accumulation runs each turn with `turnVoteWeight` and the vote engine (`src/lib/electionEngine/`). Canvassing and ads are player requests that take effect immediately and decay by turn: turnout modifiers halve every 6 turns (`TURNOUT_HALF_LIFE`) and ad flights halve every 24 (`AD_HALF_LIFE`).

```mermaid
flowchart LR
  A[Primary start] --> B[Each turn: record scores and snapshot]
  B --> C[Last min of primary, general turns: ballots count]
  C --> D[Primary ends: nominees picked by raw score]
  D --> E[General: 12 early, 8 ramp, 4 election-day turns]
  E --> F[Resolve]
```

## Worked trace

A House candidate with economic position 2 and social position -1, in a party with platform (1, 0), in a state with cached lean (3, -2). Favorability 60, in-state political influence 36, infamy 40.

| Step | Computation | Result |
| --- | --- | --- |
| State alignment | `econDiff 1`, `socialDiff 1`: `25 - 2 * 1.25` | 22.5 |
| Party alignment | `econDiff 1`, `socialDiff 1`: `15 - 2 * 0.75` | 13.5 |
| Alignment total | 22.5 + 13.5 | 36.0 |
| Favorability | `60 / 100 * 35` | 21.0 |
| Influence | `sqrt(36 / 100) = 0.6`, times 25 | 15.0 |
| Raw | 36.0 + 21.0 + 15.0 | 72.0 |
| Infamy multiplier | `1 - 0.05 * 0.4` | 0.98 |
| Score | `72.0 * 0.98 = 70.56`, rounded to one decimal | 70.6 |
| An NPP rival with the same inputs, player in the primary | `70.6 * 0.5` | 35.3 |
| Display share against a 66.0 rival | softmax: `exp((66.0 - 70.6) / 8) = 0.563`, share `1 / 1.563` | 64.0 and 36.0 percent |

Presidential, same positions, favorability 60, party influence 75, national influence 45, infamy 0: alignment `40 - 4 = 36`; favorability `0.6 * 25 = 15`; party influence `75 / 150 * 20 = 10`; reach `(1 - exp(-1)) * 15 = 0.632 * 15 = 9.48`; total 70.48, shown as 70.5.

General vote weights for a pool of 100 over the 24-turn window: each of the 12 early turns carries `0.5 * 100 / 12 = 4.17`, each of the 8 ramp turns `0.2 * 100 / 8 = 2.5`, each of the final 4 turns `0.3 * 100 / 4 = 7.5`. The sum is `12 * 4.17 + 8 * 2.5 + 4 * 7.5 = 50 + 20 + 30 = 100`. A candidate with favorability 60 has an approval scalar of `0.6 ^ 0.8 = 0.665` on each group's vote. One closing-window canvass at a fit of 0.957 (positions one point apart on each axis, `0.2 + 0.8 * exp(-1/18)`) gives `2 * 0.957^2 * 2 = 3.66` turnout points, against 1.83 outside campaign season.

## Edge cases and limits

- **Missing state lean.** The primary falls back to 40 points of party-only alignment.
- **Influence above 100 in a state primary** adds nothing (clamped); in the presidential primary party influence above 150 keeps paying linearly.
- **Infamy** reduces the score at most 5 percent.
- **Very short general windows** (4 turns or fewer) spread the pool evenly; with no early band the ramp takes its share.
- **NPPs in a party with no player candidate** keep their full score; the 0.5 multiplier applies only when a player is in that party's primary.
- **Presidential reach for NPPs** uses political influence as a proxy for national influence.
- **Retired scalars.** The old party-org multipliers (`partyOrgScalar`, `partyOrgScalarPresidential`) were retired 2026-06-18; primaries use a neutral 1 for organization.
- **Parliamentary countries** score their primary the same way but their 24-turn primary is short, so the ballot window is the whole primary.
- **Bespoke presidential systems** (for example Nigeria, Russia, Brazil indirect) use separate paths and do not follow these formulas.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| A state primary score is within 0 to 100 before any ad bonus (the presidential score is uncapped above 100 only through party influence), and the infamy multiplier is within 0.95 to 1.0 | `src/lib/primaryScore.test.ts` (maximum, worst case, infamy cases) |
| Scoring is deterministic | `src/lib/primaryScore.test.ts` |
| General per-turn weights sum to the pool for any window length | `src/lib/electionEngine/voteCalculations.test.ts` (48-turn window, no-early-band, short, very long) |
| The final 4 turns carry 30 percent regardless of clock drift | `voteCalculations.test.ts` (turn-first case, ticket #955) |
| Softmax shares never reorder candidates | By construction; no test names it |
| Winners come from raw score, not display share | Not enforced by a test |

## Failure and recovery

| Failure | What it looks like | Repair |
| --- | --- | --- |
| A race created before a rule change keeps its stored timing and rules version | Old races differ from new ones | Intended: rules are stamped at creation. A reseed or heal of the race is the only way to change it |
| Snapshot pass skipped or failed for a turn | A gap in the primary trend chart | The next turn records standings again; resolution reads live scores, not snapshots |
| General window computed from the overall start | Final turns carry about 66 percent of the vote (ticket #955) | The window must start at the general start; fixed in code |
| Missing lean or position data | Fallback to party-only alignment | None needed; repair the state or candidate record to restore split alignment |

## Connections

**Driven by**
- [Election Mechanics](./elections.md): phase timing, durations and nominee selection.
- [Campaign Strategy](./campaign-strategy.md): action allocation, canvassing and ads feed turnout and targeted bonuses.
- [Demographics & Targeting](./demographics-targeting.md): voter groups and swing demographics.
- [NPP Opponents Guide](./npp-opponents.md): NPP candidates and the 0.5 primary multiplier.

**Affects**
- Party nominees, who carry into the general; the general result.
- Coattails: government approval moves down-ballot generals through `approvalCoattailMultiplier`.

## Tests

| File | Covers |
| --- | --- |
| `src/lib/primaryScore.test.ts` | State and presidential primary scoring, infamy, fallback alignment |
| `src/lib/utils/normalizeNPI.test.ts` | Influence curves |
| `src/lib/electionEngine/voteCalculations.test.ts` | Closing-surge tiers and conservation |
| `src/lib/electionEngine/voteDistribution.test.ts` | Vote distribution and approval scaling |
| `src/lib/electionEngine/coattailMagnitude.test.ts`, `govCoattail.test.ts`, `presidentialCoattail.test.ts` | Government approval coattail |
| `src/lib/campaignTargeting/rules.test.ts` | Canvass boost, ad bonus, campaign rules |
| `src/app/api/canvassing/route.test.ts` | Campaign-season canvassing |

Gaps: no test pins the NPP 0.5 multiplier inside `scorePrimaryCandidate` end to end, no test pins `DEFAULT_DURATIONS` against the numbers in the player guide, and the ballot window has no dedicated test file for `src/lib/turn/primaryBallots.ts`.

## Known issues and history

- **Durations corrected 2026-10-29.** The earlier version of this page gave primaries of 48, 240 and 144 turns each followed by a 48-turn general. The shipped `DEFAULT_DURATIONS` give every type a 24-turn general and primaries of 72 (House), 264 (Senate) and 168 (Governor, State Senate, President). The code wins.
- **Government approval statement corrected 2026-10-29.** The earlier text said government approval multiplies your vote total. The multiplier on each voter group is based on the candidate's effective favorability; government approval acts as a coattail on down-ballot races.
- 2026-08-19: presidential primary reweighted (favorability 10 to 25, party influence 30 to 20, reach 20 to 15) so the primary selects for what the general rewards.
- 2026-07-11: the inherent presidential-primary boost for party chairs was removed.
- Ticket #934: primary display share moved from linear to softmax; party influence replaced home-state organization in the presidential primary.
- Ticket #955: general vote tiers must be computed over the general window only.

Last checked: 2026-10-29, version 1.18.0
