# The Cold War and conflict system (as shipped)

The persistent release 1.3 campaign layer is documented separately in [Global response crises (as shipped)](./global-response-crises-as-shipped.md).

## Summary

Player guide: [Conflicts & the Military System](https://www.ahousedividedgame.com/wiki/conflicts-overview). Per subsystem player pages: [Declaring War](https://www.ahousedividedgame.com/wiki/declaring-war), [Fighting a Battle](https://www.ahousedividedgame.com/wiki/fighting-a-battle), [Occupation, Territory & Victory](https://www.ahousedividedgame.com/wiki/occupation-and-victory), [Peace, Indemnities & Truces](https://www.ahousedividedgame.com/wiki/peace-and-truces), [A War, Start to Finish](https://www.ahousedividedgame.com/wiki/a-war-start-to-finish), [Manpower & Conscription](https://www.ahousedividedgame.com/wiki/manpower-conscription), [Generals & the Officer Corps](https://www.ahousedividedgame.com/wiki/generals), [National Doctrine](https://www.ahousedividedgame.com/wiki/national-doctrine), [Commands & Command Structure](https://www.ahousedividedgame.com/wiki/military-commands), [Units, Recruitment & Procurement](https://www.ahousedividedgame.com/wiki/military-units), [Defence Procurement](https://www.ahousedividedgame.com/wiki/defence-procurement), [Cold War Tension](https://www.ahousedividedgame.com/wiki/cold-war-tension) and [International Organizations](https://www.ahousedividedgame.com/wiki/international-organizations).

A House Divided models the Cold War as four connected layers: alignment (which way a nation leans, and who is buying that lean), international organizations (the channels blocs push through), the military (forces, generals, doctrine, budgets), and conflicts (live wars with a moving front, battle reports, and negotiated peace). Everything below is read out of the shipped code. Every constant quoted is the value in the repository today.

### What a player sees

The hub is `/world/conflicts` (`src/app/world/conflicts/page.tsx`). It lists every live conflict in the world on a map and in a list, with casualties per conflict pulled from battle reports. Each war has a public record page at `/world/conflicts/<conflictId>` (`src/app/world/conflicts/[conflictId]/page.tsx`): war goal, order of battle, command chain, momentum track, and a war log of up to 50 engagements (`BATTLE_LIMIT = 50`) over a 60 turn momentum window (`MOMENTUM_WINDOW = 60`), with 5 marked events.

Other surfaces in the same section:

- `/world/conflicts/situation`: the World Situation Board, where a country commits combat power to theaters and carries a war footing cohesion value.
- `/world/conflicts/blocs`, `/world/conflicts/orgs`, `/world/conflicts/coldwar`, `/world/conflicts/detente`, `/world/conflicts/politburo`, `/world/conflicts/kgb`, `/world/conflicts/station`, `/world/conflicts/active-measures`, `/world/conflicts/home-front`, `/world/conflicts/warsaw-pact`: Cold War framing boards.
- `/world/conflicts/military` is now a redirect into the Secretary of Defense office (Commands tab) for the viewer's country.
- `/world/conflicts/alignment` is retired and redirects to `/world/cold-war-ledger`, which reads the real `countryAlignments` collection for every nation instead of the old 16 nation mock.

The whole section is gated by the `conflictsEnabled` flag on game state (`src/lib/db/types/gameState.ts`, checked through `requireConflictsEnabled` in `src/app/world/conflicts/_coldwar/gate.ts`). With the flag off, every route bounces to `/world`.

## Rules

### Who can see what

`src/lib/military/conflictVisibility.ts` splits sight from authority. Tiers are `public`, `command`, and `archive`. Command sight needs both a belligerent country (by explicit roster membership, not bloc affinity) and a seat in its command structure: a posted general, the defence seat holder, the head of government, or a commanding general. Commanding generals get command sight but never command authority: declaring still runs through `canActAtTheater`.

A resolved war becomes an open record for everyone only after its fog window lapses: `CONFLICT_ARCHIVE_DELAY_TURNS = 480` turns after `endTurn` (`src/lib/military/conflictLifecycle.ts`, `isArchiveOpen`). Until then a freshly resolved war reads exactly as it did while it ran (own side for a belligerent seat, the public layer for everyone else), because the order of battle is still a live intelligence picture of nations that may fight again. Territory (`control`) is public in every tier. An admin account flag grants no tier.

`belligerentSideOf` deliberately does not use `sideOf`. `sideOf` falls back to matching a country's bloc against a side's backer, which is right for "whose ground does this unit take" and wrong for "may this person read the order of battle". A faction side (a proxy war's `factionEntity`) is matched by exact entity id only.

### Alignment: shares, not a slider

A nation's alignment is a set of shares, one per pole, plus a non aligned remainder (`src/lib/constants/alignmentEras.ts`). Poles depend on the live year, not just the era. The Cold War era (`fromYear: 1945`, `toYear: 1990`) is bipolar: `WEST` and `EAST`, with `WEST` counting positive on the derived -100 to +100 axis. The post Cold War era (`fromYear: 1991`) is `WASHINGTON`, `MOSCOW`, `BEIJING`.

Key values:

- `ALIGNMENT_GATES = { locked: 85, nonAligned: 20 }`, compared against the lead (leading pole share minus the runner up, `leadFor` in `src/lib/alignment/project.ts`). Past 85 a nation is immovable by drift; only a deliberate play can shift it.
- `PER_NATION_TURN_CAP = 5` share points per turn. `CRISIS_TURN_CAP = 7.5` while a crisis is open on that nation.
- Join gate by pole count (`JOIN_GATE_BY_POLE_COUNT`): 2 poles needs 50, 3 needs 40, 4 needs 35 (fewer than 2 reads 50, more than 4 reads 35).

`src/lib/alignment/drift.ts` is the tide (`computeDrift`). A nation whose lead is at or below the non aligned gate of 20 absorbs movement at `NON_ALIGNED_RESISTANCE = 0.5`. Opposing pulls cancel before the cap applies: each pole's net is `max(0, own pull - strongest rival pull)`, a pole being eroded (pull at or below 0) keeps its negative, so two blocs pushing equally hard leave the nation where it was, and allies on the same pole simply add. The surviving vector is `sum(|net|) × resistance`; if it exceeds the cap it is scaled down as one vector (`scale = cap / requested`) so the cap bounds the nation's whole turn. Gains come out of the uncommitted pool first (`normalizeShares`). Membership itself pulls: `MEMBERSHIP_PULL_PER_TURN = 0.04` times the channel weight, up to `MEMBERSHIP_PULL_CEILING = 67` (`membershipPullForTurn`).

`src/lib/alignment/crossing.ts` re runs once per era crossing, guarded by a stored era key. Surviving poles keep their share, superseded poles hand theirs to a declared successor (`inherit: { WEST: "WASHINGTON", EAST: "MOSCOW" }`), and anything with neither returns to the uncommitted pool.

### Influence plays: the rudder

`src/lib/alignment/influence.ts`. A play is a paid push through an organization channel. One play buys at most `PLAY_MAX_POINTS = 10` share points. Price is keyed to the target's own economy: `POINT_COST_GDP_SHARE = 0.001`, so 0.1% of the target's annual GDP buys one point, linearly (`pointsForSpend = min(10, amount / (targetGdp × 0.001))`; an unpriceable target returns 0, never free). Because a nation moves at most 5 points a turn, spending past roughly 0.5% of the target's GDP in one turn is visibly wasted. Points are multiplied by the channel weight, and a channel whose pole is not in the live pole set pulls nothing.

Channel weight scales every play. In the Cold War era, NATO carries weight 1 toward `WEST` and the Warsaw Pact weight 1 toward `EAST`, both with `alignmentAccession: true`. In the post Cold War era NATO carries weight 1 toward `WASHINGTON` (accession) and the EU weight 0.6 toward `WASHINGTON` (influence only); Moscow and Beijing have no surviving bloc org and act through their leader country. The Commonwealth deliberately carries no channel: stacking it behind NATO gave the West a permanent 1.75 to 1 advantage the Warsaw Pact could not answer.

Nothing fires automatically. Rivals cancel only by spending.

### Membership and defection

`src/lib/alignment/membershipEligibility.ts`: `JOIN_SHARE = 60`, `LEAVE_SHARE = 40`, `SUSTAIN_TURNS = 24`. A non player nation that holds a share above the join gate for the sustain window asks to join an alignment accession org; one that falls below the leave share starts a `wantsOutSinceTurn` run and eventually walks. Orgs whose membership is not decided by Cold War alignment (the Commonwealth, the EU) still act as influence channels but never auto recruit or auto expel.

### Bloc stress

`src/lib/alignment/blocStress.ts` prices holding an alliance together as a 0 to 1 gauge over a bloc's own members, weights summing to 1: contested members 0.45 (`CONTESTED_WEIGHT`), members heading for the door 0.35 (`WANTS_OUT_WEIGHT`), recent accessions 0.2 (`DIGESTION_WEIGHT`). A member counts as contested when a rival pole holds at least `CONTESTED_RIVAL_MIN = 25` of it. Digestion of a new member decays over `DIGESTION_WINDOW_TURNS = 12`. Raw member count is deliberately not an input: size alone is not strain. The effect is a dampener on the bloc's own plays, `1 - STRESS_MAX_DAMPING × stress` with `STRESS_MAX_DAMPING = 0.4`, so a fully stressed bloc is impaired, never inert.

### Flashpoints and crises

Two crisis systems ship, and they are separate things.

Alignment crises (`src/lib/alignment/crisis.ts`, `crisisTurn.ts`, `crisisCatalog.ts`) mark a nation as unusually movable. A crisis has no payout of its own: it raises that nation's ceiling from 5 to 7.5 for `CRISIS_WINDOW_TURNS = 12`, so a crisis nobody acts on changes nothing. At most `MAX_OPEN_CRISES = 3` are open at once. Targets come from two sources: authored crises with era windows (for example Prague Spring, `crisis.pragueSpring`, target `CS`, years 1968 to 1970), and emergent ones (`emergent.tugOfWar`, `emergent.defection`). A tug of war candidate needs the runner up pole holding at least 25 and a lead no wider than the non aligned gate of 20. A defection crisis opens once a member is halfway to walking out, `SUSTAIN_TURNS / 2 = 12` turns.

National crises (`src/lib/db/types/crisis.ts`) are the decision tree events: choice, collective, terminal, and aid nodes, with effects typed `flat`, `tick`, or `decay` and targeting metrics, approval, profit margin, inflation, `gdpLoss`, or a character stat. `gdpLoss` is a one time fraction of regional GDP destroyed; the growth rate path is the ongoing drag. Under the plants market tier a `profitMargin` effect marked `physicality: "physical"` becomes a production haircut (`productionFactor *= 1 - |value|/100`) instead of a thinner margin; absent means `financial`, which is load bearing because live crises carry snapshotted effects. Global crises collect one `CrisisLeaderResponse` per affected head of state, each applied to that leader's own country.

### International organizations

`src/lib/internationalOrganizations/`. Existence is derived, not persisted: `isOrganizationFounded` (`founding.ts`) compares `def.foundedYear` and `dissolvedYear` against the live game year, with a has members override so a year rollback cannot vanish a populated org. Founding years in `src/lib/constants/internationalOrganizations.ts`: UN 1945, NATO 1949, Commonwealth 1949, Comecon 1949 (dissolved 1991), the Warsaw Pact 1952 (pulled earlier than the real 1955 so the first Cold War preset includes it; dissolved 1991; the 1953 roster adds Albania), the Non Aligned Movement 1961, and the EU 1993 (it auto founds, empty, when the live year reaches 1993; an EEC lineage stage `community` uses 1958 via `europeanIntegration`).

Mechanics that ship:

- `DIPLOMATIC_ACTIONS_PER_TURN = 4` per country (`src/lib/constants/internationalOrganizations.ts`).
- `ORG_PROPOSAL_VOTING_TURNS = 24`, re exported as `PROPOSAL_VOTE_WINDOW_TURNS`.
- Assessed contributions at `ORG_ASSESSED_RATE = 0.005` of member GDP (`orgDerivedMetrics.ts`).
- Joint statements: endorsing moves approval by `JOINT_STATEMENT_ENDORSE_APPROVAL = +2`, condemning by `JOINT_STATEMENT_CONDEMN_APPROVAL = -3`, and the effect lasts `JOINT_STATEMENT_DURATION_TURNS = 24` (`jointStatement.ts`).
- Aid converts money to a growth boost logarithmically: `AID_BOOST_PER_LOG10_USD = 0.05` per order of magnitude of USD, capped at `AID_BOOST_MAX_GROWTH = 0.5` added to `economic.gdpGrowth.value` (`aid.ts`).
- Joining, funding, and leaving all run as legislation (`membershipBills.ts`), with founding member seeding in `ensureFoundingMembershipsAndLeadership` (`service.ts`).

### The military layer

Forces. Starting rosters come from `src/lib/seeds/reference/ordersOfBattle.ts` (per country tables in `src/lib/countries/<code>/institutionsFacts.ts`), which authors composition only: names, veterancy, readiness, posture, XP and equipment stay generated from the seeded RNG. Rosters are calibrated to 1953 because DD, CS and YU do not exist in 2019, with era override tables for some countries (for example 1991 and 1999). Russia fields 12 Infantry Divisions, 5 Armored, 5 Mechanized Brigades, 4 Artillery Regiments, 3 Air Defense Battalions, 4 Attack Submarines, 3 Frigate Squadrons, 1 Amphibious Group, 4 Fighter Wings, 3 Bomber Squadrons and 5 PVO Air Defense Wings. East Germany fields 3 Infantry Divisions, 2 Mechanized Brigades, 1 Artillery Regiment, 1 Frigate Squadron, 2 Fighter Wings and 1 Air Defense Wing. A branch a country's table does not name keeps random generation, so a 1953 table does not delete Russia's 1959 rocket force from a later era game.

Commands. `src/lib/military/config.ts` defines three command types (`HOMELAND_DEFENSE`, `REGIONAL`, `LOGISTICS`), twelve postures from Defensive through Training / Reserve, and a `REGION_CAP = 3` regions per command. Effectiveness thresholds are `EFF_THRESHOLDS = { good: 82, ok: 70 }`. `CAPACITY` penalties: `noCommanderPenalty = 10` effectiveness for no commander, `overCapacityFactor = 1.6` per point of force load over capacity, `effFloor = 20`.

Theater command. One general is `inCharge` of a conflict. Their bonus applies once front wide at `THEATER_COMMAND.bonusShare = 0.25` of their own combat value edge, so a strong theater commander never replaces good generals on the units. They earn `xpShare = 0.5` of what a general leading one average formation at that front would earn, measured that way so a superpower's commander does not level many times faster than a small nation's for the same work.

Generals. `src/lib/military/generals.ts` sets ranks Brigadier, Major General, Lt. General, General, Field Marshal at XP thresholds `GENLVLXP = [0, 100, 250, 460, 740]`, `WIN_BONUS_XP = 45`, `LOSS_BONUS_XP = 20`, `POINTS_PER_PROMOTION = 4`, then `POST_FM_XP_PER_POINT = 200` past Field Marshal up to `POST_FM_POINT_CAP = 15`. Tenure grants a point every `TENURE_POINT_TURNS = 24` up to `TENURE_POINT_CAP = 20`. The trait tree lives in `src/lib/military/generalsTree.ts`: categories such as Command Style with paths Aggressive, Cautious, Flexible and Disciplinarian, each node carrying a decade gate and structured mods (`cv`, `cas`, `enemy`, `supply`, `upkeep`, `ready`). Nodes conflict with each other by name: Shock Commander conflicts with Cautious Commander, Methodical Commander with Aggressive Commander.

Doctrine. `src/lib/military/doctrineTree.ts` runs 15 decades (`DECADES`, 1900s to 2040s) and 15 era labels (`ERASHORT`: Industrial, Great War, Interwar, Mechanization, Total War, Nuclear Age, Counterinsurgency, Precision, Air-Land, Expeditionary, Network-Centric, Cyber-Hybrid, Multi-Domain, Autonomous, Integrated), grouped as Army, Navy, Air, Logistics and Command (`GRP`). The current era is `floor((year - 1900) / 10)` clamped to the decade range. Nodes carry costs in doctrine points (`DEFAULT_POINTS = 12`), named prerequisites, and conflicts, with mods `cvAll`, `cvDom`, `cvTrait`, `upkeep`, `supply`, `xp`, `ready`, `deep`, `joint`. Doctrine nodes can boost matching general trait nodes through the `boost` field on the trait tree.

Budget. `src/lib/military/appropriation.ts` accrues the annual defence line evenly over the game year (one forty-eighth per turn). `SEED_UPKEEP_TARGET_SHARE = 0.55` is the one balance dial: a nation at its historical starting force spends 55% of its defence budget sustaining it. Double the roster and upkeep is 110% of the budget, which means overdraft and then arrears. The overdraft floor is one full year's line (`overdraftFloor`, 0 when there is no usable line). Upkeep is funded continuously rather than all or nothing, so a force 10% beyond budget sags slightly instead of collapsing. Settlement returns a delta applied as an atomic increment, never an absolute write, so concurrent spends compose.

Procurement (unit pricing). `src/lib/military/procurement.ts` prices archetypes off GDP with `ARCHETYPE_COST_GDP_DIVISOR = 387_000` and half indexation (`MILITARY_PRICE_INDEXATION = 0.5`: `anchor = baselineGdp × (gdpNow / baselineGdp)^0.5`). Upgrades cost a share of unit price by tier: `UPGRADE_COST_SHARE = { 1: 0.25, 2: 0.35, 3: 0.5 }`.

Arsenal and materiel. `src/lib/military/arsenal.ts` runs equipment as lots: `LOT_COST_UNITS = 387` cost units per lot (the archetype divisor over 1,000), materiel is `MATERIEL_SHARE_OF_UNIT_COST = 0.2` of a unit's price (`LOT_COST_SHARE = 0.2 / 1000`), and equipment grades run to `EQUIPMENT_TRACK_MAX = 3`. Lots produced by a plant come from its strategy and revenue (`rawLotsFromSector`), and the share diverted from the civilian economy is tracked per sector (`militaryDivertedShare`).

Manpower and conscription. `src/lib/military/manpower.ts` gives five stances, each scaling the pool and gating whether green conscripts may be drawn at all:

- All-Volunteer Force, pool multiplier 0.6, no conscription.
- Limited Service, 0.8, no conscription.
- Selective Service, 1.0, conscription allowed.
- National Service, 1.4, conscription allowed.
- Universal Conscription, 2.0, conscription allowed.

Defaults (`DEFAULT_STANCE`) are US selective, UK national, RU universal, DD universal; every other country falls back to limited. For the four playable nations the stance is driven by a defence secondary law (`RESERVE_LAW_BY_COUNTRY`: `us.sec.reserveForces`, `uk.sec.territorialReserves`, `ru.sec.reservesVoluntaryDefense`, `dd.sec.reservesVoluntaryDefense`), whose five levels are the ladder. The ceiling is `floor(population × ATTRITION.manpowerPoolCapFraction × poolMult)` and pools start at `MANPOWER_START_FRACTION = 0.25` of it.

Readiness. `src/lib/military/readinessDrift.ts` drifts each unit toward the baseline for its posture in steps of `READINESS_DRIFT_STEP = 8`. Unpaid upkeep bites here: the baseline is multiplied by `1 - arrearsRatio × ARREARS_READINESS_WEIGHT` with `ARREARS_READINESS_WEIGHT = 0.35`, so a country that cannot fund its force finds it degrading rather than vanishing.

Geography. `src/lib/military/regions.ts` holds the strategic region table commands are assigned over, grouped by theater, and `regionThreat.ts` computes a threat level per region from live conflicts. A conflict derives its `region` from its host country, so declaring a war puts the pin on the map with no extra input.

State arms. Planned economies get state arms output outside contracts (`STATE_ARMS_INDUSTRY = { RU: 3, DD: 1 }` lots per turn) and every other country has a one lot per turn floor for a domain whose store is at zero (`MATERIEL_FLOOR_LOTS = 1`), both in `src/lib/military/stateArmsIndustry.ts`.

### Defence contracts

`src/lib/db/types/defenceContract.ts` and `src/lib/turn/defenceDeliveryTurn.ts`; the full guardrail set (tenders, window caps, price band, self dealing, termination) is in [Defence Procurement](./defence-procurement.md). A defence seat awards a standing order to one of its own country's defence plants through a public tender. Statuses are `pending`, `active`, `complete`, `cancelled`, `declined`: a tender award creates the order `active`; `pending` is where a legacy direct offer starts until the supplying CEO accepts, and a CEO's refusal is recorded separately from the minister's cancellation.

Contracts are domestic only, and that is a hard payment safety constraint rather than a simplification: `liquidCurrencyCode` is absent on pre forex corporations and six Eastern Bloc countries have no exchange rate document at all, so cross border payment would silently mis denominate. `canSupply` enforces both the same country and a matching currency.

The component is resolved from the sector's strategy at award and frozen, so a plant that re tools mid contract makes the order undeliverable rather than differently deliverable. `pricePerLot` is struck at award in local currency and does not drift with GDP.

Per turn, deliveries are capped four times in order: what the plant produced, what remains on the order, what the order's encumbrance (or, for legacy orders, the uncommitted appropriation) covers, and the per turn spend cap. Procurement has no overdraft (the overdraft exists for upkeep, an obligation already incurred), so a country that cannot pay takes fewer lots and the contract waits. Recording precedes payment: the lot record is written first and reversed if the idempotent money move does not apply, so a failure leaves nothing to reclaim. Delivered grade is the tightest of the supplier's research ceiling, the order's own ceiling and the era ceiling (`maxTechTierForPreset`, mirroring the seeder's `MAX_TECH_TIER_BY_ERA`).

### The Situation Board

`TheaterStateDoc` (`src/lib/db/types/theaterState.ts`) holds one row per country: a war footing `cohesion` value and a `committed` map of combat power per theater. Available, reserve and total are not stored: they are derived from the live unit pool by `src/lib/military/theaterPool.ts`, so the board can never disagree with the roster. A unit's `theaterId` is either a conflict id or the string `"reserve"`.

The board page (`src/app/world/conflicts/situation/page.tsx`) loads the viewer's country units, that country's theater state, the era's live bloc roll (`loadMilitaryBlocs`), and every active conflict, then hands all four to the client. Bloc membership is read per era rather than from a static table: the old static 9 entry lookup fell back to the US row for unknown countries, which quietly enrolled Warsaw Pact members into NATO.

### Conflicts: declaring a war

`src/lib/db/types/conflict.ts` replaced four hardcoded static theaters with dynamic conflicts. A world starts with none. Types are `interstate`, `intervention`, `civil_war`, `independence`, and `cold_war` (a proxy war fought on third party soil between internal factions); statuses `active`, `escalating`, `winding_down`, `terms_pending` and `resolved`. Each conflict has a host country (the map anchor, not necessarily a belligerent), two sides with rosters and optional bloc backers, terrain, severity, per side supply, a terrain combat factor `terr`, an `infra` supply throughput baseline, and an `enemyMix` for generated forces. `conflictId` is the public 1 based number in the URL; `_id` is the internal theater key units and reports reference and therefore cannot be renumbered.

Declaring runs as legislation (`src/lib/military/validateDeclareWar.ts`, `declareWar.ts`). `WAR_DECLARATION_COOLDOWN_TURNS = 120` (`src/lib/military/warGoals.ts`) counted from the last proposal (`bills` with a `declare_war` provision, newest `proposedTurn`), not the last passage, because a declaration the chambers threw out still spent diplomatic capital. A turn is one real hour, so 120 turns is five days of play. A truce between the pair (`activeTruceExpiry`) is a separate per pair bar. War goals (`warGoals.ts`) are `conquest`, `regime_change`, `punitive`, `liberation`; conquest is present in the type but marked `selectable: false` because nothing transfers territory yet, and both the picker and the bill validator read that same flag (`isSelectableWarGoal`) so a hand rolled API request cannot submit it.

One war per pair, re checked at enactment and not only at proposal (`findWarBetween`). If a live conflict already exists hosted in the defender, the declarer enrols on the opposing side instead of opening a parallel war over the same ground. A declaration against a fellow member of the declarer's own alliance is refused.

### Battles and territory

A `BattleDeclarationDoc` is a committed offensive by one nation against a specific enemy nation at a theater. It resolves on the turn after `declaredTurn` (`declaredTurn < currentTurn`), giving the defender a window to reinforce or withdraw, then is marked `resolved` or `fizzled` when the target had no forces present (status `pending`, `resolved`, `fizzled`). Simultaneous declarations merge into coalition offensives (`src/lib/military/coalition.ts`), with the earliest declaration as principal attacker.

`BattleReportDoc` records the result for both War Rooms: full attacker and defender lists, casualties, `noContact`, `unopposedAdvance`, and `controlBefore` / `controlAfter` so a player who won can see what winning achieved.

Verdicts (`src/lib/military/battle.ts`, with `margin = f - h`, the attacker's remaining strength less the defender's): a win with margin above 45 is a Decisive Victory, above 15 a Victory, any other win Pyrrhic, a loss with margin above -30 a Costly Defeat, worse a Rout.

Territory (`src/lib/military/occupation.ts` with `OCCUPATION` in `config.ts`). `control` is side B's share of the host country's territory, 0 to 100. A war starts at the host's own pole when the host is a belligerent, and at 50 when it is not. The shift per battle is

`shift = min(1, |margin| / decisiveMargin) × maxShift × (loserRetreated ? retreatYield : 1) × mobilizationFactor(turnsElapsed)`

with `decisiveMargin: 45`, `maxShift: 5`, `retreatYield: 0.7`, and `mobilizationFactor = min(1, mobilizationFloor + (1 - mobilizationFloor) × turns / mobilizationTurns)` where `mobilizationFloor: 0.4` and `mobilizationTurns: 50`, so a coalition that needs time to mobilise is not shut out of a war already decided. Control is clamped to 0..100. Advances no longer halve at depth (the old `deepPushMult` drag was removed, and the supply penalties below slow a deep push instead); `deepPushDepth: 0.75` marks when a war reads as winding down, measured as progress from the starting line (`frontProgress(control, controlStart) >= 0.75` sets `winding_down`). Supply is derived from displacement rather than accumulated, so a front that swings back also recovers: `derivedSupply = clamp(round(baseline - penalty), minSupply, 100)` where the penalty is `compressionPenalty: 40 × |gain|` when the side's ground change `gain` is negative and `overextensionPenalty: 15 × gain` when positive, with `minSupply: 10` and `supplyNeutral: 60` the neutral point.

### Ending a war

How a war ends depends on its type.

- **Non proxy wars** (`eligiblePoleVictor`, `src/lib/military/rules/warResolution.ts`): a side wins only when `control` sits at its pole (0 for side A, 100 for side B), the pole was reached by movement (`poleSide` and `poleSinceTurn` are stamped on arrival, so a defender's opening position is not a free win), and the war is at least `MIN_NON_PROXY_WAR_TURNS = 24` turns old. A turn sweep (`resolveMatureWarPoles`) finalizes wars that reached a pole earlier than that age.
- **Proxy wars** (`cold_war`): resolved by `resolveColdWarHolds` once a bloc has held a pole for `POLE_HOLD_TURNS = 3` turns (`src/lib/turn/coldWarHolds.ts`).
- **Terms window**: `finalizePoleVictory` (`src/lib/military/finalizePoleVictory.ts`) moves a won war to `terms_pending` with a `termsWindow` of `DICTATE_WINDOW_TURNS = 24` turns (`src/lib/military/principal.ts`), stands every belligerent down, and lets the victor's principal country impose one term on the other principal. If the window lapses unused, a real turn sweep (`resolvePeaceWindows`, `src/lib/turn/peaceWindows.ts`) resolves the war as a white peace (a settlement stamped as an indemnity of 0 by the target, ending type `expiry`) so a victor who never logs in cannot leave it pending forever. A generated side, or a side whose founder already made separate peace, has nobody to address and resolves directly. A war in `terms_pending` still counts as live for pair checks, so no second war can be declared between the pair while terms are outstanding.
- `resolveConflict` records the outcome, then walks every belligerent out through the same `standDownCountry` path (`src/lib/military/leaveConflict.ts`) a separate peace uses, so the two cannot drift.

Negotiated exits use `PeaceOfferDoc` (`src/lib/db/types/peaceOffer.ts`; statuses `pending`, `accepted`, `rejected`, `withdrawn`, `expired`). An offer is struck between two countries, not two sides: the leaver drops off its roster and the war continues for everyone else. That follows the consent rule already shipped for coalition offensives (no player commits another player's army) and avoids whole side peace freezing a war forever because one inactive country can never consent. An offer stands `PEACE_OFFER_DURATION_TURNS = 72` turns and then lapses. An offer that would end the war for everyone (it empties a side's roster including treaty guests, or it is principal to principal) is blocked unless the asker's progress from the starting line is at least `PRINCIPAL_BUYOUT_PROGRESS = 0.75` (`withdrawalGate`, `src/lib/military/peaceOffer.ts`).

A settlement carries exactly one term (`PeaceTerm`, `src/lib/military/peaceTerm.ts`): `white_peace`, `indemnity` (explicit payer and amount), `regime_change` (target government system), `demilitarisation` (`turns`, default `DEMILITARISATION_DEFAULT_TURNS = 240`, maximum `DEMILITARISATION_MAX_TURNS = 480`; it bars the target from awarding new defence contracts, see [Defence Procurement](./defence-procurement.md)) or `reunification`. The indemnity names an explicit payer, because either party may pay (a loser buying out, or a winner paying to disengage), is always quoted in the payer's local currency, and is capped at `PEACE_INDEMNITY_MAX_GDP_SHARE = 2` times the payer's GDP (`maxIndemnityForGdp`). `amount: 0` is a clean indemnity of nothing (the war record still names a winner); a `white_peace` term applies nothing and the caller stamps a stalemate rather than a victor. `reunification` is valid only on a war the German Question is riding and needs the challenger at the table. A payer with no usable GDP has no indemnity ceiling (`maxIndemnity` is null).

Any war ending, negotiated or won outright, starts a truce of `TRUCE_TURNS = 240` for every cross side pair (`src/lib/military/truce.ts`). Truce documents key on the sorted country pair (`trucePairId`) and extend with `$max`, so overlapping writes can never shorten a truce already in force. Without this, a country conquered on turn 100 could be re declared on the moment the attacker's 120 turn cooldown lapsed, at the point it is least able to resist.

## Data

| Collection | Access | Fields and visibility |
| --- | --- | --- |
| `conflicts` (`ConflictDoc`, `src/lib/db/types/conflict.ts`) | read and written | `conflictId`, `type`, `status`, `hostCountry`, `sideA`/`sideB` (`countries`, `kind`, `backer`, `factionEntity`, `tokenStrength`), `control`, `controlStart`, `poleSide`, `poleSinceTurn`, `startTurn`, `endTurn`, `termsWindow`, `supplyA`/`supplyB` and bases, `treatyEntries`, `joinTurns`. Public record page shows goal, rosters (by tier), momentum and control. |
| `battleDeclarations` (`BattleDeclarationDoc`) | read and written | `theaterId`, `declaredTurn`, `status` (`pending`, `resolved`, `fizzled`). Visible to the declaring nation and the target. |
| `battleReports` (`BattleReportDoc`) | written | Attacker and defender lists, casualties, `noContact`, `unopposedAdvance`, `controlBefore`, `controlAfter`. Visible by tier. |
| `peaceOffers` (`PeaceOfferDoc`) | read and written | Parties, leaver, one term, `status`, `expiresTurn`. Visible to the two countries; accepted terms are published on the conflict record. |
| `truces` (`TruceDoc`) | written | Sorted pair id and `expiresTurn`. |
| `theaterState` (`TheaterStateDoc`) | read and written | Per country `cohesion` and `committed` map. Shown on the Situation Board. |
| `militaryUnits`, `militaryFormations` | read and written | Unit `theaterId`, personnel, readiness, equipment; formation `conflictAssignments`. |
| `countryAlignments` | read and written | Per nation pole shares, era key, `wantsOutSinceTurn`; shown on the Cold War ledger. |
| `internationalOrganizations`, `organizationMemberships` | read and written | Membership, funding, leadership. |
| `defenceContracts`, `nationalArsenal`, `federalBudget` | read and written | See [Defence Procurement](./defence-procurement.md). |
| `bills` | read and written | War declarations and org membership bills. |
| `gameState` | read | `conflictsEnabled`, preset and live year. |

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `gameState.conflictsEnabled` | absent (off) | Admin action; stored on the game state singleton (`src/lib/db/types/gameState.ts`); gates every conflicts route and `resolveMatureWarPoles`, `resolveColdWarHolds`. |
| Alignment era table (`ALIGNMENT_ERAS`) | cold-war 1945 to 1990, post-cold-war 1991 on | `src/lib/constants/alignmentEras.ts` |
| `ALIGNMENT_GATES`, `PER_NATION_TURN_CAP`, `CRISIS_TURN_CAP`, join gates | 85/20, 5, 7.5, 50/40/35 | `src/lib/constants/alignmentEras.ts` |
| Drift, membership, stress and influence constants | see Rules | `src/lib/alignment/*.ts` |
| Org founding years, rosters per era, `DIPLOMATIC_ACTIONS_PER_TURN`, `ORG_PROPOSAL_VOTING_TURNS` | see Rules | `src/lib/constants/internationalOrganizations.ts` |
| Orders of battle by country and era | see Rules | `src/lib/countries/<code>/institutionsFacts.ts`, `src/lib/seeds/reference/ordersOfBattle.ts` |
| `OCCUPATION`, `CAPACITY`, `THEATER_COMMAND`, `EFF_THRESHOLDS`, `REGION_CAP` | see Rules | `src/lib/military/config.ts` |
| Conscription stance per country | US selective, UK national, RU universal, DD universal, others limited | `DEFAULT_STANCE` in `src/lib/military/manpower.ts`, overridden by the reserve law in `RESERVE_LAW_BY_COUNTRY` |
| `SEED_UPKEEP_TARGET_SHARE` | 0.55 | `src/lib/military/appropriation.ts` |
| War declaration cooldown, selectable goals | 120 turns; conquest off | `src/lib/military/warGoals.ts` |
| Peace and truce constants | 72, 240, 24, 480 | `src/lib/db/types/peaceOffer.ts`, `src/lib/military/principal.ts`, `src/lib/military/peaceTerm.ts`, `src/lib/military/conflictLifecycle.ts` |
| `MIN_NON_PROXY_WAR_TURNS`, `POLE_HOLD_TURNS` | 24, 3 | `src/lib/military/rules/warResolution.ts`, `src/lib/turn/coldWarHolds.ts` |
| Era grade ceiling for deliveries | by preset | `maxTechTierForPreset` in `src/lib/admin/seed/seedMilitaryUnits.ts` |
| `defenceProcurementPaused` | absent (false) | `gameState` |

## Timing

The systems on this page run at different points of the turn pipeline (`src/simulation/phases/turnPhaseNames.ts`):

| Order | Phase | What runs |
| --- | --- | --- |
| 1 | `internationalOrganizations` | the organization batch; it writes the memberships that alignment drift reads, so alignment must not join it |
| 2 | `alignment` | per country: cross the era first, then gather membership channels, queued influence plays and the counter-plays they provoke into one vector, drift once (so plays share the per-nation cap with drift), open and close alignment crises, snapshot pre-drift shares (`src/lib/turn/alignmentPhase.ts`) |
| 3 | `settlement`, `mutualDefence` | settlement, then treaty defence reconciliation (`reconcileMutualDefence`) so a defender's alliance joins a war |
| 4 | `crisisTurn` | national crisis decision-tree events |
| 5 | `intelligenceTurn` | intelligence upkeep, so later sabotage lands on this turn's dispositions |
| 6 | `navairOperations` | sea control, air superiority and supply are made current |
| 7 | `ministerialOrders` | appropriation accrual, defence deliveries, state arms, naval repair, refit, nuclear production, then resolves battle declarations that were declared on an earlier turn, cold war pole holds and mature war poles; the lapsed terms window sweep (`resolvePeaceWindows`) runs from `processMinisterialOrders` |

```
turn N
  internationalOrganizations -> alignment -> settlement -> mutualDefence
  crisisTurn -> intelligenceTurn -> navairOperations -> ministerialOrders
      ministerialOrders: appropriation -> deliveries -> state arms -> repair/refit
                         -> battle declarations (declaredTurn < N) -> cold war holds -> mature poles
war lifecycle:
  declaration bill (cooldown 120) -> conflict opens (control at host pole or 50)
  -> offensive declared turn D -> resolves turn D+1 -> control shifts
  -> pole reached -> (24 turn minimum age) -> terms_pending (24 turn window)
     or peace offer (72 turn window) accepted -> stand down -> truce 240 turns
```

Battle resolution reads dispositions after steps 5 and 6, and runs the turn after a declaration (`declaredTurn + 1`), giving the defender one turn to reinforce or withdraw. Defence contract deliveries and upkeep settlement run in their own turn modules (`src/lib/turn/defenceDeliveryTurn.ts`, `src/lib/turn/defenseAppropriationTurn.ts`), both inside `processMinisterialOrders` in `src/lib/turn/ministerialOrderProcessing.ts`. Peace offers lapse after `PEACE_OFFER_DURATION_TURNS = 72` turns, and a truce is written when a war ends (`src/lib/military/truce.ts`). The calendar has 48 turns per game year (`TURNS_PER_YEAR`, `src/lib/constants/calendar.ts`) and one turn is one real hour.

## Worked trace

Country A proposes a war declaration against country B on turn 1000. A cannot propose another until turn 1120 (`WAR_DECLARATION_COOLDOWN_TURNS = 120`, counted from the proposal even if the chambers reject it). The chambers pass it; no war between the pair is already live, so the conflict opens with `control` at B's pole if B is the host and a belligerent, or 50 if the host is neutral.

Turn 1010 A's offensive resolves (it resolved the turn after it was declared). The report shows a win by margin 20: 20 is above 15 and not above 45, so the verdict is **Victory**. The front shifts by `min(1, 20 / 45) × 5 = 2.22` points. If the war is 25 turns old the mobilisation factor is `0.4 + 0.6 × (25 / 50) = 0.7`, so the actual move is 1.56 points. If B's forces had withdrawn in good order, multiply by `retreatYield = 0.7` again for 1.09.

A margin of 60 at full mobilisation (turn 50 of the war or later) is a Decisive Victory and moves the full 5 points, so a front starting at 50 needs ten such wins to reach the pole, and an interstate front starting at the defender's own pole needs twenty. Once at the pole and at least 24 turns old, the war moves to `terms_pending` and A's principal has 24 turns to name one term. When the war ends, a truce of `TRUCE_TURNS = 240` starts for every cross-side pair, so A and B cannot be re-declared against each other before 240 turns pass, which also outlasts A's 120 turn cooldown.

Supply on the same front: B starts with a baseline of 60 and A pushes the control from 100 down to 60 (gain `(100 - 60)/100 = 0.4` for A, `-0.4` for B). B's supply is `round(60 - 40 × 0.4) = 44`; A's is `round(60 - 15 × 0.4) = 54`. Retaking ground restores both.

Influence trace: a target with annual GDP of 2,000,000 (in the play's currency) costs `0.001 × 2,000,000 = 2,000` per share point, so a 10 point play (`PLAY_MAX_POINTS`) costs 20,000, and a nation moves at most 5 points per turn (7.5 in an open crisis), so a single turn's push beyond 10,000 is wasted against the cap.

Drift trace: a nation at WEST 30, EAST 25 and 45 uncommitted has a lead of 5, so resistance is 0.5. The West spends 20,000 (10 points, NATO weight 1 gives pull 10 on WEST) and the East counter-spends 6,000 (3 points on EAST). Net pulls: WEST `max(0, 10 - 3) = 7`, EAST `max(0, 3 - 10) = 0`. Requested movement is `7 × 0.5 = 3.5`, below the cap of 5, so WEST becomes 33.5, EAST stays 25 and the uncommitted pool falls to 41.5. Had the East not answered and the nation been at a lead of 30 (resistance 1), the requested 10 would be scaled by `5 / 10` to a gain of exactly 5.

## Edge cases and limits

- **Alignment caps**: 5 share points per turn per nation, 7.5 in an open crisis, at most 3 open crises.
- **Locked nations**: past 85 lead a nation is immovable by drift; at or below 20 lead it is non-aligned and absorbs movement at half strength.
- **Zero**: `amount: 0` in a peace offer indemnity moves no money; an influence play with no spend, or against an unpriceable (zero GDP) target, moves nothing.
- **Cooldown**: counted from the last proposal, so a rejected declaration still costs the 120 turns.
- **One war per pair**: checked at enactment as well as proposal. If a live conflict is already hosted in the defender, the declarer enrols on the opposing side instead.
- **Conquest**: the `conquest` war goal exists in the type but is not selectable, because nothing transfers territory yet; the API enforces this too.
- **Control track**: 0 to 100, ends the war on reaching a pole (subject to the 24 turn minimum age for non proxy wars and the 3 turn hold for proxy wars). Supply never falls below 10.
- **Opening position is not a victory**: a defender who starts at its own pole has no pole stamp, so the age gate cannot hand it a free win.
- **Generated sides**: a side with an empty roster is a generated force; `sideWouldEmpty` requires a non empty roster so every insurgency does not read as an emptied side.
- **Legacy conflicts** with no `startTurn` are treated as old enough to finish, and a missing turns elapsed value disables the mobilisation ramp rather than writing NaN to `control`.
- **Domestic contracts only**: defence contracts require the same country and a matching currency, so a cross-border order cannot be placed.
- **No procurement overdraft**: upkeep may overdraw up to one year of the defence line, procurement may not, so a country that cannot pay gets fewer lots.
- **Fog**: a belligerent is decided by explicit roster membership, never bloc affinity, so an ally's bloc does not grant command sight; a resolved war stays fogged for 480 turns.
- **Indemnity ceiling**: at most 2 times the payer's GDP; a payer with a missing or non positive GDP has no ceiling applied. The indemnity may be paid by either party, and a negative or non finite amount is refused.
- **Feature flag**: with `conflictsEnabled` off every conflicts route redirects to `/world`, and the pole sweeps do nothing.
- **Excluded by design**: the Commonwealth carries no influence channel; raw bloc size is not an input to bloc stress.

## Invariants

- Alignment shares sum to 100 including the uncommitted pool and stay within the live pole set. Enforced by `normalizeShares`; tested in `src/lib/alignment/normalize.test.ts`.
- A locked nation does not drift and a nation moves at most the per turn cap. Tested in `src/lib/alignment/drift.test.ts`.
- `control` stays within 0 to 100. Enforced by clamping in `occupationShift`; tested in `src/lib/military/occupation.test.ts`.
- A war cannot end at a pole before `MIN_NON_PROXY_WAR_TURNS`, and an opening position never counts. Tested in `src/lib/military/rules/warResolution.test.ts` and `finalizePoleVictory.test.ts`.
- A truce never shortens (the `$max` write). Tested in `src/lib/military/__tests__/truce.test.ts`.
- Roster, assignment and unit theater pointers are reconciled when a country leaves a conflict (`standDownCountry`). Tested in `src/lib/military/__tests__/leaveConflict.test.ts` and `src/lib/military/reconcileTheaters.test.ts`.
- Situation Board totals are derived from the live unit pool, never stored. Tested in `src/lib/military/__tests__/theaterPool.test.ts`.
- Command sight never follows bloc affinity. Tested in `src/lib/military/conflictVisibility.test.ts`.
- Defence delivery money legs net to zero and settle once per turn. Tested in `src/lib/military/defenceMoneyConservation.test.ts`.
- Not enforced: a global check that no unit points at a resolved conflict; it relies on `standDownCountry` and the reconcile sweep.

## Failure and recovery

- **Stuck `terms_pending`**: a won war whose victor never names a term is resolved as a white peace by the `resolvePeaceWindows` sweep once the 24 turn window closes; the rosters are already stood down, so units are not stranded. A window with no victor stamped is left for an admin rather than guessed at.
- **Units pointing at a dead theater**: a unit can keep a stale `theaterId` through a cached pointer. `reconcileUnitTheaters` repairs it on stand down and is the repair path if a pointer is found stale.
- **Duplicate resolution by two turn runners**: war finalization claims the conflict with a status guarded update, so the loser of the race stops without double paying; battle persistence uses a transaction when available.
- **Interrupted peace payment**: the indemnity is applied through the shared money primitive; a half applied move is left visible for finishing rather than lost.
- **Stuck alignment era**: the crossing is guarded by a stored era key, so a rerun does nothing; a wrong key is repaired by a heal that resets it before the next turn.
- **Stale influence or crisis rows**: crises close on their own after `CRISIS_WINDOW_TURNS`; an unfunded or invalid play is refused before any money is spent.
- **Defence delivery faults**: see the failure section of [Defence Procurement](./defence-procurement.md).
- **Flag off by mistake**: turning `conflictsEnabled` back on resumes pole sweeps on the next turn; no data is lost.

## Connections

**Driven by:**

- [National Budget](./national-budget.md): the defence line funds upkeep and procurement (`src/lib/military/appropriation.ts`).
- [Defence Procurement](./defence-procurement.md): contracts and deliveries feed arsenal lots.
- [Currency Exchange](./currency-exchange.md): contract prices are struck in local currency.
- [Bills & Legislation](./bills-legislation.md): war declarations, org membership and funding run as legislation (`validateDeclareWar.ts`, `membershipBills.ts`).
- [Global Response Crises](./global-response-crises-as-shipped.md): crisis pressure on alignment and leaders.
- [Economic Systems](./economic-systems.md): a country's GDP sets influence prices (`POINT_COST_GDP_SHARE`) and procurement costs.

**Affects:**

- [Bloc Alignment and Spheres](./bloc-alignment-and-spheres.md): alignment shares and bloc stress.
- [Crisis System](./crisis-system.md): alignment crises raise a nation's per-turn cap.
- [Economic Systems](./economic-systems.md): diversion of civilian output to materiel (`militaryDivertedShare`) and GDP loss from crisis effects.
- [Government Approval](./government-approval.md): joint statements move approval by +2 or -3.
- [Defence Procurement](./defence-procurement.md): a demilitarisation term writes the procurement bar (`applyPeaceTerm`).
- Elections and parties: war outcomes reach national mood through approval and crisis effects.

## Tests

- Alignment: `src/lib/alignment/drift.test.ts`, `influence.test.ts`, `membershipEligibility.test.ts`, `blocStress.test.ts`, `crisis.test.ts`, `crisisTurn.test.ts`, `crossing.test.ts`, `normalize.test.ts`, `project.test.ts`, `topology.test.ts`, and `src/lib/turn/alignmentPhase.test.ts`.
- International organizations: the 30-odd tests under `src/lib/internationalOrganizations/` (for example `jointStatement.test.ts`, `aid.test.ts`, `orgDerivedMetrics.test.ts`, `founding.test.ts`, `ensureFoundingMemberships.test.ts`, `diplomaticActions.test.ts`).
- Military core: `src/lib/military/__tests__/` (for example `validateDeclareWar.test.ts`, `warGoals.test.ts`, `battle.test.ts`, `peaceOffer.test.ts`, `acceptPeace.test.ts`, `truce.test.ts`, `leaveConflict.test.ts`, `theaterPool.test.ts`, `generals.test.ts`, `doctrineTree.test.ts`, `coalition.test.ts`), plus `src/lib/military/occupation.test.ts`, `conflictVisibility.test.ts`, `conflictLifecycle.test.ts`, `finalizePoleVictory.test.ts`, `peaceTerm.test.ts`, `manpower.test.ts`, `appropriation.test.ts`, `arsenal.test.ts`, `procurement.test.ts`, `rules/warResolution.test.ts`.
- Turns: `src/lib/turn/battleResolution.test.ts`, `ministerialOrderProcessing.test.ts`, `peaceWindows.test.ts` (terms window lapse), `defenseAppropriationTurn.test.ts`, `defenceDeliveryTurn.test.ts`.
- Gaps: no test exercises the whole path from declaration through terms window to truce end to end; the route gating by `conflictsEnabled` and the Situation Board page are covered only at component level (`src/app/world/conflicts/page.test.tsx`, `src/app/world/conflicts/_coldwar/routes.test.ts`); `readinessDrift.ts` has a readiness ledger test but no direct test of the arrears weight formula.

## Known issues and history

- **Corrected in this revision (code wins):** the previous page said a resolved war is an open record for everyone (it is fogged for `CONFLICT_ARCHIVE_DELAY_TURNS = 480` turns); listed four statuses and four types (code also has `terms_pending` and `cold_war`); said a pole ends a war outright (non proxy wars need a 24 turn minimum age and a terms window, proxy wars a 3 turn hold); said deliveries are capped three times and that payment precedes recording (four caps; recording precedes payment); gave the Warsaw Pact founding year as 1955 (`foundedYear: 1952`); and named 15 era titles for doctrine that exist only on the player page (the code carries the 15 short labels in `ERASHORT`).
- **Player wiki contradictions (code wins):** the Bloc Spheres page says spending past "5% of a target's GDP in one turn is wasted", but 5 points at `POINT_COST_GDP_SHARE = 0.001` is 0.5% of GDP. The National Doctrine page names the 15 eras with long titles ("Industrial War Foundations" to "Fully Integrated Multi-Domain") and some mid-era names differ from the code labels (for example "Counterinsurgency" versus "Counterinsurgency & Missiles"); the code has only the short labels.
- A comment in `src/lib/constants/alignmentEras.ts` on the post Cold War era says "Four poles" while the pole list has three; the join gate for three poles (40) is what applies.
- The `OCCUPATION` comment still describes the removed `deepPushMult` as context; `deepPushDepth` now only marks winding down and bounds what `peaceOffer.ts` calls the ground a settlement may demand (`PRINCIPAL_BUYOUT_PROGRESS = 0.75`, a separate copy of the same value).
- History recorded in the code: the Commonwealth channel was removed because it gave the West a permanent 1.75 to 1 advantage; the `deepPushMult` drag was removed because it acted as a wall on near even fronts; the mobilisation ramp was added after a live war was decided before the attacker's coalition arrived; the static bloc lookup was replaced by the per era roll after it enrolled Warsaw Pact members in NATO.

Last checked: 2026-10-29, version 1.18.0
