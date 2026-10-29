# Relocation

Players can change their character's **home state** (or UK region, JP prefecture). Home state controls where you run for most offices, canvass, and most eligibility checks.

Player guide: [Relocation](https://www.ahousedividedgame.com/wiki/relocation)

Relocation is an immediate API action (`POST /api/character/relocate`, rate limited to 10 requests per 60 seconds per user), not a turn-phase process. It never waits for a turn tick. The 72-turn cooldown is measured in turns from `lastRelocatedTurn`.

## Cooldown

- **72 turns** (72 game-hours, 3 real days) from your last successful relocation before you can move again. `RELOCATION_COOLDOWN_TURNS = 72` in `src/lib/character/relocationCooldown.ts`; `RELOCATION_COOLDOWN_DAYS` is derived (72 / `TURNS_PER_DAY` = 3). The cooldown is shared by every relocation type, including the combined character and corporation move. Players with no `lastRelocatedTurn` fall back to the legacy `lastRelocatedAt` timestamp.
- The cooldown is why moves are not free to spam: a reset of influence and donors only costs something if you cannot immediately undo the move.

## What always resets (any relocation)

- **Political influence** → 0
- **Donor base** → 0
- **Group favorability** → cleared
- **State/region-party leadership** (chair, vice-chair, treasurer) in the state you left → vacated
- **Any active candidacy** (general/primary, state-party, national-party, committee) → withdrawn
- **Current office** → auto-resigned if it is tied to a state or region (governor, House, Senate, state legislature and similar); the seat is vacated in `electedOfficials`. Country-scoped offices (President, Vice President, cabinet and similar, no `state` field) are kept on a same-country move and only resign on a country change. See `officeResignsOnRelocation` in `src/lib/character/officeResignsOnRelocation.ts`.
- **Party membership** → kept only while the destination is inside your party's reach (its live growth frontier). A same-country move outside it makes you Independent and resets party influence. This needs explicit confirmation (the API answers `409` with `partyDepartureRequired` until `confirmPartyDeparture` is sent). Rules live in `src/lib/character/relocationParty.ts`.
- **Party territory guard** → a move that would disconnect your party's territory, or grow a disconnected area without helping reconnect it, is rejected with `PARTY_TERRITORY_WARNING` (`src/lib/parties/relocationTerritory.ts`).
- **CEO of a corporation** → removed; corp enters CEO vacancy. Exception: National Corporation CEOs keep the seat on a same-country move; a cross-country move still unseats (see CEO and corporation rules below).
- **Career history** → a `"relocated"` entry is appended with `fromState` / `toState` (and `fromCountry` / `toCountry` if the country changed)

## What only resets on country change

- **National influence** → 0
- **Party influence** → 0
- **Party membership** → set to Independent
- **National party leadership positions** (chair, vice-chair, treasurer) → vacated; party `memberCount` decrements
- **National committee membership** → cleared
- **Coalition chair** (if your party leads one) → cleared
- **Central-bank chair** → auto-resigned
- **Campaign manager role** (any campaign you manage) → cleared
- **Caucus participation** → membership closed, chair/vice-chair seats cleared, chair candidacies withdrawn
- **Prime Minister title** (`governmentFormations` and `parliamentaryGovernments`) → cleared
- **Cabinet membership** → removed from `cabinetMembers`
- **Military command** → severed from the old country's chain of command via `severFromChainOfCommand` (step 4c); any command you led is vacated and reported in the relocation summary

These cross-country cleanup steps run in `src/lib/character/performRelocation.ts` (step 4b).

## What is preserved

Campaign funds, personal cash, savings (all currencies), actions, favorability, infamy, policy positions, earlier career history entries, avatars, bonds, share holdings, and line-of-credit balances/arrears.

## Blocking conditions

- Target state must exist and differ from your current home state. Otherwise `400`.
- 72-turn (3-day) cooldown since your last relocation. Otherwise `429`.
- Destination country must be enabled for players (`403`; admins bypass this check).
- If the destination is US, the target must pass `isUsResidentPoliticalRegion`: a state under the active apportionment map, an admitted state, or a territory listed for admission (Alaska, Hawaii). Anything else is rejected as an unplayable territory. See [Statehood Admission](./statehood-admission.md).
- Party territory guard and party departure confirmation (see above).

There is **no** block for active candidacies or office-holding: those are handled automatically.

## CEO and corporation rules

- By default, any relocation removes you as CEO if you hold the role; the corporation enters CEO vacancy.
- Exception: National Corporation CEOs have relaxed country-level residency. A same-country relocation does not unseat them; a cross-country move still does. See `src/lib/character/performRelocation.ts` step 3.
- To accept a CEO role, your home state must match the corporation's headquarters state. See [Corporations](./corporations.md).

## Constants

| Constant | Value | Source |
| --- | --- | --- |
| `RELOCATION_COOLDOWN_TURNS` | 72 | `src/lib/character/relocationCooldown.ts` |
| `RELOCATION_COST_FRACTION` | 0.07 (7% of market cap) | `src/lib/constants/corporationsClient.ts` |
| `CROSS_COUNTRY_RELOCATION_MULTIPLIER` | 2 (so 14%) | `src/lib/constants/corporationsClient.ts` |
| `RELOCATION_BOND_MATURITY_TURNS` | 336 | `src/lib/corporations/issueRelocationBond.ts` |
| Relocate API rate limit | 10 requests per 60 s per user | `src/app/api/character/relocate/route.ts` |

Corporate move cost is `round(sharePrice x totalShares, converted to anchor currency) x 0.07 x (2 if cross-country else 1)`, computed by `computeCorpRelocationCost` in `src/lib/corporations/relocationCost.ts`. Worked example: a corporation with market cap 10,000,000 pays 700,000 to move within its country and 1,400,000 to move to another country. Imperial CEOs pay 0 (`paymentMethod: "imperial-free"`). The cost can be paid in cash (Liquid Capital) or by issuing a relocation bond with a 336 turn maturity, subject to the leverage cap.

## Timing

1. The API route checks target, cooldown, country access, US territory eligibility and party departure.
2. `performRelocation` (`src/lib/character/performRelocation.ts`) runs in order: 1 office resign, 2 withdraw candidacies, 3 CEO resign, 4 central bank chair (country change), 4b country-scoped roles, 4c military chain, 5 state party leadership, 6 party departure cleanup, 7 character update, 8 career history, 9 party presence recount.
3. Nothing is deferred to the turn processor. The seat vacated in step 1 is picked up later by the perpetual-election spawner on its normal turn schedule.

## Edge cases and limits

- Money is never currency-converted; balances stay in their original currency.
- Admin and moderator moves run the same pipeline; only cooldown, country gate and rate limit are skipped.
- A National Corporation CEO keeps the seat on a same-country move (step 3, `isStateOwned`) but not across countries.
- A failed party guard or missing confirmation aborts before any state changes.
- Active candidacies never block a move; they are withdrawn in step 2.

## Combined character + corporation relocation

When you click "Relocate here" from a region page as a CEO, the dialog offers three options instead of the usual two:

- **Cancel**: dismiss, no action.
- **Relocate & Abandon Corporation**: standard character relocation; CEO role is auto-vacated as always.
- **Relocate & Move Corporation**: character and corporation HQ move in a single transaction via `POST /api/character/relocate-with-corp`. You remain CEO.

Cross-country corporate relocations cost **2× the base 7% of market cap** (so 14%). Imperial CEOs' corporations move along with the character at no cost: they receive the standard 2-button dialog with an info line rather than the chooser.

The "Relocate & Move Corporation" button is disabled when the corp cannot afford the selected payment method (insufficient Liquid Capital, bond cooldown still active, or leverage cap reached). The other two options remain available.

When a HQ moves via the CEO Office (not the combined flow) and the CEO does not reside at the destination, the CEO is auto-vacated: same semantics as character relocation. The UI warns the player before submission; the action is not blocked.

## Strategy notes

- Time relocation around election filing and canvassing: both are home-state scoped.
- Cross-country moves are heavy: expect to lose your party, all national influence, and any national-level positions.

## Admin and moderator overrides

`PATCH /api/admin/characters/update-country`, `PATCH /api/admin/characters/update-state`, `PATCH /api/moderator/characters/update-country`, and `PATCH /api/moderator/characters/update-state` run the full pipeline above: they never bypass cleanup. The only difference from the player flow is that cooldowns, country-availability gates, and rate limits are skipped.

## Connections

Driven by:

- [Corporations](./corporations.md): HQ state and CEO residency decide whether a move unseats a CEO (`performRelocation` step 3).
- [Statehood Admission](./statehood-admission.md): which US territories are valid destinations (`isUsResidentPoliticalRegion`).

Affects:

- [State-Level Power](./state-level-power.md): vacated state seats and state party leadership (steps 1 and 5).
- Party organisation and territory: party presence is recounted in step 9 (`updatePartyPresence`).
- Elections: candidacies are withdrawn in step 2 (`withdrawAllActiveCandidacies`).

## Related pages

- [Getting Started](./getting-started.md): Creating a character and first steps
- [Corporations](./corporations.md): Founding, HQ, CEO eligibility
- [State-Level Power](./state-level-power.md): Governor and state offices
- [United Kingdom](./united-kingdom.md): UK regions as home "state"

Last checked: 2026-10-29, version 1.18.0
