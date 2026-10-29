# Non-Player Politicians (NPPs)

Player guide: [NPPs Overview](https://www.ahousedividedgame.com/wiki/npps-overview)

## Summary

NPPs are AI-controlled politicians who keep the world populated and politically active even when there are not enough players to fill every office. They can hold office, enter elections, vote on legislation, join caucuses, receive party pressure, and endorse candidates (only when a player asks).

- **Purpose.** Fill seats, create contested races, and act as strategic targets for player and party influence.
- **Display.** NPPs appear across election pages, legislature pages, party surfaces, and state or region pages with an `NPP` badge. The profile page is `/politicians/npp/[id]`.
- **Offices covered.** Legislative, executive, and subnational offices across active countries.
- **Scope of this page.** Core NPP identity, election entry, bill voting, endorsements, player influence actions, caucus interaction, and party capacity. Autonomous NPP economic behaviour (corporations, finance, sponsorship) is gated by the autonomy level and is covered where it touches these systems.

The player-facing companion is [npp-opponents.md](./npp-opponents.md).

## Rules

### Personality traits

| Trait | Range | Current role in gameplay |
| --- | --- | --- |
| `loyalty` | 0 to 100 | Party-discipline pressure, Slate acceptance, whip compliance, caucus stability |
| `ambition` | 0 to 100 | Reserved for deeper challenger tuning; current entry is mostly deterministic (challengers are weighted by `officeSeekingMult` from the career-archetype model instead) |
| `stubbornness` | 0 to 100 | Resistance to influence, Slate assignments, whips, and cooperation asks |

Whip compliance (`src/lib/turn/npp/complianceRules.ts`): `compliance = (loyalty / 100) * 0.7 + (1 - stubbornness / 100) * 0.3`. Missing personality values default to 50.

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| `NPP_POLITICAL_INFLUENCE_FLOOR` | 10 (decay never takes an NPP below it) | `shared/constants/formulas.ts` |
| `NPP_PRIMARY_SCORE_MULTIPLIER` | 0.5, when a player is in the NPP's party primary | `src/lib/electionEngine/constants.ts` |
| `NPP_GENERAL_WEIGHT_MULTIPLIER` | 0.8, when a player is in the race | `src/lib/electionEngine/constants.ts` |
| `NPP_STAGGER_EXTRA_MULTIPLIER` | 0.6, stacking with the above to 0.48 in presidential primary stagger waves | `src/lib/electionEngine/constants.ts` |
| Cross-pressure verdict threshold | `VERDICT_THRESHOLD = 5`: abstain when the sum is within -5 to +5 | `src/lib/turn/npp/crossPressure.ts` |
| Force clamp | -100 to 100 each, applied before summing | `src/lib/turn/npp/crossPressure.ts` |
| Compliance weights | loyalty 0.7, pliability (1 - stubbornness) 0.3 | `src/lib/turn/npp/complianceRules.ts` |
| Party whip base | hard 60, soft 30, multiplied by `1 + cabinetDiscipline` (0 to 0.2) and then compliance | `src/lib/turn/npp/crossPressure.ts`, `src/lib/resetCabinet/rules/gameplay.ts` |
| Caucus whip base | soft 40 (the resolver uses 40 for any caucus whip), +20 when it matches a caucus core position | `src/lib/turn/npp/crossPressure.ts` |
| Party-line default | 20 times compliance, added to ideology | `src/lib/turn/npp/crossPressure.ts` |
| Local force weights | ideology 1, whip 1, district 1.35, donors 0.65 | `src/lib/turn/npp/stateBillVoting.ts` |
| Federal force weights | 1 on every force | `src/lib/turn/npp/crossPressure.ts` |
| `ADDRESS_AGENDA_FORCE_BIAS` | 8, added to ideology on a bill sponsored by the leader's party in an emphasized category | `src/lib/constants/governorOffice.ts` |
| Hard whip willingness | `55 + round(loyalty * 0.35) - round(stubbornness * 0.18) + mode bonus + Statecraft bonus`, held to 40 to 95. Mode bonus hard 15, soft 6 | `src/lib/partyWhips/whipSuccess.ts` |
| Endorsement relationship gate | `40 + min(10, abs(econ diff) + abs(social diff))` | `src/lib/nppEndorsements.ts` |
| `NPP_ENDORSEMENT_DIRECT_FAVORABILITY_PER_ENDORSEMENT` / `_CAP` | 1.5 per endorsement, capped at 6 | `src/lib/nppEndorsements.ts` |
| Candidate influence fallback | 10 when the stored value is missing or not finite | `src/lib/electionEngine/candidateEnrichment.ts` |
| `NPP_RELATIONSHIP_DECAY_PER_TURN` | 0.1 toward 0 | `src/lib/constants/partyOrg.ts` |
| `CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP` | 60 | `src/lib/constants/partyOrg.ts` |
| `CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP` | 20 | `src/lib/constants/partyOrg.ts` |
| `CAUCUS_NPP_RECRUIT_COOLDOWN_TURNS` | 12 | `src/lib/constants/partyOrg.ts` |
| Slate acceptance | loyalty at least 40 and stubbornness at most 70 (local leaders get leeway) | `src/lib/slateAssignments.ts` |
| `CHALLENGER_BASE_PROBABILITY` | 0.15, times `officeSeekingMult`, times 0.5 in player-enabled countries | `src/lib/turn/npp/electionEntry.ts` |
| `NPP_CHALLENGERS_PER_COUNTRY_PER_PASS` | 2 | `src/lib/nppAutonomy/playerImpactBudget.ts` |
| `NPP_SPONSOR_ACTIVE_CAP` / `_COOLDOWN_TURNS` | 2 active bills / 12 turns (player-enabled countries: 1 / 36) | `src/lib/nppAutonomy/constants.ts`, `src/lib/nppAutonomy/playerImpactBudget.ts` |
| Party NPP capacity tiers | 5 slots per member for members 1 to 5, 4 for 6 to 10, 3 for 11 to 20, 2 beyond | `src/lib/npp/partyCapacity.ts` |
| NPP ceiling | `max(25, 6 * regionCount)` | `src/lib/npp/partyCapacity.ts` |
| Active member | at least 2 actions in the last 14 days, not banned | `src/lib/npp/partyCapacity.ts` |
| Unknown race type priority | 999 (last) | `src/lib/turn/rules/nppElectionPriority.ts` |

### Entry rules

Current NPP entry is deterministic and priority-based. An NPP can be filed only when:

- it is not retired and not a technocrat;
- it is not already in another active race (`isNPPAvailable`);
- it belongs to the same `countryId` as the election;
- it matches the race geography for subnational offices (`homeState` equals the race state for `house`, `senate`, `governor`, `stateSenate`; home geography matches for `commons`, `regionalCouncil`, `shugiin`, `sangiin`);
- for a new (non-incumbent) filing, its party has regional presence there (`canPartyFieldInState`).

Presidential entry is blocked by default. SP3 lifts the bar only in autonomy-active, non-player-enabled countries, where no player can contest the presidency (`src/lib/nppAutonomy/featureFlag.ts`, `src/lib/nppAutonomy/appointNppPresident.ts`); direct Russian first-round ballots are the other exception. One-party states additionally restrict who can file (`src/lib/turn/onePartyConstraints.ts`).

### Entry order

NPP filing runs in a deliberate order inside `processElectionEntry`:

1. **Defending incumbents** auto-file first for the seat they already hold.
2. **Accepted Slate NPPs** file next, even if this creates a same-party primary against a defending incumbent.
3. **Fallback fill** adds at most one generic same-party NPP to an otherwise open primary, in `RACE_PRIORITY` order.
4. **Consolidation** (autonomy v6): in the closing window of a primary with no player in it, a clearly trailing non-incumbent NPP withdraws and gets a cooldown.
5. **Ambitious challengers** (autonomy v3 and above): for a primary with exactly one active same-party candidate, a seeded roll `random < 0.15 * officeSeekingMult * countryMult` adds one second same-party NPP. Capped at 2 per country per pass, and a lone player candidate is challenged at most once per election.

### Priority order for generic fallback fill

| Race priority (highest first) |
| --- |
| `stateSenate` |
| `regionalCouncil` |
| `peoplesCongress` |
| `republicSupremeSoviet` |
| `landAssembly` |
| `sangiin` |
| `house` |
| `milletMeclisi` |
| `commons` |
| `special_commons` |
| `senate` |
| `senato` |
| `shugiin` |
| `npcDelegate` |
| `supremeSovietDeputy` |
| `nationalitiesDeputy` |
| `unionCongressDeputy` |
| `governor` |

Source: `RACE_PRIORITY` in `src/lib/turn/rules/nppElectionPriority.ts` (18 types). Snap variants share their regular race's priority.

### Cooldowns and dropout

- The only writer of `electionCooldowns[electionId]` in the turn is consolidation, which sets the expiry to the primary's end time.
- Generic fallback fill and the challenger pass respect the cooldown.
- Defending incumbents can still auto-defend their own seat even if they previously dropped from that same primary.

### Bill voting

Handled by `src/lib/turn/npp/billVoting.ts` (federal bills in `bills`), `src/lib/turn/npp/stateBillVoting.ts` (state and regional bills in `stateBills`, voted by the country's sub-national legislature, for example `stateSenate` and `regionalCouncil`), and `src/lib/turn/npp/crossPressure.ts`.

Each vote is the deterministic sum of four signed forces, each clamped to -100 to 100:

| Force | Formula |
| --- | --- |
| `ideology` | `clamp(alignment * 100)`, where `alignment = clamp(dot(NPP policies, bill vector) / (|vector| * 5), -1, 1)`. The bill vector comes from the provision, then the selected policy option, then the average of same-direction options. If none exists, the NPP's domain stance, then a legacy fallback `-economic / 5 * effectDirection`. New-generation bills with no vector and no stance get alignment 0 |
| `whip` | `clamp((party whip +-60 or +-30, times 1 + cabinetDiscipline) + (caucus whip +-40, +-20 on core position)) * compliance` |
| `district` | `clamp(sum over home-state archetypes of (group population / total) * approval of the selected option)` |
| `donors` | `clamp(donorBaseLevel / 5 * alignment * 100)`, 0 when the donor level is 0 or the bill is not policy-coded |

Verdict: total above +5 is `for`, below -5 is `against`, otherwise `abstain`. After the forces are computed:

- A referendum-consent bill replaces ideology with the constitutional consent force.
- War-entry bills add the frozen national pressure times `0.75 + loyalty / 200` to ideology.
- A national or state address from the sponsor's party in an emphasized category adds 8 to ideology.
- With no applicable whip, a same-party NPP gets the party-line lean (20 times compliance) on ideology. At autonomy v6 an NPP-led government's soft whip replaces it, and at v1 and above the opposition bloc adds an opposition force against the governing party's bills.
- At v6, an NPP's own business stakes add to donors on bills with a sector provision; if that decides the verdict the NPP loses 1 favorability (`INTEREST_VOTE_FAVORABILITY_COST`).
- Every force is re-clamped to -100 to 100 after each addition.

**Federal versus local weighting.** Federal voting uses weight 1 on every force. Local voting weights home-region pressure more heavily and donors more lightly (district 1.35, donors 0.65).

**Whips in auto-voting.** Party whips are found by `resolveWhipForNPP`: a state-party whip wins over a national-party whip for in-state NPPs, and a national whip applies only when the state party has no player chair or vice chair. `hard` contributes 60, `soft` 30. Caucus whips are scoped to caucus members only, but see Known issues.

**Immediate whips versus autonomous resolution.** The Whip Room can also apply a `hard` NPP bill whip immediately with a hidden roll (`resolveNppWhipSuccess`). On success the vote is written at once. A `soft` whip forces nothing and only shifts later autonomous cross-pressure.

**Multi-seat weighting.** An NPP holding multiple seats contributes its weight to the tally: `seatsHeld` for state chambers, and the mandate weight from `aggregateNppMandateWeights` for federal chambers. One vote per NPP per bill chamber; an NPP that has already voted is skipped.

### Leadership voting

US congressional leadership elections are player-only for NPP behaviour. NPPs do not autonomously vote in Speaker, House leadership, or Senate leadership elections; the NPP turn pass reports `speakerVotes: 0`. `castLeadershipVote` in `src/lib/turn/npp/leadershipVoting.ts` is shared infrastructure used when a player's whip routes direct NPP votes (`src/lib/congress/applyWhipVotes.ts`).

### Influence system

The NPP profile panel offers a deterministic player-to-NPP surface in `src/lib/capital/actions.ts`. There is no hidden-roll request table.

| Action | Actions | Campaign funds | Relationship gate | Effect |
| --- | --- | --- | --- | --- |
| `request_endorsement` | 6 | $0 | hidden, `40` to `50` | Creates or refreshes an arranged endorsement |
| `private_meeting` | 3 | $0 | at least -50 | +5 relationship |
| `boost_favorability` | 5 | $10,000 | none | +3 favorability, +2 relationship |
| `reduce_favorability` | 5 | $10,000 | at least -100 | -3 favorability, -2 relationship |
| `boost_influence` | 6 | $20,000 | none | +2 influence, +2 relationship |
| `reduce_influence` | 6 | $20,000 | at least -100 | -2 influence, -2 relationship |

Direct interactions spend the player's `actions` and `campaign funds`, and are deterministic once resource gates and the hidden endorsement check are met. Positive relationship and favorability gains are multiplied by the player's charisma (`statMultiplier(stat) = 1 + (stat - 5.5) * 0.04`, rounded). They write to the `capitalActionLogs` audit trail and roll back fully on failure.

### Party-led NPP management

See [party-influence.md](./party-influence.md) for the party-side surface.

- The **national party** gets broader NPP management and endorsement or withdrawal tools.
- A **state or regional party** gets local `Recruitment` and `Management` surfaces, currently `boost_favorability`, `boost_influence`, `boost_loyalty` and `reduce_stubbornness`. Local leaders get a small hidden edge on `boost_loyalty` and `reduce_stubbornness`.

### Party whips

See [party-whips.md](./party-whips.md) for the full whip design. For NPPs: a `hard` bill whip uses the hidden willingness roll above; a `soft` whip is advisory pressure only. Active non-compliance is surfaced through `Defiance` views rather than a permanent shame ledger, and defiance disappears if the NPP later votes back into line.

### Endorsements

Endorsements are manual-only for NPPs. They do not organically endorse, switch, or re-evaluate campaigns in the turn system. Any legacy `organic` row is withdrawn on the next turn (`manual_only`).

- A player requests an endorsement from the NPP profile; it applies only to the player's currently active campaign in that election.
- The ask is hidden behind a deterministic willingness check. The UI shows only `Likely to Accept` or `Likely to Decline`.
- `required relationship = 40 + min(10, abs(econ diff) + abs(social diff))` (`getRequestedEndorsementRelationshipRequirement` in `src/lib/nppEndorsements.ts`). A perfect match needs 40; a distance of 10 or more needs 50.
- An arranged endorsement stays active only while that campaign remains active and the NPP and election share a country. It ends when the campaign resolves, the candidate withdraws or becomes inactive, or the election ends.
- Endorsements are election-scoped, so the player must request again in future races.
- Mechanical effect: they contribute to campaign-action generation, and add a small direct election-pressure favorability bonus (1.5 per endorsement, capped at 6) through candidate enrichment.

### Caucus interaction

- NPPs can be recruited into caucuses when the chair's relationship is at least 60.
- Each turn every stored relationship drifts 0.1 toward 0, and an NPP caucus member whose relationship with the chair falls below 20 is removed (`src/lib/turn/partyOrg/caucusRelationshipMaintenance.ts`).
- Caucus whips and caucus health surfaces treat NPPs as real faction members.

### Party NPP capacity

A party's NPP allowance grows with active members. The first 5 members add 5 slots each, the next 5 add 4, members up to 20 add 3, and later members add 2, capped at the country ceiling `max(25, 6 * regionCount)` (`calculatePartyNppCapacity`, `calculateNppCeiling`). Examples: 4 members give 20 slots, 8 give 37, 20 give 75, 30 give 95.

## Data

### Core fields (`npps` collection)

| Field | Type | Description | Visible to players |
| --- | --- | --- | --- |
| `name` | `string` | Procedurally generated politician name | Yes |
| `countryId` | `CountryId` | Country ownership; always required for cross-country safety | Yes |
| `homeState` | `string` | Home state, region or prefecture key | Yes |
| `party` | `string` | Party slug or sequential-id-backed party reference | Yes |
| `avatarUrl` | `string?` | Optional portrait URL | Yes |
| `politicalInfluence` | `number` | 0 to 100, decay floor of 10 | Yes |
| `favorability` | `number` | 0 to 100 | Yes |
| `policies` | `PolicyPositions` | `economic`, `social` (-5 to +5) and optional `domainPositions` | Yes |
| `currentOffice` | `OfficeType or null` | Current office held, if any | Yes |
| `personality` | `NPPPersonality` | `loyalty`, `ambition`, `stubbornness` | Partly (Slate and whip outcomes) |
| `donorBaseLevel` | `number?` | 0 to 5, scales the donors force | Yes |
| `electionCooldowns` | `Record<string,string>` | Election re-entry lockouts (ISO expiry) | No |
| `retiredAt` | `Date or null` | Retirement marker | Yes |
| `isTechnocrat` | `boolean?` | Excluded from entry, voting, action AI and fund generation | No |
| `funds`, `actionPoints` | `number?` | Resources for the action AI | No |
| `archetypeApprovals` | `Record<string, number>?` | Per-group approval modifiers, decay 0.5 percent per turn | No |

### Other collections

| Collection | Read or written |
| --- | --- |
| `electedOfficials` | Read: seats held by each NPP, `seatsHeld`, `officeType` |
| `electionCandidates` | Written: NPP candidacy docs (`isNPP`, `nppId`) on filing; read for duplicates |
| `elections` | Read: open primaries, `primaryEndTurn`, `primaryEndTime` |
| `bills`, `stateBills` | Read open bills; written: `votes.npp_<id>`, `votesFor/Against/Abstain` (and the other-chamber and override equivalents) |
| `nppVotePredictions` | Written: `forces`, `donorsLabel`, `verdict`, `resolvedVote`, `computedAtTurn`, keyed by NPP and bill or state bill |
| `billWhips` | Read: party and state whips by bill |
| `statePartyOrg` | Read: regional presence and leadership |
| `nppRelationships` | Read and written: `relationshipScore` (-100 to 100), attempt counters |
| `capitalActionLogs` | Written: direct action audit rows |
| `nppEndorsements` | Read and written: arranged endorsements and their withdrawal reason |
| `caucuses`, `caucusMemberships` | Read and written: NPP membership and removal |
| `characters` | Written: `actions` and funds on a direct action |
| `governorAddresses` | Read: active agenda effects |
| `stateDemographics` | Read: home-state group populations for the district force |
| `gameState` | Read: autonomy level, preset |

## Configuration

| Setting | Effect | Default and where set |
| --- | --- | --- |
| `gameState.nppAutonomyLevel` (`off`, `v0` to `v6`) | Gates challengers (v3), opposition behaviour (v1), engine 6 features (v6: consolidation, government whip, business interest, presidential challengers) and presidential entry | `off`; `v0` when only the legacy `nppAutonomyEnabled` boolean is set. Read through `getNppAutonomyLevel` (`src/lib/nppAutonomy/featureFlag.ts`). `NPP_ENGINE_LEVEL` is `v6` (`src/lib/nppAutonomy/engineVersion.ts`) |
| Player-enabled country | Halves challenger rate, tightens sponsorship limits, blocks NPP presidential entry | `isCountryEnabledForPlayers` (`src/lib/countryAccess`) |
| Difficulty behaviour policy | `oppositionCoordination` scales the opposition bloc force; hosted and multiplayer worlds use `normal` (1) | `loadNppBehaviorPolicy` (`src/lib/singleplayerDifficulty/loadBehaviorPolicy.ts`) |
| `statePartyOrg.hasPresence` | Gates new NPP candidacies in a region | Per region and party row |
| Government type | One-party states restrict who can file and vote | `CountryConfig.governmentType` (`src/lib/constants/countries.ts`) |
| Office `partyStrengthWeight` | Not an NPP setting; see [national-metrics.md](./national-metrics.md) | per country institutions files |

## Timing

NPP work is spread across several named turn phases (registry in `src/simulation/phases/turnPhaseRegistry.ts`, order in `src/simulation/phases/turnPhaseNames.ts`):

```text
nppRelationshipMaintenance   relationship drift + caucus retention
nppBillSponsorship           NPP-sponsored bills
generateChallengers          challenger supply
nppBehavior                  processNPPTurn:
                               mortality -> context load -> slate sync -> slate responses
                               -> election entry -> endorsement cleanup
                               -> federal bill voting -> local bill voting
playerEndorsementPartySweep
billLifecycle                NPP votes are already in before bills resolve
nppActionProcessing          action AI, every 4 turns per NPP
primaryResolution
electionResolution           closes the races NPPs entered
```

Player influence actions run at request time, not in the turn. They spend actions and funds immediately and write to `capitalActionLogs`. Slate responses run before election entry so accepted Slate rows are ready for the filing pass.

## Worked trace

**Cross-pressure vote.** A federal bill carries a provision with policy vector (economic 3, social 4), so `|vector| = 5`. The sponsor is in party P. Three NPPs vote.

NPP A (party P, economic 4, social 2, loyalty 80, stubbornness 40, donor level 3), hard party whip For, home-state option approval -20:

| Force | Calculation | Value |
| --- | --- | --- |
| compliance | 0.8 * 0.7 + (1 - 0.4) * 0.3 = 0.56 + 0.18 | 0.74 |
| ideology | projection (4 * 3 + 2 * 4) / 5 = 4; alignment 4 / 5 = 0.8; 0.8 * 100 | 80 |
| whip | 60 * 0.74 | 44.4 |
| district | weighted approval | -20 |
| donors | 3 / 5 * 0.8 * 100 | 48 |
| total | 80 + 44.4 - 20 + 48 | 152.4, `for` |

NPP B (economic -2, social -4, loyalty 50, stubbornness 50, donor level 3), same hard whip For: compliance 0.5; projection (-2 * 3 + -4 * 4) / 5 = -4.4, alignment -0.88, ideology -88; whip 60 * 0.5 = 30; district -20; donors 3 / 5 * -0.88 * 100 = -52.8. Total -130.8, so `against` despite the whip. In a state chamber the same inputs give district -27 and donors -34.32, total -119.32.

NPP C (party P, loyalty 50, stubbornness 50, donor level 0), no whip, alignment -0.1: ideology -10 plus party line 20 * 0.5 = +10 gives 0; district +3; donors 0. Total 3, within -5 to +5, so `abstain`. On a veto-override bill the abstain becomes `against`.

Each vote is stored in `bills.votes.npp_<id>`, the weighted tally is incremented, and the force vector is upserted into `nppVotePredictions`.

**Endorsement.** Player policies (+3, -2), NPP policies (+2, -1): distance `abs(2 - 3) + abs(-1 - -2) = 2`, so the gate is 42. The relationship starts at 30. Two `private_meeting` (+5 each, neutral charisma, 6 actions) reach 40; two `boost_favorability` (+2 relationship each, 10 actions, $20,000) reach 44. The check passes (`likely_accept`), `request_endorsement` (6 actions) creates an `arranged` endorsement. Total 22 actions and $20,000. In the election, the endorsed candidate gets +1.5 favorability (one endorsement) in candidate enrichment. The relationship then drifts down 0.1 per turn.

**Entry.** In a House primary where defending NPP I, accepted Slate NPP S and generic same-party NPP G are all eligible: I files in step 1, S in step 2, G is skipped in step 3 because the party already has an active candidate. The challenger pass skips the race because it already has two active candidates. In an open primary with no candidate, G fills it; at v3 in a non-player country the chance of a second same-party challenger is `0.15 * officeSeekingMult` (0.15 at multiplier 1), and 0.075 in a player-enabled country.

## Edge cases and limits

- Endorsements are manual-only and election-scoped. They end when the campaign resolves, withdraws, goes inactive or the election ends, and must be requested again for the next race.
- Policy distance is clamped to 0 to 10, so the endorsement gate never exceeds 50.
- Boost favorability is refused with `target_at_cap` when favorability is 100, and boost influence at influence 100. Reduce actions are refused with `target_at_floor` at 0. The player is not charged for a no-op (`src/lib/capital/actions.ts`).
- Retired NPPs cannot be targeted (`npp_retired`). `request_endorsement` requires a candidacy (`missing_candidacy_context`).
- A tie zone of -5 to +5 abstains, except on veto-override votes (federal US override, Japanese Shugiin override, and state-bill overrides), where an abstain becomes `against`.
- US congressional leadership votes are player-only.
- A defending incumbent can refile even after dropping out of the same primary, because the cooldown only blocks fallback fill and challengers.
- Presidential auto-entry is blocked except in autonomy-active countries with no player-enabled presidency, and direct Russian first-round ballots.
- Multi-seat NPPs count their seat weight in one tally; an NPP votes once per bill per chamber.
- Technocrat NPPs never enter elections or vote. In one-party states banned-party NPPs do not vote.
- NPP influence decay is held at the floor of 10: an NPP seeded under the floor is held in place, not raised to it.
- Candidate scoring uses 10 for a missing or non-finite influence value, not as a floor.
- A bill from another country never receives an NPP's vote, even when office keys such as `senate` collide.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Verdict is a pure function of the four forces; the same inputs give the same vote | `src/lib/turn/npp/crossPressure.test.ts`, `crossPressure.v2.test.ts` |
| Each force is within -100 to 100 | `clamp100` in `crossPressure.ts`; tested in `crossPressure.test.ts` |
| An NPP votes at most once per bill and chamber | Skip on existing vote in `billVoting.ts` and `stateBillVoting.ts`; the federal case is tested in `billVoting.test.ts` ("skips an NPP that already voted") |
| An NPP never votes on another country's bill | Country guard in `billVoting.ts`; `billVoting.test.ts` (#0699) |
| An NPP is in at most one active race | Upsert keyed on `{ characterId, status: "active" }`; tested in `electionEntry.test.ts` |
| No ambitious challenger below autonomy v3 | `electionEntry.test.ts` |
| Direct actions cannot overdraw actions or funds; relationship stays in -100 to 100, favorability and influence in 0 to 100 | Conditional update and clamps in `src/lib/npps/commands/directAction.ts`; validation in `src/lib/capital/actions.test.ts` |
| Endorsement gate is `40 + min(10, distance)` | `src/lib/nppEndorsements.test.ts` |
| Party NPP capacity respects tiers and ceiling | `src/lib/npp/partyCapacity.test.ts` |
| Caucus retention floor and relationship drift | `src/lib/turn/partyOrg/caucusRelationshipMaintenance.test.ts` |
| Every counted vote has a stored forecast row | Not enforced; the bulk write after the bill update is not in the same transaction |

## Failure and recovery

- **A race is left without NPP candidates.** Usually a regional-presence gate or an unexpired cooldown. The next turn's fill retries; if a chamber was never seeded, the roster seed is re-run.
- **A bad vote on a bill.** Forces are persisted to `nppVotePredictions`, so a vote can be replayed. NPPs that already voted are skipped, so a wrong vote is repaired with a data heal on the bill rather than by waiting a turn.
- **A turn fails partway through NPP behaviour.** The next turn catches up: voting runs every turn and already-voted NPPs are skipped, so NPPs that gained seats after a bill opened still vote before it closes.
- **A direct action fails.** Spend, relationship, NPP stats and the audit row run in one transaction where available and are rolled back on failure; on a fallback path the action and fund refunds are applied explicitly.
- **A stale endorsement.** The next turn withdraws it with a reason (`manual_only`, `election_ended`, `relevance_lost`, `candidate_inactive`, `country_mismatch`).
- **Mortality.** NPP mortality runs before the shared context is built, so a dead NPP's successor and any withdrawn candidacies are visible to every downstream phase this turn.
- **Orphan or missing country data.** Entry is country-scoped; an NPP with a missing `countryId` is treated as `US`, so legacy rows should be healed to carry it.

## Connections

**Driven by:**

- [Party whips](./party-whips.md): whip direction feeds the whip force in `computeCrossPressureForces`.
- [Party slate](./party-slate.md): accepted Slate NPPs file second in the entry order.
- [Party influence](./party-influence.md): party actions change loyalty, stubbornness, favorability and influence.

**Affects:**

- [Bills and legislation](./bills-legislation.md): NPP votes decide bills in `billVoting.ts` and `stateBillVoting.ts`.
- [Campaign manager](./campaign-manager.md): arranged endorsements feed campaign-action generation and candidate enrichment.
- [Caucuses](./caucuses.md): NPP membership and ejection follow chair relationship.
- [Elections](./elections.md): NPP candidacies, handicaps and endorsements shape primaries and generals.

**Related docs:**

- [bills-legislation.md](./bills-legislation.md)
- [campaign-manager.md](./campaign-manager.md)
- [caucuses.md](./caucuses.md)
- [parties.md](./parties.md)
- [party-influence.md](./party-influence.md)
- [party-whips.md](./party-whips.md)
- [party-slate.md](./party-slate.md)
- [npp-opponents.md](./npp-opponents.md)

## Tests

| Area | Test files |
| --- | --- |
| Cross-pressure forces and verdict | `src/lib/turn/npp/crossPressure.test.ts`, `src/lib/turn/npp/crossPressure.v2.test.ts` |
| Federal and state voting | `src/lib/turn/npp/billVoting.test.ts`, `src/lib/turn/npp/stateBillVoting.test.ts`, `src/lib/turn/nppVoteLogic.test.ts` |
| Entry and priority | `src/lib/turn/nppEntryLogic.test.ts`, `src/lib/turn/npp/electionEntry.test.ts`, `src/lib/turn/rules/nppElectionPriority.test.ts` |
| Challenger rails | `src/lib/nppAutonomy/__tests__/playerImpactBudget.test.ts` |
| Slate | `src/lib/turn/npp/slateResponses.test.ts` |
| Endorsements | `src/lib/nppEndorsements.test.ts`, `src/lib/turn/npp/endorsements.test.ts` |
| Direct actions | `src/lib/capital/actions.test.ts`, `src/lib/npps/commands/directAction.crossCountry.test.ts` |
| Whip willingness | `src/lib/partyWhips/whipSuccess.test.ts` |
| Party capacity | `src/lib/npp/partyCapacity.test.ts` |
| Caucus upkeep | `src/lib/turn/partyOrg/caucusRelationshipMaintenance.test.ts` |
| Mortality | `src/lib/npp/mortality.test.ts` |
| Influence floor | `shared/constants/formulas.test.ts` |

Gaps: no test drives a full `processNPPTurn` from entry through votes; the caucus whip path is untested end to end because no caller feeds it; the charisma scaling of direct actions has no dedicated test.

## Known issues and history

- **Caucus whip is not fed to autonomous votes.** `crossPressure.ts` implements a caucus whip force (40, plus or minus 20 on core positions), but `billVoting.ts`, `stateBillVoting.ts`, `applyWhipVotes.ts` and the whip-count rule all pass `caucusWhip: null`. The player wiki ([NPP Behavior](https://www.ahousedividedgame.com/wiki/npp-behavior)) says a caucus whip pushes with 40. In the code it currently contributes nothing to a vote.
- **Earlier version of this page said the reduce actions had no relationship gate.** `reduce_favorability` and `reduce_influence` have a gate of -100 (`minRelationship` in `CAPITAL_ACTIONS`), which is effectively always met because relationship clamps at -100. The player wiki matches the code.
- **Earlier version of this page said `processSpeakerVoting()` is a no-op.** That function no longer exists. The turn pass simply casts no NPP leadership votes and reports `speakerVotes: 0`.
- **Earlier version of this page listed an "influence floor when scoring candidates" of 10.** In `candidateEnrichment.ts` 10 is the fallback for a missing value, not a floor. Corrected 2026-10-29.
- **Bug #0699 (history).** Foreign senators leaked into another country's Senate tally because several countries use the office key `senate`; fixed with a country guard.
- **`ambition` is unused by entry.** The trait is stored and displayed but challenger odds use the career-archetype `officeSeekingMult`.
- **Local voting scope.** State and regional bills are voted by the country's sub-national legislature key, so the exact offices depend on the country, not only `stateSenate` and `regionalCouncil`.

Last checked: 2026-10-29, version 1.18.0
