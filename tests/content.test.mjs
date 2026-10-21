import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, sleep, rec } from './harness.mjs';

const settle = () => sleep(450);

// Matchup table used by most tests. win_rate is the rate of `civilization` against `other_civilization`.
const DATA = [
  rec('Knights Templar', 'Mongols', 51), rec('Mongols', 'Knights Templar', 49),
  rec('Rus', 'Mongols', 55), rec('Japanese', 'Mongols', 50), rec('Ayyubids', 'Mongols', 52),
  rec('French', 'Mongols', 48), rec('English', 'Mongols', 47), rec('Chinese', 'Mongols', 53),
  rec('Rus', 'Knights Templar', 44), rec('Japanese', 'Knights Templar', 51.9),
];
const base = { host: ['Knights Templar'], guest: ['Mongols'], data: DATA };

test('only runs on draft pages, on both aoe2cm hosts', async () => {
  for (const url of ['https://www.aoe2cm.net/', 'https://www.aoe2cm.net/preset/abc', 'https://aoe2cm.net/']) {
    const p = createPage({ ...base, url }); await settle();
    assert.equal(p.$('#aoe4cp-left'), null, url);
    assert.equal(p.$('#aoe4cp-settings'), null, url);
  }
  for (const url of ['https://www.aoe2cm.net/draft/yvuAq', 'https://aoe2cm.net/spectate/yvuAq']) {
    const p = createPage({ ...base, url }); await settle();
    assert.ok(p.$('#aoe4cp-left'), url);
    assert.ok(p.$('#aoe4cp-winrate'), url);
  }
});

test('reads host and guest picks separately (regression: both sides used to show the same civs)', async () => {
  const p = createPage({ ...base, host: ['Knights Templar', 'Holy Roman Empire'], guest: ['Mongols', 'Order of the Dragon'] });
  await settle();
  const flagNames = id => p.$$(`#${id} .aoe4cp-flag`).map(b => b.querySelector('img')?.alt ?? b.textContent);
  assert.deepEqual(flagNames('aoe4cp-left-content'), ['Mongols', 'Order of the Dragon']);
  assert.deepEqual(flagNames('aoe4cp-right-content'), ['Knights Templar', 'Holy Roman Empire']);
  assert.match(p.$('#aoe4cp-left-content .aoe4cp-selected').textContent, /Opponent picks:/);
  assert.match(p.$('#aoe4cp-right-content .aoe4cp-selected').textContent, /Your picks:/);
});

test('left panel does not wait once the opponent has picked, even if you picked as many', async () => {
  const p = createPage(base); await settle();
  assert.doesNotMatch(p.$('#aoe4cp-left-content').textContent, /Waiting/);
  assert.ok(p.rows('aoe4cp-left-content').length > 0);
});

test('shows waiting text when the opponent has no pick yet', async () => {
  const p = createPage({ ...base, guest: [] }); await settle();
  assert.match(p.$('#aoe4cp-left-content').textContent, /Waiting for opponent picks/);
});

test('win rates are coloured: >=52 green, 48-52 yellow, <48 red; "min" label is gone', async () => {
  const p = createPage(base); await settle();
  p.$('#aoe4cp-set-count').value = '10'; p.fire(p.$('#aoe4cp-set-count'), 'input'); await sleep(50);
  const all = Object.fromEntries(p.rows('aoe4cp-left-content').map(r => [r.name, r]));
  assert.match(all['Rus'].cls, /wr-good/);        // 55%
  assert.match(all['Ayyubids'].cls, /wr-good/);   // 52% boundary is green
  assert.match(all['Japanese'].cls, /wr-neutral/);// 50%
  assert.match(all['French'].cls, /wr-neutral/);  // 48% boundary is yellow
  assert.match(all['English'].cls, /wr-bad/);     // 47%
  assert.doesNotMatch(p.$('#aoe4cp-left-content').textContent, /\bmin\b/);
});

test('top bar: leading captain green, trailing red', async () => {
  const p = createPage(base); await settle();
  const spans = p.$$('#aoe4cp-winrate-body span');
  assert.deepEqual(spans.map(s => s.textContent), ['51.0%', '49.0%']);
  assert.match(spans[0].className, /wr-good/);
  assert.match(spans[1].className, /wr-bad/);
});

test('clicking a flag shows counters against that civ only, clicking again goes back', async () => {
  const p = createPage({ ...base, guest: ['Mongols', 'Knights Templar'], host: ['Japanese'] }); await settle();
  const flags = () => p.$$('#aoe4cp-left-content .aoe4cp-flag');
  assert.equal(flags().length, 2);
  const combined = p.rows('aoe4cp-left-content').map(r => r.name).join();
  flags()[1].click(); await sleep(50);
  assert.match(flags()[1].className, /active/);
  assert.match(p.$('#aoe4cp-left-content').textContent, /Best counters against Knights Templar only/);
  flags()[1].click(); await sleep(50);
  assert.doesNotMatch(flags()[1].className, /active/);
  assert.equal(p.rows('aoe4cp-left-content').map(r => r.name).join(), combined);
});

test('settings: hidden by default, slider changes the number of counters', async () => {
  const p = createPage(base); await settle();
  assert.ok(p.htmlClasses().includes('aoe4cp-away-settings'));
  const slider = p.$('#aoe4cp-set-count');
  assert.equal(p.rows('aoe4cp-left-content').length, 5); // default
  for (const [n, expected] of [[1, 1], [3, 3], [10, 7]]) { // only 7 civs have data against Mongols in DATA
    slider.value = String(n); p.fire(slider, 'input'); await sleep(30);
    assert.equal(p.rows('aoe4cp-left-content').length, expected, `slider=${n}`);
  }
  slider.value = '1'; p.fire(slider, 'input'); await sleep(30);
  assert.equal(p.store.aoe4cp_settings.counterCount, 1);
});

test('settings: default is Conqueror+ on the current patch; rank and patch can be changed', async () => {
  const p = createPage(base); await settle();
  const last = () => p.requests.at(-1);
  assert.match(last(), /matchups\?patch=10604,10884&rank_level=≥conqueror$/);
  const rank = p.$('#aoe4cp-set-rank'); rank.value = '≥diamond'; p.fire(rank, 'change'); await settle();
  assert.match(last(), /rank_level=≥diamond$/);
  const patch = p.$('#aoe4cp-set-patch'); patch.value = '9999'; p.fire(patch, 'change'); await settle();
  assert.match(last(), /patch=9999&rank_level=≥diamond$/);
  p.$('#aoe4cp-set-reset').click(); await settle();
  assert.match(last(), /patch=10604,10884&rank_level=≥conqueror$/);
});

test('settings: elements can be disabled and the choice is stored', async () => {
  const p = createPage(base); await settle();
  const cb = p.$('#aoe4cp-settings input[data-el="top"]'); cb.checked = false; p.fire(cb, 'change');
  assert.ok(p.htmlClasses().includes('aoe4cp-off-top'));
  assert.equal(p.store.aoe4cp_settings.show.top, false);
  assert.equal(p.$$('#aoe4cp-settings input[data-el]').length, 3);
});

test('panels slide away with their arrow, come back with the edge tab, and the state is stored', async () => {
  const p = createPage(base); await settle();
  p.$('#aoe4cp-left .aoe4cp-arrow').click();
  assert.ok(p.htmlClasses().includes('aoe4cp-away-left'));
  assert.equal(p.store.aoe4cp_away.left, true);
  p.$('#aoe4cp-tab-left').click();
  assert.ok(!p.htmlClasses().includes('aoe4cp-away-left'));
  p.$('#aoe4cp-tab-settings').click();
  assert.ok(!p.htmlClasses().includes('aoe4cp-away-settings'));
});

test('the global button hides everything', async () => {
  const p = createPage(base); await settle();
  p.$('#aoe4cp-toggle').click();
  assert.ok(p.htmlClasses().includes('aoe4cp-ui-hidden'));
  p.$('#aoe4cp-toggle').click();
  assert.ok(!p.htmlClasses().includes('aoe4cp-ui-hidden'));
});

test('civs missing from the built-in list are learned from the data', async () => {
  const data = [rec('yue_fei_legacy', 'mongols', 58), rec('mongols', 'yue_fei_legacy', 42)];
  const p = createPage({ host: [], guest: ['Mongols'], data }); await settle();
  assert.deepEqual(p.rows('aoe4cp-left-content').map(r => r.name), ['Yue Fei Legacy']);
});
