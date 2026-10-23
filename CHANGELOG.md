# Changelog

## 0.8.0
- **Fix: maps and civs in one draft.** A map picked in the same draft as the civs was read as a civ pick, which emptied the counter panels (a map has no matchup data). Picks are now classified as civ or map by their flag image (civ flags are under `/flag/`, map images under `/maps/`), falling back to the known civ names. Only civs feed the counters, the win-rate bar and the pools; maps go to the map bar.
- **Shift+click** on the civ flags toggles several civs on and off; a plain click still selects only one civ (click it again to show all). The panels end with a tip that explains this.
- Added the new civs **Scots** and **Vikings**. Civs the matchup data does not know yet are shown as flags but left out of the ranking (with a note) instead of emptying it.

## 0.7.0
- **Civ pool is saved across drafts:** the pool built in the civ pick/ban draft is remembered (24 h) and shown again as "Host pool · saved" / "Guest pool · saved" in the following civ picker draft, instead of the picker's own picks. A draft builds the pool when civs are banned in it or its title says "civ draft"; the picker never overwrites the saved pool.
- "Clear saved drafts" also clears the saved pool. The pools can still be switched off in the settings (*Civ pools*).

## 0.6.1
- **Fix:** the map picked in a map draft is now remembered across drafts, so it still shows in the separate civ draft of the same game. Maps are listed in the order they were picked (Map 1, Map 2, …), the newest one is highlighted, and the tooltip names the draft it came from. Maps not seen for 24 hours disappear again.

## 0.6.0
- **Map bar:** the map(s) picked in the draft are cached and shown in a bar under the win-rate bar, so you do not have to go back to the map picker. New map picks are added as the draft goes on (Map 1, Map 2, …).
- **Civ pools:** the civs each captain picked in the pick/ban phase are cached and shown as "Host pool" / "Guest pool" flags in the side panels – these are the civs available in the later civ picker.
- Both are saved per draft (the 20 most recent drafts) and can be hidden with their arrow or in the settings.
- Settings: new checkboxes for the map bar and the civ pools, "Copy debug info" and "Clear saved drafts" buttons.

## 0.5.1
- Neutral wording so the addon works for both captains and spectators: "Host best counter" (left, counters against the guest's picks) and "Guest best counter" (right, counters against the host's picks). No more "Your" / "Opponent".

## 0.5.0
- Restructured into a proper repository: `src/`, build script, tests, CI.
- Cross-browser: Firefox (MV3 event page) and Chromium browsers (MV3 service worker) from one code base.
- Counter panels no longer show a "min" suffix next to the win rate (tooltip explains the value).
- Background fetches are restricted to the two AoE4World endpoints the extension needs.
- Added icons.

## 0.4.0
- Manual civ selector removed; settings panel moved bottom-right.
- Win-rate colours: ≥ 52 % green, 48–52 % yellow, < 48 % red; top bar: leader green, trailing captain red.

## 0.3.0
- Settings panel (hidden by default): counter count slider (1–10), rank, patch, per-element visibility. Diagnostics UI removed.

## 0.2.0
- Draft win-rate estimate moved to the top centre; every panel can slide to the side with an arrow.

## 0.1.9
- Clickable civ flags: click a flag to see the best counters against that civ only.

## 0.1.8
- Match `www.aoe2cm.net`; only active on draft pages; show/hide button.

## 0.1.7
- Fixed host and guest picks being mixed up and the left panel waiting for an opponent pick that had already been made.
- Civs missing from the built-in list are learned from the data.
