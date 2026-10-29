# Congress Leadership

Design and status for US House and Senate leadership roles. The underlying
presiding-officer election framework is shared across countries; see
[Chamber Leadership by Country](./chamber-leadership-by-country.md) for the DE
Bundestagspraesident, NG National Assembly presiding officers, and CN CPPCC
Chairman / NPCSC Chairman variants.

## Current implementation

### House, Speaker, Majority Leader, Minority Leader (24-hour plurality)

- **Status**: Implemented.
- **Flow**: These elections auto-open for 24 hours when a House general election resolves, but only if the party that should hold the role under the current seat counts differs from the current holder, or the role is vacant (`hasControllingPartyChanged` in `src/lib/congress/leadershipElections.ts`). The sitting Speaker is automatically nominated if they still hold a House seat. The sitting Majority Leader is automatically nominated when they are still seated and still belong to the national party with the most House seats. The sitting Minority Leader is automatically nominated when they are still seated and remain outside the majority bloc. Speaker is bloc-gated to the **majority bloc**; House Majority Leader is restricted to the **single national party with the most House seats**; Minority Leader is open to **all non-majority parties**. Plurality winner (top vote-getter when the window ends) wins; no absolute majority required.
- **Eligibility**: U.S. congressional leadership elections are now player-only. NPPs cannot run for or vote in Speaker, House Majority Leader, or House Minority Leader races.
- **API**: `GET/POST /api/congress/speaker` (Speaker), `GET/POST /api/congress/house-leadership` (Majority/Minority Leader; body `role: "majority_leader" | "minority_leader"`, actions: `start_election` | `declare` | `withdraw` | `vote`).
- **Data**: `congressLeaders`, `speakerElections`, `speakerNominations`; `houseLeadershipElections`, `houseLeadershipNominations`. Helper: `getHouseComposition()` in `src/lib/congress/houseComposition.ts`.

### House, Whips

- **Majority Whip**, **Minority Whip**: Elected in the same 24-hour plurality cycle as the House leaders, with nominations and party eligibility rules (Majority Whip from the majority party, Minority Whip from the non-majority parties). They reopen on the same controlling-party-changed rule (`src/lib/congress/leadershipElections.ts`).

### Senate, President Pro Tempore, Majority Leader, Minority Leader (24-hour plurality)

- **Status**: Implemented. Leadership elections are 24-hour plurality races. President Pro Tempore is gated to the **majority bloc**; Senate Majority Leader is restricted to the **single national party with the most Senate seats**; Minority Leader is open to **all non-majority parties**.
- **Trigger cadence**: When a Senate general election resolves, each role (President Pro Tempore, Majority Leader, Minority Leader, and both Whips) reopens only if the party that should hold it under the current seat counts differs from the current holder, or the role is vacant (`hasControllingPartyChanged`). The sitting Pro Tempore is automatically nominated if still seated; the sitting Majority or Minority Leader is automatically nominated when still seated and still eligible for that side of the chamber.
- **Eligibility**: U.S. congressional leadership elections are player-only. NPPs cannot run for or vote in Senate Pro Tempore, Senate Majority Leader, or Senate Minority Leader races.
- **API**: `GET/POST /api/congress/senate-leadership` (body `role: "pro_tempore" | "majority_leader" | "minority_leader"`, actions: `start_election` | `declare` | `withdraw` | `vote`).
- **Data**: `congressLeaders`, `senateLeadershipElections`, `senateLeadershipNominations`. Helper: `getSenateComposition()` in `src/lib/congress/senateComposition.ts`.

### Senate, Whips

- **Majority Whip**, **Minority Whip**: Elected in the same 24-hour plurality cycle, with the same reopen rule as the other Senate roles.

## Data model

- **congressLeaders**: One document per role. Fields: `role`, `characterId`, `characterName`, `party`, `nominatedBy`, `electedAt`, `createdAt`, `updatedAt`.
- **House**: `speakerElections` (\_id: "current"), `speakerNominations`; `houseLeadershipElections` (\_id: majority_leader | minority_leader), `houseLeadershipNominations` (role field).
- **Senate**: `senateLeadershipElections` (\_id: pro_tempore | majority_leader | minority_leader), `senateLeadershipNominations` (role field).

## UI

- **Congress → Composition**: Member list shows **leader badges** (Speaker, Maj. Leader, Min. Leader, Pro Tempore, etc.) next to the name for the current holder.
- **Congress → Leadership**: House and Senate each show Majority/Minority sections with bloc-aware seat counts; each elected role (Speaker, Pro Tempore, Majority Leader, Minority Leader) has election UI (start 24h election, declare, vote, candidacy cards with plurality wording). Other roles use Assign/Clear. Portraits and name (D-TX) for each leader.

## Cabinet Nominations (Senate Role)

Cabinet nominations are initiated by the President but require Senate confirmation before a character is installed in a cabinet position.

- **Trigger**: President posts a nomination via `/api/whitehouse/cabinet/nominations`
- **Senate action**: Active nominations appear on both the Cabinet page and the Congress Senate tab; senators vote For / Against / Abstain
- **Window**: 24 hours from nomination
- **Threshold**: Simple majority of votes cast (not of all senators)
- **Resolution**: On timer expiry or when vote window closes, system tallies votes and confirms or rejects
- **Rejection**: Position remains vacant; President may re-nominate
- **Confirmed**: Nominee added to `cabinetMembers` collection; displayed on `/whitehouse/cabinet`

See [Cabinet](./cabinet.md) for full position list and lifecycle details.

## Future work

1. Leadership effects on agenda, committee assignments, or persuasion, to be defined later.
2. Cabinet resign (member voluntarily leaving), not yet implemented.
