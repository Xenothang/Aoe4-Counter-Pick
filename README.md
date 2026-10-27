# AoE4 Counter Pick for AoE2CM

A browser extension for **Firefox, Chrome, Edge, Brave and other Chromium browsers** that adds counter-pick help to [aoe2cm.net](https://aoe2cm.net) drafts for **Age of Empires IV**.
While a draft is running it reads the picks of both captains and shows the best counters, using ranked-solo matchup statistics from [AoE4World](https://aoe4world.com).

> Unofficial fan project. Not affiliated with or endorsed by AoE2CM, AoE4World, Microsoft or World's Edge.

<img width="1891" height="905" alt="grafik" src="https://github.com/user-attachments/assets/2a162094-6dc8-437a-9ab8-cfe123408a12" />


## Features

- **Counter panels** – neutral, so it works for both captains and for spectators: left = the host's best counters against the guest's picks, right = the guest's best counters against the host's picks. With several picks, civs are ranked by their *worst* matchup (maximin), then by their average win rate.
- **Civ flags** – click a flag to see the best counters against that single civ; **Shift+click** to select several civs (and to remove them again); click the only selected flag again to go back to all picks.
- **Draft win-rate estimate** (top bar) – host vs. guest, the leading captain in green, the trailing one in red.
- **Map bar** – the map(s) picked in a map draft stay visible under the win-rate bar, also in the separate civ draft that follows (remembered across drafts for 24 h; new picks are added: Map 1, Map 2, …; the newest is highlighted).
- **Civ pools** – "Host pool" / "Guest pool" flags in the side panels show the civs each captain picked in the civ pick/ban draft. They are saved (24 h) and shown again in the civ picker draft that follows, so you can see what can be chosen there. Can be switched off in the settings.
- **Colour-coded win rates** – ≥ 52 % green, 48–52 % yellow, < 48 % red.
- **Settings** (⚙ tab at the right edge, hidden by default) – number of counters (1–10), rank of the data (default Conqueror+), patch (default: always the current patch), and which panels are shown.
- Every panel can slide out of the way with its arrow; a tab at the screen edge brings it back. A button at the bottom centre hides or shows everything.
- Only active on draft pages (`/draft/<id>`, `/spectate/<id>`).

## Install

### Firefox

**[Get it on Firefox Add-ons](https://addons.mozilla.org/firefox/addon/aoe4-counter-pick-for-aoe2cm/)** and click *Add to Firefox*. It is signed by Mozilla and updates automatically.

> If no matchup data loads after installing, open `about:addons` → *AoE4 Counter Pick for AoE2CM* → *Permissions* and make sure access to `aoe4world.com` is allowed. The extension needs it to download the win-rate statistics.

**!!!Please set the Website Language to English!!!**

**Chrome / Edge / Brave / Opera / Vivaldi**: unzip the Chrome build, open `chrome://extensions` (or `edge://extensions`), enable *Developer mode* → *Load unpacked* → choose the unzipped folder.

### From source

```bash
git clone https://github.com/Xenothang/Aoe4-Counter-Pick.git
cd Aoe4-Counter-Pick
npm install
npm run build          # → dist/firefox, dist/chrome and the two zips in dist/
```

## How it works

- **Pick detection:** reads `#player-host` / `#player-guest` → `.picks .civ-panel.pick.has-value .stretchy-text` from the AoE2CM draft DOM. If AoE2CM changes its markup this is the place to look (`readSidePicks` in `content.js`).
- **Data:** `https://aoe4world.com/api/v0/stats/rm_solo/matchups?patch=…&rank_level=…`. The patch and rank lists are read from the AoE4World stats page, so new patches and ranks show up without an update. Matchup data is cached locally for 6 hours.
- **New civilizations** that are not in the built-in list are learned from the API data automatically.
- **Civ pool across drafts:** the civ pick/ban draft builds the pool: a draft counts as the *source* if civs are banned in it or its title contains "civ" and "draft". Its pool is saved and shown again in the civ picker, which is recognised by its snipes, by "picker"/"snipe" in its title, or by picking only civs that are already in the saved pool. The picker never overwrites the saved pool. The host/guest sides are assumed to be the same in both drafts.
- **Civ or map?** An option counts as a civ if its flag image is under `/flag/` (map images are under `/maps/`); otherwise its name is checked against the known civs and the AoE4World data. Maps and civs can be mixed in one draft.
- **Draft info:** every filled turn panel (`#panel-turn-N`) is remembered per draft ID in the extension storage (20 most recent drafts). Names that are not civilizations (checked against the AoE4World civ list) count as maps. Picked maps are also stored in a separate, cross-draft list (one entry per draft ID and turn, kept 24 h after they were last seen), because a game usually has one draft for the map and another one for the civs. A civ's *first* pick by a captain defines that captain's pool, so later picks of the same civ do not add it twice. If the map or pool bar stays empty on a real draft, use **Settings → Copy debug info** and attach the result to an issue – it lists every turn panel with its CSS classes and parent elements.

## Known limitations

- Civs without matchup data (brand-new releases) are shown but left out of the ranking until AoE4World has data for them.
- Sniped picks are not removed from the lists, and during the civ picker the counter panels still use every civ on a captain's panels (the whole pool), not only the final picks.
- Maps are matched across drafts only by time (the last 24 h), not by tournament or game. Use *Settings → Clear saved drafts* when you start an unrelated series.
- If the AoE4World stats page cannot be parsed, a built-in rank list is used; its API values have not been verified against the live API.

## Privacy

The extension collects no personal data and has no tracking – see [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE) · Matchup data © AoE4World contributors, used via their public API.
