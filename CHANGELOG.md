# Changelog

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
