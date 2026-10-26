import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, sleep, rec, turnPanel, civFlag } from './harness.mjs';

const settle = () => sleep(600);
const names = list => Array.from(list, c => c.name);
const civs = ['Chinese', 'Delhi Sultanate', 'Tughlaq Dynasty', 'Ottomans', 'Knights Templar', 'French', 'Rus', 'Japanese'];
const DATA = civs.flatMap(a => civs.map(b => rec(a, b, 50)));

const civ = (turn, name, action = 'pick') => turnPanel(turn, name, action, civFlag(name));
const withMarker = (html, cls) => html.replace('<div class="stretchy-wrapper">', `<div class="stretchy-wrapper"><div class="stretchy-image ${cls}"></div>`);
const player = (id, picks, bans = '') => `<div id="${id}" class="column is-half"><div class="player box content is-inline-block"><div class="chosen"><div class="picks">${picks}</div><div class="bans">${bans}</div></div></div></div>`;
const draft = (title, host, guest, hostBans = '', guestBans = '', extra = '') => `<body><h2 id="draft-title">${title}</h2><div class="columns is-mobile player-panels">${player('player-host', host, hostBans)}${player('player-guest', guest, guestBans)}${extra}</div></body>`;
const poolNames = (p, id) => p.$$(`#${id} .aoe4cp-pool-flag`).map(f => f.title);

// "jUJpF": civ draft + map picking in one draft
const civAndMap = draft('DM - Civ + Map Draft - Bo1',
  civ(4, 'Chinese') + civ(10, 'Delhi Sultanate') + civ(11, 'Tughlaq Dynasty') + turnPanel(20, 'EGCMS-Frisian Marshes'),
  civ(5, 'Ottomans') + civ(12, 'Knights Templar') + civ(13, 'French'),
  civ(0, 'Rus', 'ban'), civ(1, 'Japanese', 'ban'));
const SAVED_HOST = ['Chinese', 'Delhi Sultanate', 'Tughlaq Dynasty'];
const SAVED_GUEST = ['Ottomans', 'Knights Templar', 'French'];

// "EHWNM": civ picker — picks from the pool, then snipes. How snipes look on the page is not known, so try the variants.
const picker = (title, snipeHtml) => draft(title,
  civ(0, 'Chinese') + civ(2, 'Delhi Sultanate'), civ(1, 'Ottomans') + civ(3, 'Knights Templar'),
  snipeHtml.host, snipeHtml.guest);
const snipeVariants = {
  'snipes drawn like bans': { host: civ(4, 'Ottomans', 'ban'), guest: civ(5, 'Chinese', 'ban') },
  'snipes with a snipe class': { host: civ(4, 'Ottomans', 'snipe'), guest: civ(5, 'Chinese', 'snipe') },
  'snipes with a visible marker': { host: withMarker(civ(4, 'Ottomans', 'ban'), 'snipe-marker'), guest: withMarker(civ(5, 'Chinese', 'ban'), 'steal-marker') },
};

test('a civ + map draft without civ bans still builds the pool (title says "Civ" and "Draft")', async () => {
  const noBans = civAndMap.replace(/<div class="civ-panel ban[\s\S]*?<\/div><\/div><\/div><\/div>/g, '');
  const store = {};
  createPage({ bodyHtml: noBans, data: DATA, store, url: 'https://www.aoe2cm.net/draft/jUJpF' }); await settle();
  assert.deepEqual(names(store.aoe4cp_pools.host), SAVED_HOST);
  assert.deepEqual(names(store.aoe4cp_pools.guest), SAVED_GUEST);
});

test('civ + map draft: pool and map are saved', async () => {
  const store = {};
  const p = createPage({ bodyHtml: civAndMap, data: DATA, store, url: 'https://www.aoe2cm.net/draft/jUJpF' }); await settle();
  assert.deepEqual(names(store.aoe4cp_pools.host), SAVED_HOST);
  assert.equal(store.aoe4cp_pools.draftId, 'jUJpF');
  assert.deepEqual(poolNames(p, 'aoe4cp-left-pool'), SAVED_HOST);
  assert.deepEqual(p.$$('#aoe4cp-map-body .aoe4cp-map-chip').map(c => c.textContent), ['EGCMS-Frisian Marshes']);
});

for (const [label, snipes] of Object.entries(snipeVariants)) {
  test(`the civ picker shows the saved pool and does not start a new one (${label})`, async () => {
    const store = {};
    createPage({ bodyHtml: civAndMap, data: DATA, store, url: 'https://www.aoe2cm.net/draft/jUJpF' }); await settle();
    const p = createPage({ bodyHtml: picker('DM - Civ Picker - Bo1', snipes), data: DATA, store, url: 'https://www.aoe2cm.net/draft/EHWNM' }); await settle();
    assert.equal(store.aoe4cp_pools.draftId, 'jUJpF', 'saved pool is not overwritten');
    assert.deepEqual(names(store.aoe4cp_pools.host), SAVED_HOST);
    assert.deepEqual(poolNames(p, 'aoe4cp-left-pool'), SAVED_HOST);
    assert.deepEqual(poolNames(p, 'aoe4cp-right-pool'), SAVED_GUEST);
    assert.match(p.$('#aoe4cp-left-pool .aoe4cp-pool-label').textContent, /saved/);
  });
}

test('even with a title that gives nothing away, a picker whose picks all come from the saved pool is not a source', async () => {
  const store = {};
  createPage({ bodyHtml: civAndMap, data: DATA, store, url: 'https://www.aoe2cm.net/draft/jUJpF' }); await settle();
  // 4 picks from the saved pool + snipes drawn like bans + a neutral title
  const body = picker('DM - Game 1 - Bo1', snipeVariants['snipes drawn like bans']);
  const p = createPage({ bodyHtml: body, data: DATA, store, url: 'https://www.aoe2cm.net/draft/EHWNM' }); await settle();
  assert.equal(store.aoe4cp_pools.draftId, 'jUJpF');
  assert.deepEqual(poolNames(p, 'aoe4cp-left-pool'), SAVED_HOST);
});

test('the picker is also recognised by its title alone', async () => {
  const store = {};
  createPage({ bodyHtml: civAndMap, data: DATA, store, url: 'https://www.aoe2cm.net/draft/jUJpF' }); await settle();
  const body = draft('Civilization Picker', civ(0, 'Chinese'), civ(1, 'Ottomans'), civ(4, 'Rus', 'ban'));
  const p = createPage({ bodyHtml: body, data: DATA, store, url: 'https://www.aoe2cm.net/draft/EHWNM' }); await settle();
  assert.equal(store.aoe4cp_pools.draftId, 'jUJpF');
  assert.deepEqual(poolNames(p, 'aoe4cp-left-pool'), SAVED_HOST);
});

test('a new civ draft after an old one replaces the saved pool', async () => {
  const store = {};
  createPage({ bodyHtml: civAndMap, data: DATA, store, url: 'https://www.aoe2cm.net/draft/jUJpF' }); await settle();
  const second = draft('DM - Civ + Map Draft - Bo1', civ(4, 'Rus') + civ(10, 'Japanese') + civ(11, 'Chinese') + civ(12, 'French'),
    civ(5, 'Delhi Sultanate') + civ(13, 'Ottomans') + civ(14, 'Knights Templar') + civ(15, 'Tughlaq Dynasty'), civ(0, 'Rus', 'ban'));
  createPage({ bodyHtml: second, data: DATA, store, url: 'https://www.aoe2cm.net/draft/NEW01' }); await settle();
  assert.equal(store.aoe4cp_pools.draftId, 'NEW01');
  assert.deepEqual(names(store.aoe4cp_pools.host), ['Rus', 'Japanese', 'Chinese', 'French']);
});

test('reopening the civ draft after the picker keeps working as the source', async () => {
  const store = {};
  createPage({ bodyHtml: civAndMap, data: DATA, store, url: 'https://www.aoe2cm.net/draft/jUJpF' }); await settle();
  createPage({ bodyHtml: picker('DM - Civ Picker - Bo1', snipeVariants['snipes drawn like bans']), data: DATA, store, url: 'https://www.aoe2cm.net/draft/EHWNM' }); await settle();
  const again = createPage({ bodyHtml: civAndMap, data: DATA, store, url: 'https://www.aoe2cm.net/draft/jUJpF' }); await settle();
  assert.equal(store.aoe4cp_pools.draftId, 'jUJpF');
  assert.doesNotMatch(again.$('#aoe4cp-left-pool .aoe4cp-pool-label').textContent, /saved/);
});

test('debug info reports markers, title and whether the draft is the pool source', async () => {
  const p = createPage({ bodyHtml: picker('DM - Civ Picker - Bo1', snipeVariants['snipes with a visible marker']), data: DATA, url: 'https://www.aoe2cm.net/draft/EHWNM' }); await settle();
  let copied = '';
  Object.defineProperty(p.window.navigator, 'clipboard', { value: { writeText: async t => { copied = t; } } });
  p.$('#aoe4cp-set-debug').click(); await sleep(50);
  const info = JSON.parse(copied);
  assert.equal(info.title, 'DM - Civ Picker - Bo1');
  assert.equal(info.poolSource, false);
  assert.ok(info.panels.some(x => x.visibleMarkers.some(m => /snipe-marker/.test(m))));
});
