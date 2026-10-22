# AoE4 Counter Pick for AoE2CM

A browser extension for **Firefox, Chrome, Edge, Brave and other Chromium browsers** that adds counter-pick help to [aoe2cm.net](https://aoe2cm.net) drafts for **Age of Empires IV**.
While a draft is running it reads the picks of both captains and shows the best counters, using ranked-solo matchup statistics from [AoE4World](https://aoe4world.com).

> Unofficial fan project. Not affiliated with or endorsed by AoE2CM, AoE4World, Microsoft or World's Edge.

<img width="1891" height="905" alt="grafik" src="https://github.com/user-attachments/assets/2a162094-6dc8-437a-9ab8-cfe123408a12" />


## Features

- **Counter panels** – neutral, so it works for both captains and for spectators: left = the host's best counters against the guest's picks, right = the guest's best counters against the host's picks. With several picks, civs are ranked by their *worst* matchup (maximin), then by their average win rate.
- **Civ flags** – click a flag to see the best counters against that single civ; click again to go back to all picks.
- **Draft win-rate estimate** (top bar) – host vs. guest, the leading captain in green, the trailing one in red.
- **Colour-coded win rates** – ≥ 52 % green, 48–52 % yellow, < 48 % red.
- **Settings** (⚙ tab at the right edge, hidden by default) – number of counters (1–10), rank of the data (default Conqueror+), patch (default: always the current patch), and which panels are shown.
- Every panel can slide out of the way with its arrow; a tab at the screen edge brings it back. A button at the bottom centre hides or shows everything.
- Only active on draft pages (`/draft/<id>`, `/spectate/<id>`).

## Install

### From a release (recommended while the store listings do not exist)

Download the zip for your browser from the [Releases](../../releases) page.

**Firefox** (temporary, until the add-on is signed/published): open `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → pick `manifest.json` from the unzipped folder (or the zip itself). Temporary add-ons are removed when Firefox restarts.

**!!!Please set the Website Language to English!!!**

**Chrome / Edge / Brave / Opera / Vivaldi**: unzip the Chrome build, open `chrome://extensions` (or `edge://extensions`), enable *Developer mode* → *Load unpacked* → choose the unzipped folder.

### From source

```bash
git clone https://github.com/Xenothang/Aoe4-Counter-Pick.git
cd Aoe4-Counter-Pick
npm install
npm run build          # → dist/firefox, dist/chrome and the two zips in dist/
```

## Development

```
src/
  content.js            UI + logic, runs on aoe2cm.net
  background.js         fetches AoE4World data (content scripts are bound by the page's CORS rules)
  styles.css
  manifest.base.json    shared manifest
  manifest.firefox.json Firefox-only keys (event page background, gecko id)
  manifest.chrome.json  Chromium-only keys (service worker)
scripts/build.mjs       zero-dependency build + zip packaging
tests/                  node:test + jsdom
```

| Command | What it does |
| --- | --- |
| `npm test` | unit/integration tests against a mock of the draft page |
| `npm run build` | builds both browsers (`build:firefox`, `build:chrome` for one) |
| `npm run lint:firefox` | `web-ext lint` on the Firefox build (run `npm run build` first) |

The version number lives in `package.json` only; the build writes it into both manifests.

### How it works

- **Pick detection:** reads `#player-host` / `#player-guest` → `.picks .civ-panel.pick.has-value .stretchy-text` from the AoE2CM draft DOM. If AoE2CM changes its markup this is the place to look (`readSidePicks` in `content.js`).
- **Data:** `https://aoe4world.com/api/v0/stats/rm_solo/matchups?patch=…&rank_level=…`. The patch and rank lists are read from the AoE4World stats page, so new patches and ranks show up without an update. Matchup data is cached locally for 6 hours.
- **New civilizations** that are not in the built-in list are learned from the API data automatically.

### Known limitations

- Sniped picks are not removed from the lists.
- If the AoE4World stats page cannot be parsed, a built-in rank list is used; its API values have not been verified against the live API.

## Releasing

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Commit, then `git tag v0.5.1 && git push --tags`.
3. The *Release* workflow builds both zips and attaches them to a GitHub release.

### Store submission (manual)

- **Firefox Add-ons (AMO):** upload `aoe4-counter-pick-<version>-firefox.zip`. The add-on ID (`browser_specific_settings.gecko.id` in `src/manifest.firefox.json`) is fixed after the first submission – never change it, or Firefox treats the add-on as a different one.
- **Chrome Web Store:** upload `aoe4-counter-pick-<version>-chrome.zip`. Edge Add-ons accepts the same zip.
- Both stores ask for a privacy statement – see [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE) · Matchup data © AoE4World contributors, used via their public API.
