import test from 'node:test';
import assert from 'node:assert/strict';
import { createPage, sleep, rec, turnPanel } from './harness.mjs';

const settle = () => sleep(600);
const DATA = [rec('Knights Templar', 'Mongols', 51), rec('Mongols', 'Knights Templar', 49), rec('Rus', 'Mongols', 55),
  rec('Japanese', 'Mongols', 50), rec('Japanese', 'Rus', 52), rec('Rus', 'Japanese', 48), rec('Rus', 'Knights Templar', 44), rec('Knights Templar', 'Rus', 56)];

// Maps (turns 0-3, picked by an "admin" outside the player columns), civ pick/ban phase (4-9), civ picker (10+).
const draftHtml = (extra = '') => `<body>
  <h2 id="draft-title">DM - Civ Draft - Bo1</h2>
  <div id="admin"><div class="picks">${turnPanel(0, 'Dry Arabia')}${turnPanel(1, 'Lipany')}${turnPanel(2, 'Hill and Dale', 'ban')}</div></div>
  <div id="player-host"><div class="picks">${turnPanel(4, 'Knights Templar')}${turnPanel(6, 'Japanese')}${turnPanel(8, 'English', 'ban')}${turnPanel(10, 'Japanese')}</div></div>
  <div id="player-guest"><div class="picks">${turnPanel(5, 'Mongols')}${turnPanel(7, 'Rus')}${turnPanel(11, 'Rus')}</div></div>${extra}
</body>`;

// arrays stored by the page live in jsdom's realm; copy them so deepStrictEqual compares prototypes fairly
const names = list => Array.from(list, c => c.name);
const mapChips = p => p.$$('#aoe4cp-map-body .aoe4cp-map-chip').map(c => c.textContent);
const poolNames = id => p => p.$$(`#${id} .aoe4cp-pool-flag`).map(f => f.title);

test('picked maps are shown in turn order; map bans and civs are not listed as maps', async () => {
  const p = createPage({ bodyHtml: draftHtml(), data: DATA }); await settle();
  assert.deepEqual(mapChips(p), ['1Dry Arabia', '2Lipany']);
});

test('shows "not picked yet" before any map is picked', async () => {
  const p = createPage({ data: DATA, host: ['Knights Templar'], guest: ['Mongols'] }); await settle();
  assert.match(p.$('#aoe4cp-map-body').textContent, /not picked yet/);
});

test('civ pools: what each captain picked first; later picks from the pool are not added twice', async () => {
  const p = createPage({ bodyHtml: draftHtml(), data: DATA }); await settle();
  assert.deepEqual(poolNames('aoe4cp-left-pool')(p), ['Knights Templar', 'Japanese']);
  assert.deepEqual(poolNames('aoe4cp-right-pool')(p), ['Mongols', 'Rus']);
  assert.match(p.$('#aoe4cp-left-pool .aoe4cp-pool-label').textContent, /Host pool \(2\)/);
  assert.match(p.$('#aoe4cp-right-pool .aoe4cp-pool-label').textContent, /Guest pool \(2\)/);
});

test('civ pools are cached per draft id and survive the panels disappearing; other drafts do not inherit them', async () => {
  const store = {};
  createPage({ bodyHtml: draftHtml(), data: DATA, store, url: 'https://www.aoe2cm.net/draft/AAA' }); await settle();
  assert.ok(store.aoe4cp_drafts.AAA, 'saved under the draft id');
  assert.equal(Object.keys(store.aoe4cp_drafts.AAA.obs).length, 10);

  const again = createPage({ bodyHtml: '<body></body>', data: DATA, store, url: 'https://www.aoe2cm.net/draft/AAA' }); await settle();
  assert.deepEqual(poolNames('aoe4cp-left-pool')(again), ['Knights Templar', 'Japanese']);

  // a different draft that is not a civ draft shows the *saved* pool, not its own picks
  const other = createPage({ bodyHtml: '<body></body>', data: DATA, store, url: 'https://www.aoe2cm.net/draft/BBB' }); await settle();
  assert.deepEqual(poolNames('aoe4cp-left-pool')(other), ['Knights Templar', 'Japanese']);
  assert.match(other.$('#aoe4cp-left-pool .aoe4cp-pool-label').textContent, /saved/);
});

// Real-world layout (taken from "Copy debug info" of two drafts): the map draft and the civ draft are
// separate drafts with different IDs. The map is picked by "player-none" in the map draft.
const player = (id, picks, bans) => `<div id="${id}" class="column is-half"><div class="player box content is-inline-block"><div class="chosen"><div class="picks">${picks}</div><div class="bans">${bans}</div></div></div></div>`;
const mapDraftHtml = `<body><h2 id="draft-title">DM - Map Draft - Bo1</h2><div class="columns is-mobile player-panels">
  ${player('player-host', '', turnPanel(0, 'Baltic', 'ban') + turnPanel(2, 'Socotra', 'ban'))}
  <div id="player-none" class="column has-text-centered"><div class="picks is-justify-content-center">${turnPanel(8, 'EGCMS-Frisian Marshes')}</div></div>
  ${player('player-guest', '', turnPanel(1, 'Wadden Sea', 'ban') + turnPanel(3, 'Pigeons View', 'ban'))}</div></body>`;
const civDraftHtml = `<body><h2 id="draft-title">DM - Civ Draft - Bo1</h2><div class="columns is-mobile player-panels">
  ${player('player-host', turnPanel(5, 'Chinese') + turnPanel(11, 'Delhi Sultanate') + turnPanel(12, 'Tughlaq Dynasty'), turnPanel(0, 'Ayyubids', 'ban'))}
  ${player('player-guest', turnPanel(6, 'Ottomans') + turnPanel(10, 'Knights Templar') + turnPanel(13, 'French'), turnPanel(1, "Zhu Xi's Legacy", 'ban'))}</div></body>`;

test('the map picked in the map draft is still shown in the separate civ draft (regression)', async () => {
  const store = {};
  const mapPage = createPage({ bodyHtml: mapDraftHtml, data: DATA, store, url: 'https://www.aoe2cm.net/draft/FAEAR' }); await settle();
  assert.deepEqual(mapChips(mapPage), ['EGCMS-Frisian Marshes']);
  assert.match(mapPage.$('.aoe4cp-map-chip').title, /DM - Map Draft - Bo1 · draft FAEAR/);

  const civPage = createPage({ bodyHtml: civDraftHtml, data: DATA, store, url: 'https://www.aoe2cm.net/draft/Hmohy' }); await settle();
  assert.deepEqual(mapChips(civPage), ['EGCMS-Frisian Marshes']);   // map from the other draft
  assert.deepEqual(poolNames('aoe4cp-left-pool')(civPage), ['Chinese', 'Delhi Sultanate', 'Tughlaq Dynasty']);
  assert.deepEqual(poolNames('aoe4cp-right-pool')(civPage), ['Ottomans', 'Knights Templar', 'French']);
  assert.ok(civPage.$('.aoe4cp-map-latest'));
});

test('maps of later map drafts are added (Map 1, Map 2), the newest is highlighted', async () => {
  const store = {};
  createPage({ bodyHtml: mapDraftHtml, data: DATA, store, url: 'https://www.aoe2cm.net/draft/FAEAR' }); await settle();
  await sleep(5);
  const second = mapDraftHtml.replace('EGCMS-Frisian Marshes', 'Lipany').replace('panel-turn-8', 'panel-turn-9');
  const p = createPage({ bodyHtml: second, data: DATA, store, url: 'https://www.aoe2cm.net/draft/ZZZ99' }); await settle();
  assert.deepEqual(mapChips(p), ['1EGCMS-Frisian Marshes', '2Lipany']);
  assert.match(p.$('.aoe4cp-map-latest').textContent, /Lipany/);
});

test('maps not seen for more than a day are no longer shown', async () => {
  const day = 24 * 60 * 60 * 1000;
  const store = { aoe4cp_maps: [{ name: 'Old Map', draftId: 'OLD', turn: 8, title: '', t0: Date.now() - 3 * day, t: Date.now() - 2 * day }] };
  const p = createPage({ bodyHtml: civDraftHtml, data: DATA, store, url: 'https://www.aoe2cm.net/draft/Hmohy' }); await settle();
  assert.match(p.$('#aoe4cp-map-body').textContent, /not picked yet/);
});

test('the cache keeps growing: a later map pick is added instead of replacing the first one', async () => {
  const p = createPage({ bodyHtml: draftHtml(), data: DATA }); await settle();
  assert.equal(mapChips(p).length, 2);
  p.$('#admin .picks').insertAdjacentHTML('beforeend', turnPanel(3, 'Mongolian Heights'));
  await settle();
  assert.deepEqual(mapChips(p), ['1Dry Arabia', '2Lipany', '3Mongolian Heights']);
  assert.equal(Object.keys(p.store.aoe4cp_drafts.test.obs).length, 11);
});

test('only the 20 most recent drafts are kept', async () => {
  const drafts = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`D${i}`, { t: i + 1, obs: {} }]));
  const p = createPage({ bodyHtml: draftHtml(), data: DATA, store: { aoe4cp_drafts: drafts } }); await settle();
  const ids = Object.keys(p.store.aoe4cp_drafts);
  assert.equal(ids.length, 20);
  assert.ok(ids.includes('test'));
  assert.ok(!ids.includes('D0'));
});

test('map bar and civ pools can be hidden in the settings and with the arrow', async () => {
  const p = createPage({ bodyHtml: draftHtml(), data: DATA }); await settle();
  for (const el of ['map', 'pools']) {
    const cb = p.$(`#aoe4cp-settings input[data-el="${el}"]`);
    cb.checked = false; p.fire(cb, 'change');
    assert.ok(p.htmlClasses().includes(`aoe4cp-off-${el}`));
    assert.equal(p.store.aoe4cp_settings.show[el], false);
  }
  p.$('#aoe4cp-map .aoe4cp-arrow').click();
  assert.ok(p.htmlClasses().includes('aoe4cp-away-map'));
  assert.equal(p.store.aoe4cp_away.map, true);
});

test('"Clear saved drafts" empties the caches, then the visible draft is saved again', async () => {
  const p = createPage({ bodyHtml: draftHtml(), data: DATA, store: { aoe4cp_drafts: { OLD: { t: 1, obs: {} } }, aoe4cp_maps: [{ name: 'Gone', draftId: 'OLD', turn: 1, t0: Date.now(), t: Date.now() }] } }); await settle();
  p.$('#aoe4cp-set-clear').click(); await settle();
  assert.deepEqual(Object.keys(p.store.aoe4cp_drafts), ['test']);
  assert.ok(!p.store.aoe4cp_maps.some(m => m.name === 'Gone'));
});

test('"Copy debug info" copies the panels of the draft page as JSON', async () => {
  const p = createPage({ bodyHtml: draftHtml(), data: DATA }); await settle();
  let copied = '';
  Object.defineProperty(p.window.navigator, 'clipboard', { value: { writeText: async t => { copied = t; } } });
  p.$('#aoe4cp-set-debug').click(); await sleep(50);
  const info = JSON.parse(copied);
  assert.equal(info.draftId, 'test');
  assert.equal(info.panels.length, 10);
  assert.ok(info.panels.some(x => x.text === 'Dry Arabia' && x.parents.some(y => y.startsWith('div#admin'))));
  assert.deepEqual(info.derived.maps.map(m => m.name), ['Dry Arabia', 'Lipany']);
});

// --- civ pool is built in the civ draft and shown again in the civ picker draft ---------------------
const pickerHtml = (hostPicks, guestPicks) => `<body><h2 id="draft-title">HTR The Crownfall - Civilization Picker</h2><div class="columns is-mobile player-panels">
  ${player('player-host', hostPicks.map((n, i) => turnPanel(i * 2, n)).join(''), '')}
  ${player('player-guest', guestPicks.map((n, i) => turnPanel(i * 2 + 1, n)).join(''), '')}</div></body>`;

test('the pool built in the civ draft is saved and shown again in the civ picker draft (regression)', async () => {
  const store = {};
  const civ = createPage({ bodyHtml: civDraftHtml, data: DATA, store, url: 'https://www.aoe2cm.net/draft/Hmohy' }); await settle();
  assert.deepEqual(names(store.aoe4cp_pools.host), ['Chinese', 'Delhi Sultanate', 'Tughlaq Dynasty']);
  assert.deepEqual(names(store.aoe4cp_pools.guest), ['Ottomans', 'Knights Templar', 'French']);
  assert.equal(store.aoe4cp_pools.draftId, 'Hmohy');
  assert.doesNotMatch(civ.$('#aoe4cp-left-pool .aoe4cp-pool-label').textContent, /saved/); // own pool in its own draft

  // the picker: only two picks per side so far — the pool must still be the full saved one
  const picker = createPage({ bodyHtml: pickerHtml(['Chinese'], ['Ottomans']), data: DATA, store, url: 'https://www.aoe2cm.net/draft/PICK1' }); await settle();
  assert.deepEqual(poolNames('aoe4cp-left-pool')(picker), ['Chinese', 'Delhi Sultanate', 'Tughlaq Dynasty']);
  assert.deepEqual(poolNames('aoe4cp-right-pool')(picker), ['Ottomans', 'Knights Templar', 'French']);
  assert.match(picker.$('#aoe4cp-left-pool .aoe4cp-pool-label').textContent, /Host pool \(3\) · saved/);
  assert.match(picker.$('#aoe4cp-left-pool').title, /DM - Civ Draft - Bo1 · draft Hmohy/);
  assert.equal(store.aoe4cp_pools.draftId, 'Hmohy', 'the picker does not overwrite the saved pool');
});

test('a civ picker without a saved pool shows no pool (its own picks are not a pool)', async () => {
  const p = createPage({ bodyHtml: pickerHtml(['Chinese', 'Japanese'], ['Ottomans', 'Rus']), data: DATA, url: 'https://www.aoe2cm.net/draft/PICK2' }); await settle();
  assert.deepEqual(poolNames('aoe4cp-left-pool')(p), []);
  assert.deepEqual(poolNames('aoe4cp-right-pool')(p), []);
});

test('a saved pool older than a day is not shown', async () => {
  const old = Date.now() - 2 * 24 * 60 * 60 * 1000;
  const store = { aoe4cp_pools: { draftId: 'OLD', title: '', t0: old, t: old, host: [{ name: 'Chinese', img: null }], guest: [{ name: 'Ottomans', img: null }] } };
  const p = createPage({ bodyHtml: pickerHtml(['Chinese'], ['Ottomans']), data: DATA, store, url: 'https://www.aoe2cm.net/draft/PICK3' }); await settle();
  assert.deepEqual(poolNames('aoe4cp-left-pool')(p), []);
});

test('a draft counts as the pool source when civs are banned in it, even without a title', async () => {
  const noTitle = civDraftHtml.replace(/<h2[^>]*>.*?<\/h2>/, '');
  const store = {};
  createPage({ bodyHtml: noTitle, data: DATA, store, url: 'https://www.aoe2cm.net/draft/NT1' }); await settle();
  assert.equal(store.aoe4cp_pools.draftId, 'NT1');
});

test('the pool grows while the civ draft is running, and the saved pool follows', async () => {
  const store = {};
  const p = createPage({ bodyHtml: civDraftHtml, data: DATA, store, url: 'https://www.aoe2cm.net/draft/Hmohy' }); await settle();
  p.$('#player-host .picks').insertAdjacentHTML('beforeend', turnPanel(14, 'Rus'));
  await settle();
  assert.deepEqual(names(store.aoe4cp_pools.host), ['Chinese', 'Delhi Sultanate', 'Tughlaq Dynasty', 'Rus']);
});

test('"Clear saved drafts" also forgets the saved pool', async () => {
  const store = {};
  const p = createPage({ bodyHtml: civDraftHtml, data: DATA, store, url: 'https://www.aoe2cm.net/draft/Hmohy' }); await settle();
  assert.ok(store.aoe4cp_pools);
  const picker = createPage({ bodyHtml: pickerHtml(['Chinese'], ['Ottomans']), data: DATA, store, url: 'https://www.aoe2cm.net/draft/PICK1' }); await settle();
  picker.$('#aoe4cp-set-clear').click(); await settle();
  assert.equal(store.aoe4cp_pools, null);
  assert.deepEqual(poolNames('aoe4cp-left-pool')(picker), []);
});
