(() => {
  'use strict';

  // Firefox exposes `browser`; Chromium-based browsers expose `chrome` (promise-based in MV3).
  const api = globalThis.browser ?? globalThis.chrome;

  const API = 'https://aoe4world.com/api/v0/stats/rm_solo/matchups';
  const STATS_PAGE = 'https://aoe4world.com/stats/rm_solo/matchups';
  const CACHE_KEY = 'aoe4cp_cache_v2';
  const SETTINGS_KEY = 'aoe4cp_settings';
  const DEFAULT_SETTINGS = { counterCount: 5, rank: '≥conqueror', patch: 'auto', show: { left: true, right: true, top: true, map: true, pools: true } };
  // Used only when the rank filter cannot be read from the AoE4World stats page.
  const FALLBACK_RANKS = [
    ['≥conqueror', 'Conqueror+'], ['≥diamond', 'Diamond+'], ['≥platinum', 'Platinum+'], ['≥gold', 'Gold+'],
    ['≥silver', 'Silver+'], ['≥bronze', 'Bronze+'], ['conqueror', 'Conqueror only'], ['diamond', 'Diamond only'],
    ['platinum', 'Platinum only'], ['gold', 'Gold only'], ['silver', 'Silver only'], ['bronze', 'Bronze only'],
  ];
  let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  let filtersCache = null; // { current, patches: [{id,label}], ranks: [{value,label}] }
  let loadSeq = 0;
  let currentRankLabel = '';
  const CACHE_TTL = 6 * 60 * 60 * 1000;
  const CIVS = [
    'Abbasid Dynasty', 'Ayyubids', 'Byzantines', 'Chinese', 'Delhi Sultanate',
    'English', 'French', 'Golden Horde', 'Holy Roman Empire', 'House of Lancaster',
    'Japanese', 'Jeanne d’Arc', 'Knights Templar', 'Malians', 'Mongols',
    'Order of the Dragon', 'Ottomans', 'Rus', 'Sengoku Daimyo', 'Tughlaq Dynasty',
    'Zhu Xi’s Legacy', 'Scots', 'Vikings'
  ];

  let allMatchups = null;
  let currentPatch = null;
  let detectedGuestPicks = [];
  let detectedHostPicks = [];

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const pretty = s => String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const CIV_ALIASES = {
    abbasid: 'Abbasid Dynasty', abbasiddynasty: 'Abbasid Dynasty', ayyubid: 'Ayyubids', ayyubids: 'Ayyubids',
    byzantine: 'Byzantines', byzantines: 'Byzantines', chinese: 'Chinese', delhi: 'Delhi Sultanate', delhisultanate: 'Delhi Sultanate',
    english: 'English', french: 'French', goldenhorde: 'Golden Horde', hre: 'Holy Roman Empire', holyromanempire: 'Holy Roman Empire',
    houseoflancaster: 'House of Lancaster', japanese: 'Japanese', jeannedarc: 'Jeanne d’Arc', knightstemplar: 'Knights Templar',
    knightstemplar: 'Knights Templar', malians: 'Malians', mongol: 'Mongols', mongols: 'Mongols', orderofthedragon: 'Order of the Dragon',
    ottoman: 'Ottomans', ottomans: 'Ottomans', rus: 'Rus', sengokudaimyo: 'Sengoku Daimyo', tughlaqdynasty: 'Tughlaq Dynasty',
    zhuxislegacy: 'Zhu Xi’s Legacy'
  };
  const CANONICAL_CIVS = new Map(CIVS.map(c => [norm(c), c]));
  function canonicalCiv(value) {
    const key = norm(value);
    return CANONICAL_CIVS.get(key) || CIV_ALIASES[key] || null;
  }
  function civKey(value) { return norm(canonicalCiv(value) || value); }

  // Civs that are not in CIVS (e.g. newly released ones) are learned from the API
  // data and from the page, so the addon keeps working without a code update.
  const learnedNames = new Map(); // norm(name) -> display name
  function civName(value) {
    const known = canonicalCiv(value);
    if (known) return known;
    const raw = String(value || '').trim();
    const key = norm(raw);
    if (!key) return null;
    if (learnedNames.has(key)) return learnedNames.get(key);
    return (/[_-]/.test(raw) || raw === raw.toLowerCase()) ? pretty(raw) : raw;
  }
  function shownName(value) { return canonicalCiv(value) || learnedNames.get(norm(value)) || value; }
  function unknownCivsInData() {
    const out = new Set();
    const source = Array.isArray(allMatchups?.data) ? allMatchups.data : [];
    for (const raw of source) for (const v of [raw.civilization, raw.other_civilization]) if (v && !canonicalCiv(v)) out.add(String(v));
    return [...out];
  }
  function makePanel() {
    if (document.getElementById('aoe4cp-settings')) return;
    createSidebars();
    createWinrateSummary();
    createMapBar();
    createSettings();
  }

  function setStatus(msg) {
    const el = document.getElementById('aoe4cp-set-status');
    if (el) el.textContent = msg;
  }
  // Diagnostics are no longer shown in the UI; they go to the browser console instead.
  function setDebug(v) { console.debug('[AoE4 Counter Picks]', v); }

  function updateHeader() {
    const patchEl = document.getElementById('aoe4cp-patch');
    if (patchEl && currentPatch) patchEl.textContent = `Patch ${currentPatch.label || currentPatch.id}`;
    const foot = document.getElementById('aoe4cp-foot');
    if (foot) foot.textContent = `Ranked Solo · ${currentRankLabel || settings.rank} · ${currentPatch ? (currentPatch.label || currentPatch.id) : 'patch …'} · AoE4World data`;
  }

  // Cross-origin requests are made by the extension background script, not this
  // content script. Firefox applies page-origin CORS rules to content-script fetches.
  async function backgroundRequest(action, url) {
    const result = await api.runtime.sendMessage({ type: 'AOE4CP_FETCH', action, url });
    if (!result || !result.ok) throw new Error(result?.error || 'Background request failed');
    return result.data;
  }

  async function fetchJson(url) {
    return backgroundRequest('json', url);
  }

  // Reads the live AoE4World stats page: the current patch (the page's selected patch),
  // the list of selectable patches and the list of rank filters. Nothing is hardcoded
  // except a fallback rank list that is only used if the page cannot be parsed.
  async function discoverFilters() {
    const html = await backgroundRequest('text', STATS_PAGE);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const selects = [...doc.querySelectorAll('select')];
    const hint = sel => `${sel.name} ${sel.id} ${sel.getAttribute('aria-label') || ''}`;
    const patchSelect = selects.find(sel => /patch/i.test(hint(sel)))
      || selects.find(sel => [...sel.options].some(o => /current|latest|patch/i.test(o.textContent)));
    const rankSelect = selects.find(sel => /rank/i.test(hint(sel)));
    const readOptions = sel => sel ? [...sel.options].filter(o => o.value && o.value !== 'any')
      .map(o => ({ id: o.value, label: o.textContent.trim().replace(/\s+/g, ' ') })) : [];
    const patches = readOptions(patchSelect);
    const ranks = readOptions(rankSelect).map(o => ({ value: o.id, label: o.label }));

    let current = null;
    if (patchSelect) {
      const selected = patchSelect.selectedOptions?.[0];
      if (selected && selected.value && selected.value !== 'any') current = { id: selected.value, label: selected.textContent.trim().replace(/\s+/g, ' ') };
      else {
        const opts = patches.filter(o => /^[\d,]+$/.test(o.id));
        if (opts.length) current = opts[0];
      }
    }
    if (!current) {
      // Some versions render the selector client-side. Use the highest numeric patch/build ID in the HTML.
      const embedded = [...html.matchAll(/(?:value|patch|patch_id|data-patch)[=:\"'\s]+(?:\"|')?(\d{3,6})/gi)]
        .map(m => Number(m[1])).filter(n => Number.isFinite(n));
      const unique = [...new Set(embedded)].sort((x, y) => y - x);
      if (unique.length) current = { id: String(unique[0]), label: `Patch ${unique[0]}` };
    }
    if (!current) throw new Error('Could not identify the current patch from AoE4World HTML. Open AoE4World Matchups in another tab, then retry.');
    return { current, patches, ranks: ranks.length ? ranks : FALLBACK_RANKS.map(([value, label]) => ({ value, label })) };
  }

  async function getFilters(force) {
    if (!force && filtersCache) return filtersCache;
    filtersCache = await discoverFilters();
    return filtersCache;
  }

  async function loadMatchups(force = false) {
    makePanel();
    const seq = ++loadSeq;
    const stale = () => seq !== loadSeq || !active;
    setStatus('Checking AoE4World filters…');
    try {
      const filters = await getFilters(force);
      if (stale()) return;
      renderSettingsOptions();
      const patch = settings.patch === 'auto'
        ? filters.current
        : (filters.patches.find(x => x.id === settings.patch) || { id: settings.patch, label: `Patch ${settings.patch}` });
      const rank = settings.rank;
      currentPatch = patch;
      currentRankLabel = (filters.ranks.find(x => x.value === rank) || { label: rank }).label;
      updateHeader();

      const cached = await api.storage.local.get(CACHE_KEY).catch(() => ({}));
      if (stale()) return;
      const c = cached[CACHE_KEY];
      if (!force && c && c.patch === patch.id && c.rank === rank && Date.now() - c.time < CACHE_TTL) {
        allMatchups = c.data;
        setDebug({ source: 'cached', patch, rank, dataShape: describeShape(allMatchups), unknownCivs: unknownCivsInData() });
        finishLoad();
        return;
      }
      setStatus(`Fetching ${currentRankLabel} matchups for ${patch.label || patch.id}…`);
      const url = `${API}?patch=${encodeURIComponent(patch.id)}&rank_level=${encodeURIComponent(rank)}`;
      const data = await fetchJson(url);
      if (stale()) return;
      allMatchups = data;
      await api.storage.local.set({ [CACHE_KEY]: { patch: patch.id, rank, time: Date.now(), data } }).catch(() => {});
      setDebug({ source: url, patch, rank, dataShape: describeShape(allMatchups), topLevelKeys: Object.keys(allMatchups || {}), unknownCivs: unknownCivsInData() });
      finishLoad();
    } catch (e) {
      if (stale()) return;
      setStatus(`Could not load data: ${e.message}`);
      setDebug({ error: String(e) });
    }
  }

  function finishLoad() {
    syncPicks();
    showCounters();
  }

  function describeShape(data) {
    if (Array.isArray(data)) return { type: 'array', length: data.length, firstItem: data[0] && Object.keys(data[0]) };
    if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data).map(([k,v]) => [k, Array.isArray(v) ? `array(${v.length})` : typeof v]));
    return typeof data;
  }

  // Convert a variety of plausible API response layouts to matchup records.
  // AoE4World's current response is { ..., data: [{ civilization, other_civilization,
  // win_rate, win_count, games_count, player_games_count, ... }] }. Each record's
  // win_rate belongs to `civilization` against `other_civilization`.
  function extractRecords(data) {
    const source = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const records = [];
    for (const raw of source) {
      const civ = civName(raw.civilization);
      const against = civName(raw.other_civilization);
      const rate = Number(raw.win_rate);
      if (!civ || !against || !Number.isFinite(rate)) continue;
      records.push({ civ, against, winRate: rate > 1 ? rate / 100 : rate,
        games: Number(raw.games_count ?? raw.player_games_count ?? raw.win_count) || 0, raw });
    }
    return records;
  }

  function createWinrateSummary() {
    if (document.getElementById('aoe4cp-winrate')) return;
    const el = document.createElement('div'); el.id = 'aoe4cp-winrate';
    el.innerHTML = '<strong>Draft win-rate estimate</strong><div id="aoe4cp-winrate-body">Waiting for both players to pick…</div>';
    document.documentElement.appendChild(el);
  }

  // ---- Settings ---------------------------------------------------------------
  const clampCount = n => Math.min(10, Math.max(1, Math.round(Number(n)) || DEFAULT_SETTINGS.counterCount));
  async function loadSettings() {
    try {
      const r = await api.storage.local.get(SETTINGS_KEY);
      const st = r[SETTINGS_KEY] || {};
      settings = {
        counterCount: clampCount(st.counterCount),
        rank: typeof st.rank === 'string' && st.rank ? st.rank : DEFAULT_SETTINGS.rank,
        patch: typeof st.patch === 'string' && st.patch ? st.patch : DEFAULT_SETTINGS.patch,
        show: { ...DEFAULT_SETTINGS.show, ...(st.show && typeof st.show === 'object' ? st.show : {}) },
      };
    } catch (e) { /* keep defaults */ }
  }
  function saveSettings() { api.storage.local.set({ [SETTINGS_KEY]: settings }).catch(() => {}); }
  function applyOff() {
    for (const side of ['left', 'right', 'top', 'map', 'pools']) {
      document.documentElement.classList.toggle(`aoe4cp-off-${side}`, settings.show[side] === false);
    }
  }
  function fillSelect(sel, options, value) {
    sel.replaceChildren();
    for (const o of options) { const el = document.createElement('option'); el.value = o.value; el.textContent = o.label; sel.appendChild(el); }
    if (!options.some(o => o.value === value)) { const el = document.createElement('option'); el.value = value; el.textContent = value; sel.appendChild(el); }
    sel.value = value;
  }
  function renderSettingsOptions() {
    const rankSel = document.getElementById('aoe4cp-set-rank');
    const patchSel = document.getElementById('aoe4cp-set-patch');
    if (!rankSel || !patchSel) return;
    const ranks = filtersCache?.ranks || FALLBACK_RANKS.map(([value, label]) => ({ value, label }));
    fillSelect(rankSel, ranks, settings.rank);
    const cur = filtersCache?.current;
    const patches = [{ value: 'auto', label: `Current patch (auto)${cur ? ' — ' + (cur.label || cur.id) : ''}` },
      ...(filtersCache?.patches || []).map(x => ({ value: x.id, label: x.label }))];
    fillSelect(patchSel, patches, settings.patch);
  }
  function syncSettingsControls() {
    const slider = document.getElementById('aoe4cp-set-count');
    if (slider) slider.value = String(settings.counterCount);
    const val = document.getElementById('aoe4cp-set-count-val');
    if (val) val.textContent = String(settings.counterCount);
    for (const cb of document.querySelectorAll('#aoe4cp-settings input[data-el]')) cb.checked = settings.show[cb.dataset.el] !== false;
    renderSettingsOptions();
  }
  function createSettings() {
    if (document.getElementById('aoe4cp-settings')) return;
    const el = document.createElement('aside'); el.id = 'aoe4cp-settings';
    el.innerHTML = `
      <div class="aoe4cp-side-title">Settings</div>
      <div class="aoe4cp-side-subtitle" id="aoe4cp-patch">Finding current patch…</div>
      <div class="aoe4cp-set-group">
        <label for="aoe4cp-set-count">Counter civs shown: <strong id="aoe4cp-set-count-val">5</strong></label>
        <input type="range" id="aoe4cp-set-count" min="1" max="10" step="1" value="5">
      </div>
      <div class="aoe4cp-set-group"><label for="aoe4cp-set-rank">Rank of the data</label><select id="aoe4cp-set-rank"></select></div>
      <div class="aoe4cp-set-group"><label for="aoe4cp-set-patch">Patch</label><select id="aoe4cp-set-patch"></select></div>
      <div class="aoe4cp-set-group">
        <div class="aoe4cp-set-label">Visible elements</div>
        <label class="aoe4cp-check"><input type="checkbox" data-el="left"> Left panel · host's best counters</label>
        <label class="aoe4cp-check"><input type="checkbox" data-el="right"> Right panel · guest's best counters</label>
        <label class="aoe4cp-check"><input type="checkbox" data-el="top"> Top bar · draft win-rate</label>
        <label class="aoe4cp-check"><input type="checkbox" data-el="map"> Map bar · picked map(s) of this draft</label>
        <label class="aoe4cp-check"><input type="checkbox" data-el="pools"> Civ pools · what host / guest can pick</label>
      </div>
      <div id="aoe4cp-set-status" role="status"></div>
      <div class="aoe4cp-set-buttons"><button type="button" id="aoe4cp-set-refresh">Refresh data</button><button type="button" id="aoe4cp-set-reset">Reset to defaults</button></div>
      <div class="aoe4cp-set-buttons"><button type="button" id="aoe4cp-set-debug" title="Copies technical info about the draft page to the clipboard, for bug reports">Copy debug info</button><button type="button" id="aoe4cp-set-clear" title="Forgets the remembered maps and civ pools of all drafts">Clear saved drafts</button></div>
      <div class="aoe4cp-foot" id="aoe4cp-foot">Ranked Solo · AoE4World data</div>`;
    document.documentElement.appendChild(el);
    syncSettingsControls();

    el.querySelector('#aoe4cp-set-count').addEventListener('input', e => {
      settings.counterCount = clampCount(e.target.value);
      el.querySelector('#aoe4cp-set-count-val').textContent = String(settings.counterCount);
      saveSettings();
      if (allMatchups) showCounters();
    });
    el.querySelector('#aoe4cp-set-rank').addEventListener('change', e => { settings.rank = e.target.value; saveSettings(); loadMatchups(); });
    el.querySelector('#aoe4cp-set-patch').addEventListener('change', e => { settings.patch = e.target.value; saveSettings(); loadMatchups(); });
    for (const cb of el.querySelectorAll('input[data-el]')) {
      cb.addEventListener('change', () => { settings.show[cb.dataset.el] = cb.checked; saveSettings(); applyOff(); });
    }
    el.querySelector('#aoe4cp-set-refresh').addEventListener('click', () => { loadMatchups(true); });
    el.querySelector('#aoe4cp-set-debug').addEventListener('click', async () => {
      const ok = await copyText(JSON.stringify(collectDebugInfo(), null, 2));
      setStatus(ok ? 'Debug info copied to the clipboard.' : 'Could not copy automatically — see the browser console.');
      if (!ok) console.log('[AoE4 Counter Picks] debug info', collectDebugInfo());
    });
    el.querySelector('#aoe4cp-set-clear').addEventListener('click', () => {
      draftsDb = {}; mapsDb = []; poolsDb = null; lastDraftSig = '';
      api.storage.local.set({ [DRAFTS_KEY]: {}, [MAPS_KEY]: [], [POOLS_KEY]: null }).catch(() => {});
      syncDraft(); renderDraftInfo(true);
      setStatus('Saved draft data cleared.');
    });
    el.querySelector('#aoe4cp-set-reset').addEventListener('click', () => {
      settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      saveSettings(); applyOff(); syncSettingsControls(); loadMatchups();
    });
  }

  function createSidebars() {
    if (!document.getElementById('aoe4cp-left')) {
      const left = document.createElement('aside'); left.id = 'aoe4cp-left';
      left.innerHTML = '<div class="aoe4cp-side-title">Host best counter</div><div class="aoe4cp-side-subtitle">Counters against all guest picks</div><div class="aoe4cp-pool" id="aoe4cp-left-pool"></div><div class="aoe4cp-side-content" id="aoe4cp-left-content">Waiting for guest picks…</div>';
      document.documentElement.appendChild(left);
    }
    if (!document.getElementById('aoe4cp-right')) {
      const right = document.createElement('aside'); right.id = 'aoe4cp-right';
      right.innerHTML = '<div class="aoe4cp-side-title">Guest best counter</div><div class="aoe4cp-side-subtitle">Counters against all host picks</div><div class="aoe4cp-pool" id="aoe4cp-right-pool"></div><div class="aoe4cp-side-content" id="aoe4cp-right-content">Waiting for host picks…</div>';
      document.documentElement.appendChild(right);
    }
  }

  function recordsAgainst(target) {
    const unique = new Map();
    for (const r of extractRecords(allMatchups)) {
      if (civKey(r.against) !== civKey(target) || civKey(r.civ) === civKey(target)) continue;
      const key = civKey(r.civ);
      if (!unique.has(key) || r.games > unique.get(key).games) unique.set(key, r);
    }
    return [...unique.values()];
  }

  // 52% and above = green, 48–52% = yellow (neutral), below 48% = red (compared on the displayed 1-decimal value).
  function rateClass(rate) {
    const pct = Math.round(rate * 1000) / 10;
    return pct >= 52 ? 'aoe4cp-wr-good' : pct < 48 ? 'aoe4cp-wr-bad' : 'aoe4cp-wr-neutral';
  }

  function renderRows(container, rows, mode = 'normal') {
    container.replaceChildren();
    if (!rows.length) { container.textContent = 'No matchup data available for these picks.'; return; }
    rows.forEach((r, i) => {
      const li = document.createElement('div'); li.className = 'aoe4cp-side-row';
      const rank = document.createElement('span'); rank.className = 'aoe4cp-rank'; rank.textContent = String(i + 1);
      const name = document.createElement('span'); name.className = 'aoe4cp-name'; name.textContent = shownName(r.civ);
      const detail = document.createElement('span'); detail.className = 'aoe4cp-rate';
      const rate = document.createElement('strong');
      rate.textContent = `${((mode === 'combined' ? r.minRate : r.winRate) * 100).toFixed(1)}%`;
      if (mode === 'combined') rate.title = 'Lowest win rate across all picks';
      rate.className = rateClass(mode === 'combined' ? r.minRate : r.winRate);
      const games = document.createElement('small');
      if (mode === 'combined') {
        const avg = document.createElement('span'); avg.className = rateClass(r.avgRate); avg.textContent = `${(r.avgRate * 100).toFixed(1)}%`;
        games.append('avg ', avg, ` · ${r.coverage}/${r.total} matchups`);
      } else {
        games.textContent = `${Number(r.games).toLocaleString()} games`;
      }
      detail.append(rate, games); li.append(rank, name, detail); container.appendChild(li);
    });
  }

  // Best counters against ALL given picks, ranked by the worst matchup (maximin),
  // then by the average win rate. Only civs with data against every pick are listed.
  function combinedCounters(picks, exclude = picks) {
    const candidates = new Map();
    for (const pick of picks) {
      for (const r of recordsAgainst(pick)) {
        const key = civKey(r.civ);
        if (!candidates.has(key)) candidates.set(key, { civ: r.civ, rates: new Map(), games: 0 });
        const item = candidates.get(key); item.rates.set(civKey(pick), r.winRate); item.games += r.games;
      }
    }
    return [...candidates.values()].filter(c => !exclude.some(p => civKey(p) === civKey(c.civ)))
      .map(c => {
        const rates = picks.map(p => c.rates.get(civKey(p))).filter(Number.isFinite);
        return { ...c, minRate: Math.min(...rates), avgRate: rates.reduce((a,b)=>a+b,0) / rates.length,
          coverage: rates.length, total: picks.length };
      }).filter(c => c.coverage === picks.length)
      .sort((a,b) => b.minRate-a.minRate || b.avgRate-a.avgRate).slice(0, settings.counterCount);
  }

  // Is a draft option a civilization or something else (a map)? Drafts can mix both, e.g. maps and civs
  // in one draft. The flag image is the most reliable hint (civ flags live under /flag/, map images under
  // /map/); without a recognisable image the name is checked against the known civs and the matchup data.
  const learnedCivs = new Set(); // norm(name) of options seen with a civ flag, even if the API has no data for them yet
  function optionKind(name, img) {
    let path = '';
    try { path = img ? new URL(img, location.href).pathname : ''; } catch (e) { path = ''; }
    if (/\/flags?\//i.test(path)) { learnedCivs.add(norm(name)); return 'civ'; }
    if (/\/maps?\//i.test(path)) return 'map';
    return civKeySet().has(civKey(name)) || learnedCivs.has(norm(name)) ? 'civ' : 'map';
  }
  // Picks the matchup data knows nothing about (new civs) are left out of the ranking instead of emptying it.
  const usablePicks = picks => picks.filter(p => recordsAgainst(p).length > 0);

  // Flag (civ icon) lookup, learned from the draft page itself so we never ship image assets.
  const civImages = new Map(); // norm(civ) -> image URL
  function imageFromPanel(panelEl) {
    const ind = panelEl.querySelector('.civ-indicator') || panelEl;
    const img = ind.querySelector('img');
    if (img && (img.currentSrc || img.src)) return img.currentSrc || img.src;
    for (const el of [ind, ...ind.querySelectorAll('*')]) {
      const bg = getComputedStyle(el).backgroundImage;
      const m = bg && bg !== 'none' && bg.match(/url\(["']?(.*?)["']?\)/);
      if (m) return m[1];
    }
    return null;
  }

  // Which flags are selected per side panel (empty = all picks combined).
  const focusedCivs = { left: [], right: [] };

  function makeFlag(civ, selected, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'aoe4cp-flag' + (selected ? ' aoe4cp-flag-active' : '');
    btn.title = `${shownName(civ)} — click: only this civ · Shift+click: add or remove civs`;
    btn.setAttribute('aria-pressed', String(selected));
    const src = civImages.get(norm(civ));
    if (src) {
      const img = document.createElement('img'); img.src = src; img.alt = shownName(civ); btn.appendChild(img);
    } else {
      btn.classList.add('aoe4cp-flag-text'); btn.textContent = shownName(civ);
    }
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderCombinedPanel(container, picks, titlePrefix, extraNote, side) {
    // Forget selected civs that are no longer picked.
    focusedCivs[side] = focusedCivs[side].filter(f => picks.some(p => civKey(p) === civKey(f)));
    const focus = focusedCivs[side];
    const isSelected = pick => focus.some(f => civKey(f) === civKey(pick));

    const title = document.createElement('div'); title.className = 'aoe4cp-selected';
    const label = document.createElement('span'); label.textContent = `${titlePrefix}:`;
    title.appendChild(label);
    const flags = document.createElement('span'); flags.className = 'aoe4cp-flags';
    picks.forEach((pick, i) => {
      if (i) { const plus = document.createElement('span'); plus.className = 'aoe4cp-plus'; plus.textContent = '+'; flags.appendChild(plus); }
      const sel = isSelected(pick);
      flags.appendChild(makeFlag(pick, sel, e => {
        if (e.shiftKey) focusedCivs[side] = sel ? focus.filter(f => civKey(f) !== civKey(pick)) : [...focus, pick]; // Shift+click toggles one civ in or out
        else focusedCivs[side] = (sel && focus.length === 1) ? [] : [pick];                                          // plain click: only this civ / back to all
        showCounters();
      }));
    });
    title.appendChild(flags);
    container.replaceChildren(title);

    const target = focus.length ? focus : picks;
    const usable = usablePicks(target);
    const skipped = target.filter(p => !usable.includes(p));
    let rows = usable.length ? combinedCounters(usable, picks) : [];
    const list = document.createElement('div');
    if (usable.length === 1) {
      rows = rows.map(r => ({ ...r, winRate: r.minRate }));
      renderRows(list, rows, 'normal');
    } else {
      renderRows(list, rows, 'combined');
    }
    container.appendChild(list);

    const addNote = text => { const note = document.createElement('p'); note.className = 'aoe4cp-note'; note.textContent = text; container.appendChild(note); };
    if (focus.length) addNote(`Best counters against ${focus.map(shownName).join(' + ')} only.`);
    if (skipped.length) addNote(`No matchup data yet for ${skipped.map(shownName).join(', ')} — left out of the ranking.`);
    if (usable.length > 1 && rows.length) addNote('Ranked by the lowest win rate across the selected civs (maximin), then average win rate. Every listed civ has data against each of them.');
    if (extraNote) addNote(extraNote);

    const tip = document.createElement('p'); tip.className = 'aoe4cp-tip';
    tip.textContent = 'Tip: click a flag to focus one civ · Shift+click to select several';
    container.appendChild(tip);
  }

  function showCounters() {
    if (!allMatchups) { setStatus('Matchup data is not loaded yet.'); return; }
    const records = extractRecords(allMatchups);

    // Recommendations depend only on the picks that are actually shown in the draft.
    // The picks of both captains are visible at the same time, so the left panel is
    // computed as soon as the guest has at least one pick. Both panels are neutral: the left one
    // shows the best counters for the host (against the guest's picks), the right one the guest's.
    const guestPicks = detectedGuestPicks;
    const hostPicks = detectedHostPicks;
    const leftContent = document.getElementById('aoe4cp-left-content');
    const rightContent = document.getElementById('aoe4cp-right-content');
    if (!leftContent || !rightContent) return;

    if (!guestPicks.length) {
      leftContent.textContent = 'Waiting for guest picks…';
    } else {
      renderCombinedPanel(leftContent, guestPicks, 'Guest picks',
        hostPicks.length > guestPicks.length ? `Guest has ${guestPicks.length} pick(s) so far vs. host's ${hostPicks.length}; this updates when more appear.` : '', 'left');
    }

    if (!hostPicks.length) {
      rightContent.textContent = 'Waiting for host picks…';
    } else {
      renderCombinedPanel(rightContent, hostPicks, 'Host picks',
        guestPicks.length > hostPicks.length ? `Host has ${hostPicks.length} pick(s) so far vs. guest's ${guestPicks.length}; this updates when more appear.` : '', 'right');
    }

    // Draft win-rate estimate from Host Captain's perspective.
    // Average Host's matchup rate against each Guest pick. Example: HRE vs
    // Mongols + Order of the Dragon = (HRE-vs-Mongols + HRE-vs-Order) / 2.
    const winrateBody = document.getElementById('aoe4cp-winrate-body');
    if (winrateBody) {
      if (!guestPicks.length || !hostPicks.length) {
        winrateBody.textContent = 'Waiting for both players to pick…';
      } else {
        const pairRates = [];
        const missingPairs = [];
        for (const host of hostPicks) {
          for (const guest of guestPicks) {
            const direct = records.find(r => civKey(r.civ) === civKey(host) && civKey(r.against) === civKey(guest));
            if (direct) { pairRates.push(direct.winRate); continue; }
            const reverse = records.find(r => civKey(r.civ) === civKey(guest) && civKey(r.against) === civKey(host));
            if (reverse) pairRates.push(1 - reverse.winRate);
            else missingPairs.push(`${host} vs ${guest}`);
          }
        }
        if (!pairRates.length) {
          winrateBody.textContent = 'No matchup data available for the current picks.';
        } else {
          const hostRate = pairRates.reduce((a,b)=>a+b,0) / pairRates.length;
          const guestRate = 1 - hostRate;
          const partial = missingPairs.length ? ` (${missingPairs.length} matchup(s) missing; based on ${pairRates.length} available)` : '';
          // The leading captain is green, the trailing one red; an exact tie is yellow.
          const hostPct = Math.round(hostRate * 1000) / 10, guestPct = Math.round(guestRate * 1000) / 10;
          const side = (a, b) => a > b ? 'aoe4cp-wr-good' : a < b ? 'aoe4cp-wr-bad' : 'aoe4cp-wr-neutral';
          const hostEl = document.createElement('span'); hostEl.className = side(hostPct, guestPct); hostEl.textContent = `${hostPct.toFixed(1)}%`;
          const guestEl = document.createElement('span'); guestEl.className = side(guestPct, hostPct); guestEl.textContent = `${guestPct.toFixed(1)}%`;
          winrateBody.replaceChildren('Host Captain: ', hostEl, '  ·  Guest Captain: ', guestEl, partial);
          winrateBody.title = `Host picks: ${hostPicks.join(', ')}; Guest picks: ${guestPicks.join(', ')}. Averaged ${pairRates.length} matchup rate(s).${missingPairs.length ? ' Missing: ' + missingPairs.join('; ') : ''}`;
        }
      }
    }

    if (!guestPicks.length && !hostPicks.length) setStatus('Matchup data ready. Waiting for draft picks.');
    else setStatus(`Host: ${hostPicks.length} pick(s) · Guest: ${guestPicks.length} pick(s)`);
  }

  // Read the picks of one captain straight from the AoE2CM draft DOM:
  //   #player-host / #player-guest
  //     .picks > .civ-panel.pick.has-value > .box-content .stretchy-text  (civ name)
  // Each captain has its own container, so host and guest can no longer be mixed up.
  // Panels without .has-value are empty slots and are ignored.
  function readSidePicks(sideId) {
    const side = document.getElementById(sideId);
    if (!side) return [];
    const picks = [];
    for (const panelEl of side.querySelectorAll('.picks .civ-panel.pick.has-value')) {
      const text = (panelEl.querySelector('.stretchy-text')?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || /^random/i.test(text)) continue;
      const src = imageFromPanel(panelEl);
      if (optionKind(text, src) !== 'civ') continue; // a map (or other non-civ option) is not a civ pick
      const known = canonicalCiv(text);
      if (!known && !learnedNames.has(norm(text))) learnedNames.set(norm(text), text);
      const civ = known || text;
      if (src) civImages.set(norm(civ), src);
      if (!picks.includes(civ)) picks.push(civ);
    }
    return picks;
  }
  function detectGuestPicks() { return readSidePicks('player-guest'); }
  function detectHostPicks() { return readSidePicks('player-host'); }
  function syncPicks() {
    syncDraft();
    const guests = detectGuestPicks();
    const hosts = detectHostPicks();
    const changed = JSON.stringify(guests) !== JSON.stringify(detectedGuestPicks) || JSON.stringify(hosts) !== JSON.stringify(detectedHostPicks);
    detectedGuestPicks = guests;
    detectedHostPicks = hosts;
    if (changed && allMatchups) showCounters();
  }
  // The draft DOM changes a lot (timers, animations); debounce so we only re-read once per burst.
  let syncTimer = null;
  const pageObserver = new MutationObserver(() => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { updateActive(); if (active) syncPicks(); }, 150);
  });
  pageObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  setTimeout(() => { if (active) syncPicks(); }, 1200);
  setTimeout(() => { if (active) syncPicks(); }, 3000);

  // ---- Draft info: picked map(s) and civ pools, cached per draft ----------------
  // Every filled turn panel (#panel-turn-N) is remembered per draft, so the picked map(s) and
  // the civs each captain can choose from stay visible after the draft view moves on.
  // Names that are not civilizations (checked against the matchup data) are treated as maps.
  const DRAFTS_KEY = 'aoe4cp_drafts';
  const MAPS_KEY = 'aoe4cp_maps';
  const MAX_DRAFTS = 20;
  // Maps are remembered across drafts: a tournament game usually has one draft for the map and a
  // separate one for the civs, so the map picked in the first one must still show in the second.
  const MAP_TTL = 24 * 60 * 60 * 1000;   // maps not seen for a day are no longer shown
  const MAP_TOUCH_MS = 10 * 60 * 1000;   // refresh "last seen" at most this often
  const MAX_MAPS = 20;
  const MAPS_SHOWN = 6;
  let mapsDb = [];        // [{ name, draftId, turn, title, t0 (first seen), t (last seen) }]
  let mapsTimer = null;
  // The civ pools work the same way: the pool is built in the pick/ban draft and then shown again
  // in the following civ picker draft, which is a different draft (and shows only the final picks).
  const POOLS_KEY = 'aoe4cp_pools';
  let poolsDb = null;     // { draftId, title, host: [{name,img}], guest: [{name,img}], t0, t }
  let poolsTimer = null;
  let draftsDb = {};      // draftId -> { t, obs: { [turn]: { turn, side, action, name, img } } }
  let lastDraftSig = '';
  let persistTimer = null;
  let civSetCache = { src: null, set: null };

  const currentDraftId = () => (location.pathname.match(/^\/(?:draft|spectate)\/([^/]+)/i) || [])[1] || null;

  async function loadDrafts() {
    try {
      const r = await api.storage.local.get([DRAFTS_KEY, MAPS_KEY, POOLS_KEY]);
      draftsDb = r[DRAFTS_KEY] && typeof r[DRAFTS_KEY] === 'object' ? r[DRAFTS_KEY] : {};
      mapsDb = Array.isArray(r[MAPS_KEY]) ? r[MAPS_KEY].filter(m => m && typeof m.name === 'string') : [];
      const pl = r[POOLS_KEY];
      poolsDb = pl && Array.isArray(pl.host) && Array.isArray(pl.guest) ? pl : null;
    } catch (e) { draftsDb = {}; mapsDb = []; poolsDb = null; }
  }
  function persistPools() {
    clearTimeout(poolsTimer);
    poolsTimer = setTimeout(() => { api.storage.local.set({ [POOLS_KEY]: poolsDb }).catch(() => {}); }, 400);
  }
  // A draft builds the pool when civs are banned in it (pick/ban phase) or when its title says "civ draft".
  // The civ picker that follows has neither, so it shows the saved pool instead of building its own.
  function isPoolSource() {
    const obs = Object.values(draftsDb[currentDraftId()]?.obs || {});
    if (obs.some(o => o.action === 'ban' && optionKind(o.name, o.img) === 'civ')) return true;
    const title = draftTitle();
    return /civ(?:ilization)?s?\W*draft/i.test(title) && !/picker/i.test(title);
  }
  function rememberPools(pools) {
    if (!pools.host.length && !pools.guest.length) return;
    const id = currentDraftId();
    const now = Date.now();
    const names = list => list.map(c => c.name).join('|');
    const same = poolsDb && poolsDb.draftId === id && names(poolsDb.host) === names(pools.host) && names(poolsDb.guest) === names(pools.guest);
    if (!same) {
      poolsDb = { draftId: id, title: draftTitle(), host: pools.host, guest: pools.guest, t0: poolsDb && poolsDb.draftId === id ? poolsDb.t0 : now, t: now };
      persistPools();
    } else if (now - poolsDb.t > MAP_TOUCH_MS) { poolsDb.t = now; persistPools(); }
  }
  // Source draft: its own pools. Any other draft: the saved pool of the latest civ draft (if recent).
  function displayedPools(d) {
    if (isPoolSource()) return { pools: d.pools, source: null };
    if (poolsDb && Date.now() - poolsDb.t <= MAP_TTL) return { pools: { host: poolsDb.host, guest: poolsDb.guest }, source: poolsDb };
    return { pools: { host: [], guest: [] }, source: null };
  }
  function persistMaps() {
    clearTimeout(mapsTimer);
    mapsTimer = setTimeout(() => {
      mapsDb = mapsDb.sort((a, b) => b.t - a.t).slice(0, MAX_MAPS);
      api.storage.local.set({ [MAPS_KEY]: mapsDb }).catch(() => {});
    }, 400);
  }
  function draftTitle() { return (document.getElementById('draft-title')?.textContent || '').replace(/\s+/g, ' ').trim(); }
  function rememberMaps(maps) {
    const id = currentDraftId();
    if (!id || !maps.length) return;
    const now = Date.now();
    let changed = false;
    for (const m of maps) {
      const e = mapsDb.find(x => x.draftId === id && x.turn === m.turn);
      if (!e) { mapsDb.push({ name: m.name, draftId: id, turn: m.turn, title: draftTitle(), t0: now, t: now }); changed = true; continue; }
      if (e.name !== m.name) { e.name = m.name; changed = true; }
      if (now - e.t > MAP_TOUCH_MS) { e.t = now; changed = true; }
    }
    if (changed) persistMaps();
  }
  function visibleMaps() {
    const now = Date.now();
    return mapsDb.filter(m => now - m.t <= MAP_TTL).sort((a, b) => a.t0 - b.t0 || a.turn - b.turn).slice(-MAPS_SHOWN);
  }
  function persistDrafts() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const keep = Object.keys(draftsDb).sort((a, b) => (draftsDb[b].t || 0) - (draftsDb[a].t || 0)).slice(0, MAX_DRAFTS);
      draftsDb = Object.fromEntries(keep.map(id => [id, draftsDb[id]]));
      api.storage.local.set({ [DRAFTS_KEY]: draftsDb }).catch(() => {});
    }, 400);
  }

  function absoluteUrl(src) { try { return new URL(src, location.href).href; } catch (e) { return null; } }

  function scanDraftPanels() {
    const found = [];
    for (const el of document.querySelectorAll('.civ-panel.has-value[id^="panel-turn-"]')) {
      const turn = Number(el.id.slice('panel-turn-'.length));
      if (!Number.isFinite(turn)) continue;
      const name = (el.querySelector('.stretchy-text')?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!name || /^random/i.test(name)) continue;
      const side = el.closest('#player-host') ? 'host' : el.closest('#player-guest') ? 'guest' : 'admin';
      const cl = el.classList;
      const action = cl.contains('ban') ? 'ban' : (cl.contains('steal') || cl.contains('snipe')) ? 'snipe' : 'pick';
      const img = imageFromPanel(el);
      found.push({ turn, side, action, name, img: img ? absoluteUrl(img) : null });
    }
    return found;
  }

  function syncDraft() {
    const id = currentDraftId();
    if (!id) return;
    const entry = draftsDb[id] || (draftsDb[id] = { t: Date.now(), obs: {} });
    let changed = false;
    for (const o of scanDraftPanels()) {
      const old = entry.obs[o.turn];
      if (!old || old.name !== o.name || old.side !== o.side || old.action !== o.action || (o.img && old.img !== o.img)) {
        entry.obs[o.turn] = { ...o, img: o.img || old?.img || null };
        changed = true;
      }
    }
    if (changed) { entry.t = Date.now(); persistDrafts(); }
    const derived = deriveDraft();
    rememberMaps(derived.maps);
    if (isPoolSource()) rememberPools(derived.pools);
    renderDraftInfo();
  }

  function civKeySet() {
    if (civSetCache.src === allMatchups && civSetCache.set) return civSetCache.set;
    const set = new Set(CIVS.map(norm));
    if (allMatchups) for (const r of extractRecords(allMatchups)) { set.add(civKey(r.civ)); set.add(civKey(r.against)); }
    civSetCache = { src: allMatchups, set };
    return set;
  }

  // maps: picked non-civ options in turn order. pools: the civs each captain picked first
  // (a civ that shows up again later is a later pick *from* that pool, so it is not added twice).
  function deriveDraft() {
    const id = currentDraftId();
    const all = Object.values(draftsDb[id]?.obs || {}).sort((a, b) => a.turn - b.turn);
    const maps = [], pools = { host: [], guest: [] }, seen = new Set();
    for (const o of all) {
      if (o.action !== 'pick') continue;
      if (optionKind(o.name, o.img) !== 'civ') { maps.push({ turn: o.turn, name: o.name }); continue; }
      if (o.side !== 'host' && o.side !== 'guest') continue;
      const key = civKey(o.name);
      if (seen.has(key)) continue;
      seen.add(key);
      pools[o.side].push({ name: o.name, img: o.img || null });
    }
    return { id, maps, pools };
  }

  function createMapBar() {
    if (document.getElementById('aoe4cp-map')) return;
    const bar = document.createElement('aside'); bar.id = 'aoe4cp-map';
    bar.innerHTML = '<span class="aoe4cp-map-label">Map</span><span class="aoe4cp-map-list" id="aoe4cp-map-body"></span>';
    document.documentElement.appendChild(bar);
  }

  function renderDraftInfo(force) {
    const d = deriveDraft();
    const shownMaps = visibleMaps();
    const shown = displayedPools(d);
    const sig = JSON.stringify({ d, shownMaps, shown });
    if (!force && sig === lastDraftSig) return; // our own DOM changes must not trigger endless re-renders
    lastDraftSig = sig;

    const body = document.getElementById('aoe4cp-map-body');
    if (body) {
      body.replaceChildren();
      if (!shownMaps.length) {
        const none = document.createElement('span'); none.className = 'aoe4cp-map-none'; none.textContent = 'not picked yet'; body.appendChild(none);
      }
      shownMaps.forEach((m, i) => {
        const chip = document.createElement('span'); chip.className = 'aoe4cp-map-chip' + (i === shownMaps.length - 1 ? ' aoe4cp-map-latest' : '');
        chip.title = `${m.title ? m.title + ' · ' : ''}draft ${m.draftId}`;
        if (shownMaps.length > 1) { const n = document.createElement('b'); n.textContent = String(i + 1); chip.appendChild(n); }
        chip.append(m.name);
        body.appendChild(chip);
      });
    }

    for (const [side, id, label] of [['host', 'aoe4cp-left-pool', 'Host pool'], ['guest', 'aoe4cp-right-pool', 'Guest pool']]) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.replaceChildren();
      const civsOfSide = shown.pools[side];
      if (!civsOfSide.length) continue;
      el.title = shown.source ? `Saved from ${shown.source.title ? shown.source.title + ' · ' : ''}draft ${shown.source.draftId}` : '';
      const lab = document.createElement('span'); lab.className = 'aoe4cp-pool-label'; lab.textContent = `${label} (${civsOfSide.length})${shown.source ? ' · saved' : ''}`;
      el.appendChild(lab);
      for (const c of civsOfSide) {
        const flag = document.createElement('span'); flag.className = 'aoe4cp-pool-flag'; flag.title = shownName(c.name);
        if (c.img) { const img = document.createElement('img'); img.src = c.img; img.alt = shownName(c.name); flag.appendChild(img); }
        else { flag.classList.add('aoe4cp-pool-text'); flag.textContent = shownName(c.name); }
        el.appendChild(flag);
      }
    }
  }

  function collectDebugInfo() {
    const chain = el => {
      const out = [];
      for (let n = el.parentElement, i = 0; n && i < 5; n = n.parentElement, i++) {
        out.push(n.tagName.toLowerCase() + (n.id ? `#${n.id}` : '') + [...n.classList].slice(0, 5).map(c => `.${c}`).join(''));
      }
      return out;
    };
    return {
      extensionVersion: api.runtime.getManifest?.().version,
      path: location.pathname,
      draftId: currentDraftId(),
      panels: [...document.querySelectorAll('.civ-panel[id^="panel-turn-"]')].map(el => ({
        id: el.id, classes: [...el.classList].join(' '), filled: el.classList.contains('has-value'),
        text: (el.querySelector('.stretchy-text')?.textContent || '').replace(/\s+/g, ' ').trim(), parents: chain(el),
      })),
      headings: [...document.querySelectorAll('.sub-heading, h1, h2, h3')].slice(0, 20).map(h => `${h.tagName.toLowerCase()}${h.id ? '#' + h.id : ''}: ${h.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)}`),
      countersUse: { host: detectedHostPicks, guest: detectedGuestPicks },
      poolSource: isPoolSource(),
      savedPool: poolsDb ? { draftId: poolsDb.draftId, title: poolsDb.title, host: poolsDb.host.map(c => c.name), guest: poolsDb.guest.map(c => c.name) } : null,
      derived: deriveDraft(),
    };
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.documentElement.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }

  // ---- Draft-only activation + show/hide button ------------------------------
  // The UI exists only on draft pages (/draft/<id> or /spectate/<id>). Elsewhere on
  // aoe2cm.net nothing is injected. AoE2CM can change pages without a full reload,
  // so the route is re-checked on DOM changes, back/forward and hash changes.
  const VISIBLE_KEY = 'aoe4cp_ui_visible';
  const AWAY_KEY = 'aoe4cp_away';
  const UI_IDS = ['aoe4cp-left', 'aoe4cp-right', 'aoe4cp-winrate', 'aoe4cp-toggle',
    'aoe4cp-tab-left', 'aoe4cp-tab-right', 'aoe4cp-tab-top', 'aoe4cp-settings', 'aoe4cp-tab-settings',
    'aoe4cp-map', 'aoe4cp-tab-map'];
  // Each panel can slide away to its own edge and be brought back with an arrow tab.
  // side -> [panel id, hide-arrow glyph (points to the edge), show-tab glyph, title for tooltips]
  const AWAY = {
    left:   ['aoe4cp-left',    '◀', '▶', 'left counters'],
    right:  ['aoe4cp-right',   '▶', '◀', 'right counters'],
    top:    ['aoe4cp-winrate', '▲', '▼', 'draft win-rate'],
    map:    ['aoe4cp-map',     '▲', '▼', 'map bar'],
    settings: ['aoe4cp-settings', '▶', '⚙', 'settings'],
  };
  // The settings panel is hidden by default; its gear tab stays at the screen edge.
  const away = { left: false, right: false, top: false, map: false, settings: true };
  let active = false;
  let uiVisible = true;
  const isDraftPage = () => /^\/(draft|spectate)\/[^/]+/i.test(location.pathname);

  function applyVisibility() {
    document.documentElement.classList.toggle('aoe4cp-ui-hidden', !uiVisible);
    const t = document.getElementById('aoe4cp-toggle');
    if (t) {
      t.textContent = uiVisible ? 'AoE4 counters: hide' : 'AoE4 counters: show';
      t.setAttribute('aria-pressed', String(uiVisible));
    }
  }
  function setUiVisible(v) {
    uiVisible = v;
    applyVisibility();
    api.storage.local.set({ [VISIBLE_KEY]: v }).catch(() => {});
  }
  function applyAway() {
    for (const side of Object.keys(AWAY)) document.documentElement.classList.toggle(`aoe4cp-away-${side}`, !!away[side]);
  }
  function setAway(side, v) {
    away[side] = v;
    applyAway();
    api.storage.local.set({ [AWAY_KEY]: { ...away } }).catch(() => {});
  }
  function createArrows() {
    for (const [side, [panelId, hideGlyph, showGlyph, label]] of Object.entries(AWAY)) {
      const target = document.getElementById(panelId);
      if (target && !target.querySelector('.aoe4cp-arrow')) {
        const hide = document.createElement('button');
        hide.type = 'button'; hide.className = 'aoe4cp-arrow'; hide.textContent = hideGlyph;
        hide.title = `Hide the ${label} (use the arrow tab at the screen edge to bring it back)`;
        hide.addEventListener('click', () => setAway(side, true));
        const host = target.querySelector('.aoe4cp-side-title, .aoe4cp-head') || target;
        host.appendChild(hide);
      }
      const tabId = `aoe4cp-tab-${side}`;
      if (!document.getElementById(tabId)) {
        const tab = document.createElement('button');
        tab.id = tabId; tab.type = 'button'; tab.className = 'aoe4cp-tab'; tab.textContent = showGlyph;
        tab.title = `Show the ${label}`;
        tab.addEventListener('click', () => setAway(side, false));
        document.documentElement.appendChild(tab);
      }
    }
  }

  function createToggle() {
    if (document.getElementById('aoe4cp-toggle')) return;
    const b = document.createElement('button');
    b.id = 'aoe4cp-toggle'; b.type = 'button'; b.title = 'Show or hide the AoE4 counter-pick panels';
    b.addEventListener('click', () => setUiVisible(!uiVisible));
    document.documentElement.appendChild(b);
  }

  async function activate() {
    active = true;
    await loadSettings();
    await loadDrafts();
    if (!active) return;
    applyOff();
    makePanel();
    syncSettingsControls();
    syncDraft();
    renderDraftInfo(true);
    createToggle();
    createArrows();
    applyVisibility();
    applyAway();
    api.storage.local.get([VISIBLE_KEY, AWAY_KEY]).then(r => {
      if (typeof r[VISIBLE_KEY] === 'boolean') { uiVisible = r[VISIBLE_KEY]; applyVisibility(); }
      if (r[AWAY_KEY] && typeof r[AWAY_KEY] === 'object') {
        for (const side of Object.keys(away)) if (typeof r[AWAY_KEY][side] === 'boolean') away[side] = r[AWAY_KEY][side];
        applyAway();
      }
    }).catch(() => {});
    if (allMatchups) {
      updateHeader();
      finishLoad();
    } else {
      loadMatchups();
    }
  }
  function deactivate() {
    active = false;
    for (const id of UI_IDS) document.getElementById(id)?.remove();
    document.documentElement.classList.remove('aoe4cp-ui-hidden');
    for (const side of Object.keys(AWAY)) document.documentElement.classList.remove(`aoe4cp-away-${side}`);
    for (const side of ['left', 'right', 'top', 'map', 'pools']) document.documentElement.classList.remove(`aoe4cp-off-${side}`);
    lastDraftSig = '';
    detectedGuestPicks = []; detectedHostPicks = [];
  }
  function updateActive() {
    const want = isDraftPage();
    if (want && !active) activate();
    else if (!want && active) deactivate();
  }
  window.addEventListener('popstate', updateActive);
  window.addEventListener('hashchange', updateActive);
  updateActive();
})();
