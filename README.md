# A House Divided docs

<img src="https://docs.lakesidegames.net/ahd-logo.png" alt="" width="80" align="right">

Design and engineering documentation for [A House Divided](https://github.com/lakesidegamedev/AHDGame), published at [docs.lakesidegames.net](https://docs.lakesidegames.net).

- `design/` covers how every game system works: elections, legislation, parties, the economy, the world.
- `engineering/` covers architecture, conventions, and contribution guides for the game codebase.
- `api/` covers the public REST API.
- `site-build/` is the static site generator.

The published site also includes the player wiki, which lives in the game repo (`src/lib/seeds/wiki/`) so the in-game wiki and the site share one source. The build pulls it in automatically.

## Accuracy

Docs suffixed `-as-shipped` are grounded in the current code and supersede older design docs where they disagree. Older docs describe intent at the time of writing; when a doc and the code disagree, the code wins. Formulas and constants should cite the file they come from. A constant that doesn't match the code is a bug in the doc: PRs fixing those are the most useful contribution here.

Style: plain direct prose, `##` sections, real file paths in backticks, real constant values, no em or en dashes. Any `-as-shipped` doc shows the pattern. Player wiki changes go to the game repo, not here.

## Building the site

```bash
cd site-build
npm install
GAME_REPO=/path/to/AHDGame DOCS_OUT=./out node build.mjs
```

Renders everything to static HTML with the grouped sidebar, cross-reference graph, and sitemap.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE.md), same as the game. "A House Divided" and the logo are trademarks of Lakeside Games.
