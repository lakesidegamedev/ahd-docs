# The Cold War and conflict system (as shipped)

The persistent release 1.3 campaign layer is documented separately in [Global response crises (as shipped)](./global-response-crises-as-shipped.md).

A House Divided models the Cold War as four connected layers: alignment (which way a nation leans, and who is buying that lean), international organizations (the channels blocs push through), the military (forces, generals, doctrine, budgets), and conflicts (live wars with a moving front, battle reports, and negotiated peace). Everything below is read out of the shipped code. Every constant quoted is the value in the repository today.

## What a player sees

The hub is `/world/conflicts` (`src/app/world/conflicts/page.tsx`). It lists every live conflict in the world on a map and in a list, with casualties per conflict pulled from battle reports. Each war has a public record page at `/world/conflicts/<conflictId>` (`src/app/world/conflicts/[conflictId]/page.tsx`): war goal, order of battle, command chain, momentum track, and a war log of up to 50 engagements over a 60 turn momentum window, with 5 marked events.

Other surfaces in the same section:

- `/world/conflicts/situation`: the World Situation Board, where a country commits combat power to theaters and carries a war footing cohesion value.
- `/world/conflicts/blocs`, `/world/conflicts/orgs`, `/world/conflicts/coldwar`, `/world/conflicts/detente`, `/world/conflicts/politburo`, `/world/conflicts/kgb`, `/world/conflicts/station`, `/world/conflicts/active-measures`, `/world/conflicts/home-front`, `/world/conflicts/warsaw-pact`: Cold War framing boards.
- `/world/conflicts/military` is now a redirect into the Secretary of Defense office (Commands tab) for the viewer's country.
- `/world/conflicts/alignment` is retired and redirects to `/world/cold-war-ledger`, which reads the real `countryAlignments` collection for every nation instead of the old 16 nation mock.

The whole section is gated by the `conflictsEnabled` flag on game state (`src/lib/db/types/gameState.ts`, checked through `requireConflictsEnabled` in `src/app/world/conflicts/_coldwar/gate.ts`). With the flag off, every route bounces to `/world`.

## Who can see what

`src/lib/military/conflictVisibility.ts` splits sight from authority. Tiers are `public`, `command`, and `archive`. A resolved war is an open record for everyone. Command sight needs both a belligerent country (by explicit roster membership, not bloc affinity) and a seat in its command structure: a posted general, the defence seat holder, the head of government, or a commanding general. Commanding generals get command sight but never command authority: declaring still runs through `canActAtTheater`.

`belligerentSideOf` deliberately does not use `sideOf`. `sideOf` falls back to matching a country's bloc against a side's backer, which is right for "whose ground does this unit take" and wrong for "may this person read the order of battle".

## Alignment: shares, not a slider

A nation's alignment is a set of shares, one per pole, plus a non aligned remainder (`src/lib/constants/alignmentEras.ts`). Poles depend on the live year, not just the era. The Cold War era (1945 to 1990) is bipolar: `WEST` and `EAST`, with `WEST` counting positive on the derived -100 to +100 axis. The post Cold War era (1991 onward) is `WASHINGTON`, `MOSCOW`, `BEIJING`.

Key values:

- `ALIGNMENT_GATES = { locked: 85, nonAligned: 20 }`. Past 85 a nation is immovable by drift; only a deliberate play can shift it.
- `PER_NATION_TURN_CAP = 5` share points per turn. `CRISIS_TURN_CAP = 7.5` while a crisis is open on that nation.
- Join gate by pole count: 2 poles needs 50, 3 needs 40, 4 needs 35.

`src/lib/alignment/drift.ts` is the tide. A nation in the non aligned band absorbs movement at `NON_ALIGNED_RESISTANCE = 0.5`. Opposing pulls cancel before the cap applies, so two blocs pushing equally hard leave the nation where it was, and allies on the same pole simply add. Membership itself pulls: `MEMBERSHIP_PULL_PER_TURN = 0.04` up to `MEMBERSHIP_PULL_CEILING = 67`.

`src/lib/alignment/crossing.ts` re run once per era crossing, guarded by a stored era key. Surviving poles keep their share, superseded poles hand theirs to a declared successor, and anything with neither returns to the uncommitted pool.

## Influence plays: the rudder

`src/lib/alignment/influence.ts`. A play is a paid push through an organization channel. One play buys at most `PLAY_MAX_POINTS = 10` share points. Price is keyed to the target's own economy: `POINT_COST_GDP_SHARE = 0.001`, so 0.1% of the target's annual GDP buys one point, linearly. Because a nation moves at most 5 points a turn, spending past roughly 0.5% of the target's GDP in one turn is visibly wasted.

Channel weight scales every play. In the Cold War era, NATO carries weight 1 toward `WEST` and the Warsaw Pact weight 1 toward `EAST`, both with `alignmentAccession: true`. The Commonwealth deliberately carries no channel: stacking it behind NATO gave the West a permanent 1.75 to 1 advantage the Warsaw Pact could not answer.

Nothing fires automatically. Rivals cancel only by spending.

## Membership and defection

`src/lib/alignment/membershipEligibility.ts`: `JOIN_SHARE = 60`, `LEAVE_SHARE = 40`, `SUSTAIN_TURNS = 24`. A non player nation that holds a share above the join gate for the sustain window asks to join an alignment accession org; one that falls below the leave share starts a `wantsOutSinceTurn` run and eventually walks. Orgs whose membership is not decided by Cold War alignment (the Commonwealth, the EU) still act as influence channels but never auto recruit or auto expel.

## Bloc stress

`src/lib/alignment/blocStress.ts` prices holding an alliance together as a 0 to 1 gauge over a bloc's own members, weights summing to 1: contested members 0.45, members heading for the door 0.35, recent accessions 0.2. A member counts as contested when a rival pole holds at least `CONTESTED_RIVAL_MIN = 25` of it. Digestion of a new member decays over `DIGESTION_WINDOW_TURNS = 12`. Raw member count is deliberately not an input: size alone is not strain. The effect is a dampener on the bloc's own plays, capped at `STRESS_MAX_DAMPING = 0.4`, so a fully stressed bloc is impaired, never inert.

## Flashpoints and crises

Two crisis systems ship, and they are separate things.

Alignment crises (`src/lib/alignment/crisis.ts`, `crisisTurn.ts`, `crisisCatalog.ts`) mark a nation as unusually movable. A crisis has no payout of its own: it raises that nation's ceiling from 5 to 7.5 for `CRISIS_WINDOW_TURNS = 12`, so a crisis nobody acts on changes nothing. At most `MAX_OPEN_CRISES = 3` are open at once. Targets come from two sources: authored crises with era windows (for example Prague Spring, `crisis.pragueSpring`, target `CS`, years 1968 to 1970), and emergent ones (`emergent.tugOfWar`, `emergent.defection`). A tug of war candidate needs the runner up pole holding at least 25 and a lead no wider than the non aligned gate of 20. A defection crisis opens once a member is halfway to walking out, `SUSTAIN_TURNS / 2 = 12` turns.

National crises (`src/lib/db/types/crisis.ts`) are the decision tree events: choice, collective, terminal, and aid nodes, with effects typed `flat`, `tick`, or `decay` and targeting metrics, approval, profit margin, inflation, `gdpLoss`, or a character stat. `gdpLoss` is a one time fraction of regional GDP destroyed; the growth rate path is the ongoing drag. Under the plants market tier a `profitMargin` effect marked `physicality: "physical"` becomes a production haircut (`productionFactor *= 1 - |value|/100`) instead of a thinner margin; absent means `financial`, which is load bearing because live crises carry snapshotted effects. Global crises collect one `CrisisLeaderResponse` per affected head of state, each applied to that leader's own country.

## International organizations

`src/lib/internationalOrganizations/`. Existence is derived, not persisted: `isOrganizationFounded` compares `def.foundedYear` and `dissolvedYear` against the live game year, with a has members override so a year rollback cannot vanish a populated org. Founding years in `src/lib/constants/internationalOrganizations.ts` include the UN 1945, NATO 1949, Comecon 1949, the Warsaw Pact 1955 era rosters, the EEC lineage, the Non Aligned Movement 1961, and the EU 1993.

Mechanics that ship:

- `DIPLOMATIC_ACTIONS_PER_TURN = 4` per country (`diplomaticActions.ts`).
- `ORG_PROPOSAL_VOTING_TURNS = 24`, re exported as `PROPOSAL_VOTE_WINDOW_TURNS`.
- Assessed contributions at `ORG_ASSESSED_RATE = 0.005` of member GDP (`orgDerivedMetrics.ts`).
- Joint statements: endorsing moves approval by +2, condemning by -3, and the effect lasts `JOINT_STATEMENT_DURATION_TURNS = 24` (`jointStatement.ts`).
- Aid converts money to a growth boost logarithmically: `0.05` per order of magnitude of USD, capped at `0.5` added to `economic.gdpGrowth.value` (`aid.ts`).
- Joining, funding, and leaving all run as legislation (`membershipBills.ts`), with founding member seeding in `ensureFoundingMemberships.ts`.

## The military layer

Forces. Starting rosters come from `src/lib/seeds/reference/ordersOfBattle.ts`, which authors composition only: names, veterancy, readiness, posture, XP and equipment stay generated from the seeded RNG. Rosters are calibrated to 1953 because DD, CS and YU do not exist in 2019. Russia fields 12 Infantry Divisions, 5 Armored, 5 Mechanized Brigades, 4 Artillery Regiments, 3 Air Defense Battalions, 4 Attack Submarines, 3 Frigate Squadrons, 1 Amphibious Group, 4 Fighter Wings, 3 Bomber Squadrons and 5 PVO Air Defense Wings. East Germany fields 3 Infantry Divisions, 2 Mechanized Brigades, 1 Artillery Regiment, 1 Frigate Squadron, 2 Fighter Wings and 1 Air Defense Wing. A branch a country's table does not name keeps random generation, so a 1953 table does not delete Russia's 1959 rocket force from a later era game.

Commands. `src/lib/military/config.ts` defines three command types (`HOMELAND_DEFENSE`, `REGIONAL`, `LOGISTICS`), twelve postures from Defensive through Training / Reserve, and a `REGION_CAP = 3` regions per command. Effectiveness thresholds are `{ good: 82, ok: 70 }`. Capacity penalties: 10 effectiveness for no commander, 1.6 per point of force load over capacity, floor 20.

Theater command. One general is `inCharge` of a conflict. Their bonus applies once front wide at `THEATER_COMMAND.bonusShare = 0.25` of their own combat value edge, so a strong theater commander never replaces good generals on the units. They earn `xpShare = 0.5` of what a general leading one average formation at that front would earn, measured that way so a superpower's commander does not level many times faster than a small nation's for the same work.

Generals. `src/lib/military/generals.ts` sets ranks Brigadier, Major General, Lt. General, General, Field Marshal at XP thresholds `[0, 100, 250, 460, 740]`, `WIN_BONUS_XP = 45`, `LOSS_BONUS_XP = 20`, `POINTS_PER_PROMOTION = 4`, then `POST_FM_XP_PER_POINT = 200` past Field Marshal up to `POST_FM_POINT_CAP = 15`. Tenure grants a point every `TENURE_POINT_TURNS = 24` up to `TENURE_POINT_CAP = 20`. The trait tree lives in `src/lib/military/generalsTree.ts`: categories such as Command Style with paths Aggressive, Cautious, Flexible and Disciplinarian, each node carrying a decade gate and structured mods (`cv`, `cas`, `enemy`, `supply`, `upkeep`, `ready`). Nodes conflict with each other by name: Shock Commander conflicts with Cautious Commander, Methodical Commander with Aggressive Commander.

Doctrine. `src/lib/military/doctrineTree.ts` runs 15 decades from the 1900s to the 2040s and 15 named eras from Industrial War Foundations to Fully Integrated Multi-Domain, grouped as Army, Navy, Air, Logistics and Command. Nodes carry costs in doctrine points, named prerequisites, and conflicts, with mods `cvAll`, `cvDom`, `cvTrait`, `upkeep`, `supply`, `xp`, `ready`, `deep`, `joint`. Doctrine nodes can boost matching general trait nodes through the `boost` field on the trait tree.

Budget. `src/lib/military/appropriation.ts` accrues the annual defence line evenly over the game year. `SEED_UPKEEP_TARGET_SHARE = 0.55` is the one balance dial: a nation at its historical starting force spends 55% of its defence budget sustaining it. Double the roster and upkeep is 110% of the budget, which means overdraft and then arrears. The overdraft floor is one full year's line. Upkeep is funded continuously rather than all or nothing, so a force 10% beyond budget sags slightly instead of collapsing. Settlement returns a delta applied as an atomic increment, never an absolute write, so concurrent spends compose.

Procurement. `src/lib/military/procurement.ts` prices archetypes off GDP with `ARCHETYPE_COST_GDP_DIVISOR = 387_000` and half indexation (`MILITARY_PRICE_INDEXATION = 0.5`). Upgrades cost a share of unit price by tier: `{ 1: 0.25, 2: 0.35, 3: 0.5 }`.

Arsenal and materiel. `src/lib/military/arsenal.ts` runs equipment as lots: `LOT_COST_UNITS = 387` cost units per lot (the archetype divisor over 1,000), materiel is `MATERIEL_SHARE_OF_UNIT_COST = 0.2` of a unit's price, and equipment grades run to `EQUIPMENT_TRACK_MAX = 3`. Lots produced by a plant come from its strategy and revenue (`lotsFromSector`), and the share diverted from the civilian economy is tracked per sector (`militaryDivertedShare`).

Manpower and conscription. `src/lib/military/manpower.ts` gives five stances, each scaling the pool and gating whether green conscripts may be drawn at all:

- All-Volunteer Force, pool multiplier 0.6, no conscription.
- Limited Service, 0.8, no conscription.
- Selective Service, 1.0, conscription allowed.
- National Service, 1.4, conscription allowed.
- Universal Conscription, 2.0, conscription allowed.

Defaults are US selective, UK national, RU universal, DD universal; every other country falls back to limited. For the four playable nations the stance is driven by a defence secondary law (for example `us.sec.reserveForces`), whose five levels are the ladder. Pools start at `MANPOWER_START_FRACTION = 0.25` of the ceiling derived from population.

Readiness. `src/lib/military/readinessDrift.ts` drifts each unit toward the baseline for its posture in steps of `READINESS_DRIFT_STEP = 8`. Unpaid upkeep bites here: the arrears ratio pulls the baseline down at `ARREARS_READINESS_WEIGHT = 0.35`, so a country that cannot fund its force finds it degrading rather than vanishing.

Geography. `src/lib/military/regions.ts` holds the strategic region table commands are assigned over, grouped by theater, and `regionThreat.ts` computes a threat level per region from live conflicts. A conflict derives its `region` from its host country, so declaring a war puts the pin on the map with no extra input.

## Defence contracts

`src/lib/db/types/defenceContract.ts` and `src/lib/turn/defenceDeliveryTurn.ts`. A defence seat awards a standing order to one of its own country's defence plants. Statuses are `pending`, `active`, `complete`, `cancelled`, `declined`: a contract does nothing until the supplying CEO accepts, and a CEO's refusal is recorded separately from the minister's cancellation.

Contracts are domestic only, and that is a hard payment safety constraint rather than a simplification: `liquidCurrencyCode` is absent on pre forex corporations and six Eastern Bloc countries have no exchange rate document at all, so cross border payment would silently mis denominate. `canSupply` enforces both the same country and a matching currency.

The component is resolved from the sector's strategy at award and frozen, so a plant that re tools mid contract makes the order undeliverable rather than differently deliverable. `pricePerLot` is struck at award in local currency and does not drift with GDP.

Per turn, deliveries are capped three times in order: what the plant produced, what remains on the order, and what the appropriation covers. Procurement has no overdraft (the overdraft exists for upkeep, an obligation already incurred), so a country that cannot pay takes fewer lots and the contract waits. Payment precedes recording, deliberately, because every failure mode then becomes a refundable over payment rather than free materiel. Delivered grade is capped by the era ceiling mirroring the seeder's `MAX_TECH_TIER_BY_ERA`.

## The Situation Board

`TheaterStateDoc` (`src/lib/db/types/theaterState.ts`) holds one row per country: a war footing `cohesion` value and a `committed` map of combat power per theater. Available, reserve and total are not stored: they are derived from the live unit pool by `src/lib/military/theaterPool.ts`, so the board can never disagree with the roster. A unit's `theaterId` is either a conflict id or the string `"reserve"`.

The board page (`src/app/world/conflicts/situation/page.tsx`) loads the viewer's country units, that country's theater state, the era's live bloc roll (`loadMilitaryBlocs`), and every active conflict, then hands all four to the client. Bloc membership is read per era rather than from a static table: the old static 9 entry lookup fell back to the US row for unknown countries, which quietly enrolled Warsaw Pact members into NATO.

## Conflicts: declaring a war

`src/lib/db/types/conflict.ts` replaced four hardcoded static theaters with dynamic conflicts. A world starts with none. Types are `interstate`, `intervention`, `civil_war`, `independence`; statuses `active`, `escalating`, `winding_down`, `resolved`. Each conflict has a host country (the map anchor, not necessarily a belligerent), two sides with rosters and optional bloc backers, terrain, severity, per side supply, a terrain combat factor `terr`, an `infra` supply throughput baseline, and an `enemyMix` for generated forces. `conflictId` is the public 1 based number in the URL; `_id` is the internal theater key units and reports reference and therefore cannot be renumbered.

Declaring runs as legislation (`src/lib/military/validateDeclareWar.ts`, `declareWar.ts`). `WAR_DECLARATION_COOLDOWN_TURNS = 120` counted from the last proposal, not the last passage, because a declaration the chambers threw out still spent diplomatic capital. At one turn per hour that is roughly five in game days. War goals (`warGoals.ts`) are `conquest`, `regime_change`, `punitive`, `liberation`; conquest is present in the type but marked `selectable: false` because nothing transfers territory yet, and both the picker and the bill validator read that same flag so a hand rolled API request cannot submit it.

One war per pair, re checked at enactment and not only at proposal. If a live conflict already exists hosted in the defender, the declarer enrols on the opposing side instead of opening a parallel war over the same ground.

## Battles and territory

A `BattleDeclarationDoc` is a committed offensive by one nation against a specific enemy nation at a theater. It resolves on the turn after `declaredTurn`, giving the defender a window to reinforce or withdraw, then is marked `resolved` or `fizzled` when the target had no forces present. Simultaneous declarations merge into coalition offensives (`src/lib/military/coalition.ts`), with the earliest declaration as principal attacker.

`BattleReportDoc` records the result for both War Rooms: full attacker and defender lists, casualties, `noContact`, `unopposedAdvance`, and `controlBefore` / `controlAfter` so a player who won can see what winning achieved.

Verdicts (`src/lib/military/battle.ts`): margin above 45 is a Decisive Victory, above 15 a Victory, any other win Pyrrhic, a loss within -30 a Costly Defeat, worse a Rout.

Territory (`src/lib/military/occupation.ts` with `OCCUPATION` in `config.ts`). `control` is side B's share of the host country's territory, 0 to 100. A war starts at the host's own pole when the host is a belligerent, and at 50 when it is not. A decisive win at `decisiveMargin: 45` takes `maxShift: 5` points of the track; narrower wins scale down; a loser who withdrew in order yields `retreatYield: 0.7`; advances no longer halve at depth (the old `deepPushMult` drag was removed, and the supply penalties below slow a deep push instead; `deepPushDepth: 0.75` now only marks when a war reads as winding down). Early advances are ramped: a front moves at `mobilizationFloor: 0.4` of a normal advance on the opening turn and reaches full pace at `mobilizationTurns: 50`, so a coalition that needs time to mobilise is not shut out of a war already decided. Supply is derived from displacement rather than accumulated, so a front that swings back also recovers: `compressionPenalty: 40` at full compression, `overextensionPenalty: 15` at full overextension, never below `minSupply: 10`, with `supplyNeutral: 60` the neutral point. Reaching a pole ends the war.

## Ending a war

`resolveConflict` records the outcome, then walks every belligerent out through the same `standDownCountry` path a separate peace uses, so the two cannot drift.

Negotiated exits use `PeaceOfferDoc` (`src/lib/db/types/peaceOffer.ts`). An offer is struck between two countries, not two sides: the leaver drops off its roster and the war continues for everyone else. That follows the consent rule already shipped for coalition offensives (no player commits another player's army) and avoids whole side peace freezing a war forever because one inactive country can never consent. An offer stands `PEACE_OFFER_DURATION_TURNS = 72` turns and then lapses. The indemnity names an explicit payer, because either party may pay (a loser buying out, or a winner paying to disengage), and is always quoted in the payer's local currency. `amount: 0` is a clean white peace through the same mechanism.

Any war ending, negotiated or won outright, starts a truce of `TRUCE_TURNS = 240` for every cross side pair (`src/lib/military/truce.ts`). Truce documents key on the sorted country pair and extend with `$max`, so overlapping writes can never shorten a truce already in force. Without this, a country conquered on turn 100 could be re declared on the moment the attacker's 120 turn cooldown lapsed, at the point it is least able to resist.
