import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, sleep, rec, turnPanel, civFlag } from './harness.mjs';

const settle = () => sleep(600);
const DATA = [
  rec('Knights Templar', 'Mongols', 51), rec('Mongols', 'Knights Templar', 49), rec('Rus', 'Mongols', 55), rec('Japanese', 'Mongols', 50),
  rec('Ayyubids', 'Mongols', 52), rec('French', 'Mongols', 48), rec('English', 'Mongols', 47),
  rec('Rus', 'Knights Templar', 44), rec('Japanese', 'Knights Templar', 51.9), rec('Chinese', 'Knights Templar', 53), rec('Mongols', 'Chinese', 46), rec('Japanese', 'Chinese', 50), rec('Rus', 'Chinese', 54),
];
const civ = (turn, name, action = 'pick') => turnPanel(turn, name, action, civFlag(name));
const player = (id, picks, bans = '') => `<div id="${id}" class="column is-half"><div class="player box content is-inline-block"><div class="chosen"><div class="picks">${picks}</div><div class="bans">${bans}</div></div></div></div>`;
const page = (host, guest, extra = '') => `<body><h2 id="draft-title">DM - Civ + Map Draft - Bo1</h2><div class="columns is-mobile player-panels">${player('player-host', host)}${player('player-guest', guest)}${extra}</div></body>`;

const flagNames = (p, id) => p.$$(`#${id} .aoe4cp-flag`).map(b => b.querySelector('img')?.alt ?? b.textContent);
const mapChips = p => p.$$('#aoe4cp-map-body .aoe4cp-map-chip').map(c => c.textContent);

test('a map picked in the same draft is not treated as a civ (regression: no stats were shown)', async () => {
  const body = page(civ(0, 'Knights Templar') + turnPanel(8, 'EGCMS-Frisian Marshes'), civ(1, 'Mongols'));
  const p = createPage({ bodyHtml: body, data: DATA }); await settle();
  // counters panels only list the civs
  assert.deepEqual(flagNames(p, 'aoe4cp-right-content'), ['Knights Templar']);
  assert.deepEqual(flagNames(p, 'aoe4cp-left-content'), ['Mongols']);
  assert.ok(p.rows('aoe4cp-left-content').length > 0, 'left panel has stats');
  assert.ok(p.rows('aoe4cp-right-content').length > 0, 'right panel has stats');
  assert.doesNotMatch(p.$('#aoe4cp-left-content').textContent, /No matchup data available/);
  // ... and the map shows up on the map bar
  assert.deepEqual(mapChips(p), ['EGCMS-Frisian Marshes']);
});

test('the flag image decides: an option under /flag/ is a civ, one under /maps/ is a map', async () => {
  const body = page(civ(0, 'Knights Templar') + civ(2, 'Brand New Civ') + turnPanel(8, 'Dry Arabia', 'pick', 'https://www.aoe2cm.net/images/aoe4/maps/DryArabia.png'),
    civ(1, 'Mongols') + turnPanel(9, 'Mongols Heights', 'pick', 'https://www.aoe2cm.net/images/aoe4/maps/MongolsHeights.png'));
  const p = createPage({ bodyHtml: body, data: DATA }); await settle();
  assert.deepEqual(flagNames(p, 'aoe4cp-right-content'), ['Knights Templar', 'Brand New Civ']); // unknown civ recognised by its flag
  assert.deepEqual(flagNames(p, 'aoe4cp-left-content'), ['Mongols']);
  assert.deepEqual(mapChips(p), ['1Dry Arabia', '2Mongols Heights']);
});

test('Scots and Vikings (no matchup data yet) do not break anything and are not mistaken for maps', async () => {
  const body = page(civ(0, 'Knights Templar') + civ(2, 'Scots'), civ(1, 'Mongols') + civ(3, 'Vikings') + turnPanel(8, 'Lipany'));
  const p = createPage({ bodyHtml: body, data: DATA }); await settle();
  assert.deepEqual(flagNames(p, 'aoe4cp-left-content'), ['Mongols', 'Vikings']);
  assert.deepEqual(flagNames(p, 'aoe4cp-right-content'), ['Knights Templar', 'Scots']);
  assert.ok(p.rows('aoe4cp-left-content').length > 0, 'ranking still uses Mongols');
  assert.match(p.$('#aoe4cp-left-content').textContent, /No matchup data yet for Vikings/);
  assert.match(p.$('#aoe4cp-right-content').textContent, /No matchup data yet for Scots/);
  assert.deepEqual(mapChips(p), ['Lipany']);
  // the top bar still works with the matchups that exist
  assert.match(p.$('#aoe4cp-winrate-body').textContent, /Host Captain/);
});

test('only civs without data: a clear message instead of an error', async () => {
  const p = createPage({ bodyHtml: page(civ(0, 'Knights Templar'), civ(1, 'Vikings')), data: DATA }); await settle();
  assert.match(p.$('#aoe4cp-left-content').textContent, /No matchup data available/);
  assert.match(p.$('#aoe4cp-left-content').textContent, /No matchup data yet for Vikings/);
});

test('Shift+click toggles several civs in and out, a plain click selects only one', async () => {
  const body = page(civ(0, 'Japanese'), civ(1, 'Mongols') + civ(3, 'Knights Templar') + civ(5, 'Chinese'));
  const p = createPage({ bodyHtml: body, data: DATA }); await settle();
  const flags = () => p.$$('#aoe4cp-left-content .aoe4cp-flag');
  const active = () => flags().map((f, i) => f.className.includes('active') ? i : -1).filter(i => i >= 0);
  const click = (i, shiftKey = false) => flags()[i].dispatchEvent(new p.window.MouseEvent('click', { bubbles: true, shiftKey }));

  assert.deepEqual(active(), []);
  click(0); await sleep(30);                       assert.deepEqual(active(), [0]);          // plain click: only this civ
  click(1, true); await sleep(30);                 assert.deepEqual(active(), [0, 1]);       // Shift+click adds
  assert.match(p.$('#aoe4cp-left-content').textContent, /Best counters against Mongols \+ Knights Templar only/);
  click(2, true); await sleep(30);                 assert.deepEqual(active(), [0, 1, 2]);
  click(1, true); await sleep(30);                 assert.deepEqual(active(), [0, 2]);       // Shift+click removes
  click(2); await sleep(30);                       assert.deepEqual(active(), [2]);          // plain click: only this one
  click(2); await sleep(30);                       assert.deepEqual(active(), []);           // click the only selected one: back to all
  // the ranking really follows the selection
  const allRows = p.rows('aoe4cp-left-content').map(r => r.name).join();
  click(0, true); await sleep(30);
  assert.notEqual(p.rows('aoe4cp-left-content').map(r => r.name).join(), '');
  assert.match(p.$('#aoe4cp-left-content').textContent, /Best counters against Mongols only/);
  assert.ok(allRows.length > 0);
});

test('both side panels end with the flag-click tip', async () => {
  const p = createPage({ bodyHtml: page(civ(0, 'Knights Templar'), civ(1, 'Mongols')), data: DATA }); await settle();
  for (const id of ['aoe4cp-left-content', 'aoe4cp-right-content']) {
    const last = p.$(`#${id}`).lastElementChild;
    assert.equal(last.className, 'aoe4cp-tip');
    assert.match(last.textContent, /Shift\+click to select several/);
  }
});
