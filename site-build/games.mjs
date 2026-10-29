// Game registry for docs.lakesidegames.net.
//
// A House Divided owns the site root and is built by build.mjs, which pulls its
// pages from the game repo's wiki seed plus this repo's design/engineering/api
// trees. Every other game is a "satellite": a curated list of markdown files in
// its own repo, rendered by build-game.mjs into /g/<slug>/ with the same theme.
//
// Curation is deliberate and explicit rather than a directory glob. These repos
// are private and their docs trees mix player-facing design with deploy runbooks
// and status reports; a glob would publish the runbooks. Every file listed below
// was read and cleared. Files NOT listed are excluded on purpose — see the
// `excluded` note on each game for the ones that were rejected and why.

// This registry is published in a public repo, so it carries no server paths.
// rebuild-lakeside-docs.sh supplies the real locations; the fallbacks assume a
// sibling-checkout layout so a fresh clone still resolves something sane.
const REPO_ROOT = process.env.LAKESIDE_REPO_ROOT
  || new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
// DOCS_REPO_<NAME> (e.g. DOCS_REPO_GRAND_CENTURY) points one game at a clean
// checkout of its release branch, so a stale or dirty working copy never ships.
const gameRepo = (name) =>
  process.env[`DOCS_REPO_${name.replace(/-/g, "_").toUpperCase()}`] || `${REPO_ROOT}/${name}`;

// The Lakeside Docs mark, used as the logo for any game without its own icon.
export const LAKESIDE_MARK = process.env.LAKESIDE_MARK
  || new URL("./assets/docs-mark.svg", import.meta.url).pathname;

// Docs written for publication in this repo, for games whose own repo has no
// player-facing docs tree.
const DOCS_REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** A House Divided. Built by build.mjs; listed here so the switcher can link it. */
export const AHD = {
  slug: "ahd",
  name: "A House Divided",
  short: "A House Divided",
  base: "",
  site: "https://www.ahousedividedgame.com",
  github: "https://github.com/lakesidegamedev/AHDGame",
  logo: "/ahd-logo.png",
  askGame: "ahd",
  live: true,
};

export const SATELLITES = [
  {
    slug: "corporate-warfare",
    name: "Corporate Warfare",
    short: "Corporate Warfare",
    base: "/g/corporate-warfare",
    // The game repo's docs tree is design rules and planning, written for the
    // engine rather than for players, and its README is out of date. The player
    // guide lives here instead, sourced from the game's CHANGELOG.
    repo: DOCS_REPO,
    site: "https://lakesidegames.net/download/corporate-warfare/",
    github: "https://github.com/lakesidegamedev/corporate-warfare",
    logo: "games/corporate-warfare/logo.png",
    askGame: "corporate-warfare",
    tagline:
      "An offline, single-player economic strategy game. Build a holding company, fight named rivals for every market, and ride business cycles, elections and world commodity prices across four historical scenarios. Free while in development.",
    excluded: [],
    sections: [
      {
        key: "playing",
        label: "Playing",
        groups: [
          {
            label: "Start here",
            files: [
              "games/corporate-warfare/overview.md",
              "games/corporate-warfare/getting-started.md",
              "games/corporate-warfare/scenarios.md",
            ],
          },
        ],
      },
      {
        key: "systems",
        label: "Game Systems",
        groups: [
          { label: "Your companies", files: ["games/corporate-warfare/companies.md"] },
          {
            label: "The economy",
            files: [
              "games/corporate-warfare/regions-and-labour.md",
              "games/corporate-warfare/commodity-exchange.md",
              "games/corporate-warfare/freight.md",
            ],
          },
          {
            label: "The world",
            files: [
              "games/corporate-warfare/rivals.md",
              "games/corporate-warfare/governments.md",
              "games/corporate-warfare/currencies.md",
            ],
          },
        ],
      },
      {
        key: "reference",
        label: "Reference",
        groups: [{ label: "History", files: ["games/corporate-warfare/changelog.md"] }],
      },
    ],
  },
  {
    slug: "grand-century",
    name: "Grand Century",
    short: "Grand Century",
    base: "/g/grand-century",
    repo: gameRepo("grand-century"),
    site: "https://lakesidegames.net/games/grand-century/",
    github: "https://github.com/lakesidegamedev/grand-century",
    // Its own icon.
    logo: "public/icons/icon-192.png",
    logoName: "grand-century.png",
    askGame: "grand-century",
    tagline:
      "A single-player browser grand strategy game about the long nineteenth century: population, industry, diplomacy and war on a historical 1830 map.",
    // Rejected: MULTIPLAYER-DEPLOY.md and RELEASE.md (server paths, systemd and
    // deploy commands), MORNING-REPORT.md (internal status snapshot), and the
    // ROADMAP-*.md series — those describe what was planned, not what the game
    // does. The systems/ and engineering/ docs below replaced them.
    excluded: ["docs/MULTIPLAYER-DEPLOY.md", "docs/RELEASE.md", "MORNING-REPORT.md", "docs/ROADMAP-*.md"],
    dropSections: [/execution workflow/i],
    sections: [
      {
        key: "systems",
        label: "Game Systems",
        groups: [
          { label: "Core Loop", files: ["docs/systems/time-and-the-tick.md"] },
          {
            label: "Economy",
            files: [
              "docs/systems/population.md",
              "docs/systems/production-and-industry.md",
              "docs/systems/the-world-market.md",
              "docs/systems/budget-and-taxation.md",
            ],
          },
          {
            label: "Nation",
            files: [
              "docs/systems/politics-and-reform.md",
              "docs/systems/culture-and-nationalism.md",
              "docs/systems/research.md",
            ],
          },
          {
            label: "The World",
            files: [
              "docs/systems/diplomacy.md",
              "docs/systems/war.md",
              "docs/systems/crises.md",
              "docs/systems/events-and-decisions.md",
              "docs/systems/ai-nations.md",
            ],
          },
        ],
      },
      {
        key: "engineering",
        label: "Engineering",
        groups: [
          {
            label: "Contributing",
            files: [
              "docs/engineering/architecture.md",
              "docs/engineering/simulation-loop.md",
              "docs/engineering/snapshots-and-protocol.md",
            ],
          },
        ],
      },
      {
        key: "reference",
        label: "Reference",
        groups: [
          { label: "Design", files: ["README.md", "docs/MASTER.md"] },
          { label: "World Data", files: ["docs/HISTORICAL-MAP-SOURCE-AUDIT.md"] },
          { label: "History", files: ["CHANGELOG.md"] },
        ],
      },
    ],
  },
  {
    slug: "margin-of-victory",
    name: "Margin of Victory",
    short: "Margin of Victory",
    base: "/g/margin-of-victory",
    // The game repo's docs tree is release, store and port planning, not player
    // docs. The player guide lives here, sourced from the game's README,
    // CHANGELOG, in-game guide and scenario registry. The web game keeps its
    // old /games/electioneer/ address for saves and purchases.
    repo: DOCS_REPO,
    site: "https://lakesidegames.net/games/electioneer/",
    github: "https://github.com/lakesidegamedev/MOVGame",
    logo: "games/margin-of-victory/logo.png",
    // Ask still keys this game by its old id and shows it as Margin of Victory.
    askGame: "electioneer",
    tagline:
      "A single-player, turn-based election campaign game: 49 real elections across six countries, 1951 to 2027. You are the campaign manager.",
    excluded: [],
    sections: [
      {
        key: "playing",
        label: "Playing",
        groups: [
          {
            label: "Start here",
            files: [
              "games/margin-of-victory/overview.md",
              "games/margin-of-victory/getting-started.md",
              "games/margin-of-victory/elections.md",
            ],
          },
        ],
      },
      {
        key: "systems",
        label: "Game Systems",
        groups: [
          {
            label: "Campaigning",
            files: [
              "games/margin-of-victory/the-campaign-week.md",
              "games/margin-of-victory/campaign-actions.md",
            ],
          },
          {
            label: "The vote",
            files: [
              "games/margin-of-victory/voter-blocs.md",
              "games/margin-of-victory/polls-and-scoring.md",
            ],
          },
        ],
      },
      {
        key: "reference",
        label: "Reference",
        groups: [{ label: "History", files: ["games/margin-of-victory/changelog.md"] }],
      },
    ],
  },
];

/**
 * Docs that are not a game. The A House Divided desktop client is part of A
 * House Divided, so it does not belong in a game switcher — but it still needs
 * a docs home and a way to be found. It builds like a satellite and appears in
 * the switcher menu under its own heading.
 */
export const EXTRAS = [
  {
    slug: "desktop",
    name: "A House Divided Desktop",
    short: "Desktop client",
    base: "/desktop",
    repo: gameRepo("ahd-client"),
    site: "https://github.com/lakesidegamedev/ahd-client/releases",
    github: null,
    logo: "assets/ahd-logo.png",
    askGame: "ahd",
    switcher: false,
    tagline:
      "The desktop client for A House Divided: native windows, pop-outs, a mini status view, tray notifications and global shortcuts around the same game you play in a browser.",
    // Rejected: docs/README.md (an index of two files) and test-pip-fix.md (a
    // scratch note).
    excluded: ["docs/README.md", "test-pip-fix.md"],
    sections: [
      {
        key: "features",
        label: "Features",
        groups: [
          { label: "Using the client", files: ["docs/features/what-the-desktop-client-adds.md"] },
        ],
      },
      {
        key: "engineering",
        label: "Engineering",
        groups: [{ label: "Contributing", files: ["docs/architecture.md", "CONTRIBUTING.md"] }],
      },
      {
        key: "reference",
        label: "Reference",
        groups: [{ label: "Overview", files: ["README.md", "CHANGELOG.md"] }],
      },
    ],
  },
];

/**
 * Old /g/<slug>/ paths that no longer build. build-game.mjs deletes their output
 * and the web server redirects them: retired games go to the docs home, renamed
 * games go to their new path.
 */
export const RETIRED = [
  { slug: "metroforge", to: "/" },
  { slug: "verdigris", to: "/" },
  { slug: "electioneer", to: "/g/margin-of-victory/" },
];

/** Everything built by build-game.mjs. */
export const BUILDABLE = [...SATELLITES, ...EXTRAS];

/** Games in the switcher, A House Divided first. Excludes non-game docs. */
export const ALL_GAMES = [AHD, ...SATELLITES];

export const ASK_URL = "https://ask.lakesidegames.net";

/** Deep link into Ask with this game preselected. */
export const askHref = game => `${ASK_URL}/?game=${encodeURIComponent(game.askGame)}`;
