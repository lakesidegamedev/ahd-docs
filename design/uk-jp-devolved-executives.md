# UK + JP Devolved Executives - Design & Phased Plan

Historical record: this page describes the phased plan for UK and JP devolved executives, as of the rollout of the regional executive offices. For current behaviour see [United Kingdom](./united-kingdom.md) and [UK Elections](./uk-elections.md).

**Status:** Historical implementation plan; the regional executive offices and
election wiring described here have shipped. Do not treat unresolved questions
or phase checklists below as current behavior.
**Closes:** Gate 0 finding - `getRegionalExecutive()` returns `null` for UK/JP.

## Motivation

The Political System Rework's Gate 0 audit (plan §"Gate 0 - Findings", 2026-05-05)
identified that the State Overview tab's regional-executive chip can never display
anything for UK or JP regions because no devolved-executive `OfficeType` exists in
the schema. US (`governor`) and DE (`ministerPresident`) are wired. This document
covers the design + implementation plan to close that gap.

## Scope decisions

| Decision                      | Choice                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| OfficeType reuse              | **Recycle existing `governor` type** for UK FMs / Mayor of London **and** JP regional governors |
| UK First Minister election    | Direct election per devolved region (SCO, WAL, NIR)                                             |
| Mayor of London               | Include - direct election, LON only                                                             |
| JP regional governor election | Direct election per region, own 4-year cycle                                                    |
| NPC seeding                   | Party-stamped, generic-name NPCs (12 seats total)                                               |
| Preset support                | 1991 + 2019 (matches existing US/DE seed pattern)                                               |

## OfficeType reuse - the key insight

`{ type: "governor"; state: string }` already has exactly the shape required for
direct-elected single-seat regional executives. JP already has a `governor` entry
in its `officeTypes` config (line 979), and `REGIONAL_BILL_ASSENT_OFFICE_KEY[JP]`
is already `"governor"` - the office mechanically exists for JP today, just with
no seat instances. UK is missing both pieces.

Display labels diverge by country (and by state for UK), but the office-type
key, election cycle, action bonus, and party-strength weight are all identical.
Recycling `governor` means **zero changes to the `OfficeType` union, the election
plumbing, action-refresh, or the bill-assent flow** - only data + label work.

## Seat inventory (12 new seats)

**UK - 4 seats:**

- Scotland First Minister (`state: "SCO"`)
- Wales First Minister (`state: "WAL"`)
- Northern Ireland First Minister (`state: "NIR"`)
- Mayor of London (`state: "LON"`)

**JP - 8 seats** (one per game-region; JP regions are the in-game state unit, not
the 47 RL prefectures):

- HOK / TOH / KAN / CHU / KNS / CGK / SHI / KYU regional governors

UK English regions other than LON (SEE, SWE, EAE, EMI, WMI, YHU, NWE, NEE) have
no devolved executive - `getRegionalExecutive()` returns `null` for them.

## Label resolution

`getRegionalExecutive()` currently uses a country-keyed config. UK needs a
**per-state** label (FM for SCO/WAL/NIR, Mayor for LON, null for everything else).
JP uses one label country-wide.

```ts
function getExecutiveLabel(countryId, stateId): string | null {
  if (countryId === "US") return "Governor";
  if (countryId === "DE") return "Ministerpräsident";
  if (countryId === "JP") return "Governor";
  if (countryId === "UK") {
    if (stateId === "LON") return "Mayor of London";
    if (stateId === "SCO" || stateId === "WAL" || stateId === "NIR")
      return "First Minister";
    return null; // English non-London regions
  }
  return null;
}
```

## Phases

### Phase 1 - Country config + regional-executive chip (this PR)

Goal: regional-executive chip resolves correctly for UK + JP when officials exist.
No officials exist yet - chip stays empty until Phase 3 seeds them. **No schema
changes** because `governor` already covers all three new contexts.

Files touched:

- `src/lib/constants/countries.ts`:
  - Add `governor` entry to UK `officeTypes` array (mirrors JP shape, label
    "First Minister" or stays "Governor" - TBD by Phase 4 polish)
  - Add `UK: "governor"` to `REGIONAL_BILL_ASSENT_OFFICE_KEY` (UK already has
    `regionalBillAssentTitle: "First Minister"` on the config; this just makes
    the lookup explicit instead of falling back)
- `src/lib/states/regionalExecutive.ts` - extend with UK (per-state label) + JP
- `src/lib/states/regionalExecutive.test.ts` - coverage for new branches

### Phase 2 - Election plumbing

Goal: governor elections actually create + resolve for UK SCO/WAL/NIR/LON and JP
regions on their 4-year cycles.

- Audit `perpetualElections.ts` (and country-specific election phases) to confirm
  governor elections fire for UK regions in {SCO, WAL, NIR, LON} and all 8 JP
  region ids. Add seat-creation paths if missing.
- Verify `CYCLE_TURNS.governor = 192` is applied for both countries (it should be
  - the constant is country-agnostic).
- Verify preset-aware cycle anchoring picks up the 1991 / 2019 anchor correctly
  via `electionToLarpYear()`.

### Phase 3 - NPC seeding

- Add seat entries in `historicalSeats.ts` for the 12 new seats × 2 presets.
- Generic-name NPC creation in `seedUK.ts` and `seedJP.ts` (e.g. "Scotland
  First Minister", "Mayor of London", "Hokkaido Governor" - display string only;
  no fabricated personal name).
- Insert into `electedOfficials` with `electedAt` = preset anchor; insert
  matching `characters` rows.

### Phase 4 - UI verification + wiki + label polish

- Verify chip surfaces on UK + JP state pages.
- Per-state label for UK bill-assent title (Mayor of London vs First Minister).
  Currently `getRegionalBillAssentTitle(UK)` returns "First Minister" country-wide;
  may need state-aware variant for LON.
- Wiki copy on `partyOrganization.ts` + state-overview docs for devolved execs.
- Verify `OfficialsSection.tsx` lists these officials on the state Politics tab.

## Open questions

- **JP `governor.termYears: 6`** - JP config says 6 years, but `CYCLE_TURNS.governor`
  is 192 (4 yr). The cycle constant wins at runtime; the config metadata is
  informational. Should JP config be updated to `termYears: 4` for consistency?
  (User confirmed "4 years, on its own cycle" - leaning yes, but flagging.)
- **Mayor of London party-strength weight** - full +1.0 PSW like the FMs, or
  lower given its smaller jurisdiction? Defer to Phase 2.
- **1991 ruling parties for seeds** - research/lock during Phase 3.

## Non-goals

- No new OfficeType discriminants - `governor` is recycled.
- No indirect / parliamentary election mechanism for UK FMs (locked by user).
- No 47-prefecture governor system for JP (game models 8 regions).
- No new collections - re-use `electedOfficials` + `characters` + `elections`.
- No new turn-engine phases - existing election + action-refresh phases already
  handle `governor`.
