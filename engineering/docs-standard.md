# Documentation Standard for Game Mechanics

This standard covers every page that explains a game mechanic or system, in every Lakeside game published on this site: A House Divided, Corporate Warfare, Margin of Victory, Grand Century and A House Divided Desktop. It also says how pages are audited against it. The check IDs (`P1`, `T2`, `R3` and so on) are what audit reports cite.

## Two layers per mechanic

Every mechanic has two linked pages.

- **Player page.** For someone playing the game. Explains what the system does, the numbers you make decisions with, and what you can do about it. In A House Divided this is the in-game wiki (`src/lib/seeds/wiki/` in the game repo), which this site also renders. In the other games it is the player guide.
- **Technical page.** For someone who wants the exact rules or wants to change them. Every constant with the file it comes from, full formulas, when it runs, and edge cases. In A House Divided these are the `design/` docs, and docs suffixed `-as-shipped` already follow this shape.

A small game may keep both layers in one file only if the technical part sits under its own `## Exact rules` heading at the bottom. A mechanic too small to deserve two pages belongs as a section of a larger page, not as a thin page of its own.

## Page types

Not every page is a mechanic page. The audit applies the full checklist only to mechanic pages.

| Type | Examples | Rules that apply |
| --- | --- | --- |
| Mechanic | Labour, Freight, War, Polls and scoring | Everything below |
| Guide | Getting started, first campaign walkthrough | Hard rules, accuracy, links, quality and visuals |
| Reference | Glossary, country hubs, scenario lists | Hard rules, accuracy, links |
| History | Changelogs, beta and iteration notes | Hard rules only |

## Player page

A player page is written for this system, not filled into a template. It must contain the content below, but its headings, order and shape follow the subject: name sections after what the player is doing or deciding ("Setting wages", "When a strike starts", "Losing a confidence vote"), not after a generic slot. Two pages about different systems should not read alike.

Required content, in whatever shape fits:

- **Opening.** The first paragraph says what the system is and why a player should care, in words specific to it. No stock opening line shared with other pages.
- **The numbers that matter.** The caps, cooldowns, costs, thresholds and durations a player plans around, usually as a table placed where the reader first needs them. At most one formula, and only when knowing it changes how you play.
- **What you can do.** The actions, who can take them, and where they are in the game. This can be its own section, woven through the page step by step, or both.
- **An example with real numbers.** Told as a situation a player would actually be in, not as a generic "Worked example" block bolted on at the end.
- **Connections.** What drives this system and what it affects, with the direction of each effect, linked. Where it reads naturally, put a link in the sentence that explains the effect; keep a short list only for links that do not fit the prose. Connections must still be two-way across the wiki.
- **Footer.** One closing line covering where the system applies (if it depends on era, country, mode or scenario), when the page was last checked and against which version, and the link to the technical page. Example: `Applies in every era. Last checked 2026-10-29, version 1.18.0. Exact rules: [Labour (design)](...)`.

### Avoiding the template feel

- Do not default to the headings "How it works", "What you can do", "Connections", "Status" or "Technical detail". Use them only when nothing more specific fits.
- Vary how pages open. Lead with the decision, the stakes, or the moment a player first meets the system.
- Answer common questions where they arise in the text; avoid a "Common questions" dump unless the page really is a list of questions.
- Cut filler that every page could carry ("This system is an important part of the game").
- A short page for a small system is fine. Do not pad to fill slots.

## Technical page

Technical pages are reference material and use a fixed structure, so a reader can find the same thing in the same place on every page. Use these headings in this order.

1. **Summary** and a link back to the player page.
2. **Rules.** Every constant with its real value and the source file it lives in, in backticks. Full formulas.
3. **Data.** The collections, documents and fields the system reads and writes, and which of them are player-visible.
4. **Configuration.** Every setting that changes behaviour (game config fields, era or country presets, scenario overrides, flags), with its default and where it is set.
5. **Timing.** When it runs: which turn phase, tick or event, and in what order relative to related systems. A diagram when it spans more than one phase or more than two source files.
6. **Worked trace.** One concrete input followed through every formula to the stored result, with the intermediate numbers.
7. **Edge cases and limits.** Caps, floors, clamps, what happens at zero, missing data, era and country variants, and what is deliberately excluded and why.
8. **Invariants.** What must always hold (money conserved, totals sum, values stay in range), and which tests or checks enforce it.
9. **Failure and recovery.** How it can go wrong in production, what it looks like, and how it is repaired (a heal, a reseed, a rerun), without operational secrets or internal hosts.
10. **Connections.** Driven by and Affects lists, naming the code path where the effect passes between systems.
11. **Tests.** The test files that cover it and any known gaps.
12. **Known issues and history.** Open defects, behaviour that differs from the player page or real-world expectation, and dated notes on major changes.
13. **Last checked** line with date and version.

## Quality and depth

A page can have every section and still be thin. These rules are about whether a player finishes the page able to make a good decision.

- **Complete.** Covers every decision the system offers the player, including the edge cases players actually hit (what happens at zero, at the cap, when you lose office, when the country changes era), not only the happy path.
- **Worked example.** At least one concrete example with real numbers: "a sector at wage level 1.2 in a state with median income X pays Y and gains Z workers over N turns".
- **Answers real questions.** The questions players ask most about this mechanic in support tickets and community channels are answered on the page. If a question keeps coming up, the page is missing something.
- **Explains why.** Says what the rule is for, the way Grand Century's war page explains why combat width exists. A player who knows the reason can predict edge cases the page does not list.
- **Readable.** Plain words. Jargon is defined or linked to the glossary the first time it appears. No paragraph runs past about 120 words; break it into steps, a list or a table.
- **Right size.** Long enough to cover the above, no padding. A mechanic page under about 250 words is almost always too thin; one over about 2,000 words should probably be split.

## Visuals

Pictures carry what prose cannot. Each visual earns its place by answering a question faster than text would.

| Visual | Required when | Rule |
| --- | --- | --- |
| **Screenshot** | The page tells a player to do something in the game's interface | Shows the screen where the action happens, cropped to the relevant panel, with no real player names or private data. Alt text says what it shows. Retaken when that screen changes. |
| **Chart** | A value changes over a range or over time: decay, scaling with a stat, caps that bend, price curves, cooldown cycles | Generated from the game's constants by code, never drawn from hand-typed numbers, so it cannot drift from the game. Labelled axes with units. |
| **Diagram** | The system has a multi-step flow, or three or more connections to other systems | Shows the flow or the Driven by and Affects links. In A House Divided, use or add a wiki widget (see `src/lib/wiki/componentRegistry.ts`) so the diagram renders in game. |

Technical pages need a diagram when the system runs across more than one turn phase or more than two source files, showing the order things happen in.

In A House Divided, screenshots live in `public/wiki-images/guides/` and are embedded with `![alt](/wiki-images/guides/<name>.png)`; charts and diagrams are wiki widgets. In the other games, images sit next to the page and charts are SVG files produced by a script in the game repo that reads the game's own constants.

## Hard rules (every page type)

- **Accurate.** Every number and claim matches the current game. When a page and the code disagree, the code wins and the page is the bug.
- **Actionable.** Player pages never show admin controls, rollout tiers, feature flags or internal switches a player cannot act on. If a mechanic is off in some worlds, say so in Status in player terms.
- **Public safe.** No server paths, internal hostnames, operational runbooks, secrets or player names.
- **House style.** Plain direct prose. No em or en dashes. `##` sections. Tables for numbers. Real values, never "about" when the exact value is known.
- **Linked.** Internal links resolve. A mechanic named on a page that has its own page is linked at least once.

## Checklist

The audit marks each check pass, fail or not applicable.

### Player page

| ID | Check |
| --- | --- |
| P1 | Opening says what the system is and why it matters, in words specific to it |
| P2 | Explains cause and effect in plain language, structured around the player's decisions |
| P3 | Gives the decision-relevant numbers, usually as a table where they are first needed |
| P4 | Has no more than one formula, and any formula changes play |
| P5 | Names the actions, who can take them and where they are |
| P6 | Covers what drives the system and what it affects, with direction, linked |
| P7 | Connections are two-way across the wiki |
| P8 | Says where the system applies when it depends on era, country, mode or scenario |
| P9 | Has a Last checked date and version |
| P10 | Links to its technical page |
| P11 | Reads as written for this system: headings named after its subject, no generic template headings unless nothing fits, no stock opening or filler |

### Technical page

| ID | Check |
| --- | --- |
| T1 | Links back to the player page |
| T2 | Every constant has its value and source file |
| T3 | Formulas are complete |
| T4 | States when it runs |
| T5 | Covers edge cases and limits |
| T6 | Every number on the player page also appears here with its source |
| T7 | Has a Last checked date |
| T8 | Lists the data the system reads and writes |
| T9 | Lists every setting that changes behaviour, with defaults and where it is set |
| T10 | Has a worked trace from input to stored result with intermediate numbers |
| T11 | States the invariants and what enforces them |
| T12 | Describes failure modes and how each is repaired |
| T13 | Names the tests that cover it and known gaps |
| T14 | Records known issues and dated major changes |
| T15 | Uses the fixed technical headings in order |

### Quality and visuals

| ID | Check |
| --- | --- |
| Q1 | Covers every player decision the system offers, including common edge cases |
| Q2 | Has at least one worked example with real numbers |
| Q3 | Answers the most common player questions about this mechanic |
| Q4 | Explains why the rule exists, not only what it is |
| Q5 | Readable: jargon defined or linked, no paragraph over about 120 words |
| Q6 | Right size for the mechanic: not a stub, not a page that should be split |
| Q7 | Has a screenshot wherever it tells the player to act in the interface |
| Q8 | Has a constants-generated chart wherever a value changes over a range or time |
| Q9 | Has a diagram for multi-step flows or three or more connections |

Q1 to Q6 apply to mechanic and guide pages; on technical pages Q2 is replaced by T10. Q7 to Q9 apply to player mechanic and guide pages; technical pages are checked for the phase-order diagram under T4.

### Hard rules

| ID | Check |
| --- | --- |
| R1 | No wrong numbers or claims (see accuracy below) |
| R2 | No player-facing admin, rollout or flag material |
| R3 | No internal paths, hosts, runbooks, secrets or player names |
| R4 | No em or en dashes |
| R5 | All internal links resolve |

## Accuracy check

For every number and factual claim on a page, the auditor finds where it comes from in the game's code and marks it:

- **Correct.** Matches, with the source cited.
- **Wrong.** Does not match. The report gives the real value and its source.
- **Stale.** Describes behaviour that was removed or replaced.
- **Unverifiable.** No source could be found. Treated as a defect on a technical page, a warning on a player page.

## Severity

Audit findings are ranked for fixing in this order.

1. **Critical.** A wrong number or claim a player would act on, or anything failing R3.
2. **High.** Stale behaviour, a mechanic with no player page, or a player page showing material players cannot act on (R2).
3. **Medium.** Missing required content, a player page that reads as a template (P11), one-way connections, missing technical layer, a mechanic page that fails Q1 or Q2, or a missing chart or screenshot the page clearly needs.
4. **Low.** Style, dashes, missing Last checked line, broken non-critical links, readability (Q5), and other missing visuals.

Within a severity band, pages players visit most come first.
