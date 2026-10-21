(() => {
  'use strict';

  // Firefox exposes `browser`; Chromium-based browsers expose `chrome` (promise-based in MV3).
  const api = globalThis.browser ?? globalThis.chrome;

  const API = 'https://aoe4world.com/api/v0/stats/rm_solo/matchups';
  const STATS_PAGE = 'https://aoe4world.com/stats/rm_solo/matchups';
  const CACHE_KEY = 'aoe4cp_cache_v2';
  const SETTINGS_KEY = 'aoe4cp_settings';
  const DEFAULT_SETTINGS = { counterCount: 5, rank: '≥conqueror', patch: 'auto', show: { left: true, right: true, top: true } };
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
    'Zhu Xi’s Legacy'
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

  function resolveOpponentRow(opponent) {
    const target = civKey(opponent);
    // Keep records where the candidate civ is the player civilization and the
    // selected opponent is `other_civilization`. This is the direction we need.
    return extractRecords(allMatchups).filter(r => civKey(r.against) === target);
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
    for (const side of ['left', 'right', 'top']) {
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
        <label class="aoe4cp-check"><input type="checkbox" data-el="left"> Left panel · your best counters</label>
        <label class="aoe4cp-check"><input type="checkbox" data-el="right"> Right panel · opponent counter options</label>
        <label class="aoe4cp-check"><input type="checkbox" data-el="top"> Top bar · draft win-rate</label>
      </div>
      <div id="aoe4cp-set-status" role="status"></div>
      <div class="aoe4cp-set-buttons"><button type="button" id="aoe4cp-set-refresh">Refresh data</button><button type="button" id="aoe4cp-set-reset">Reset to defaults</button></div>
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
    el.querySelector('#aoe4cp-set-reset').addEventListener('click', () => {
      settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      saveSettings(); applyOff(); syncSettingsControls(); loadMatchups();
    });
  }

  function createSidebars() {
    if (!document.getElementById('aoe4cp-left')) {
      const left = document.createElement('aside'); left.id = 'aoe4cp-left';
      left.innerHTML = '<div class="aoe4cp-side-title">Your best counter</div><div class="aoe4cp-side-subtitle">Counters against all opponent picks</div><div class="aoe4cp-side-content" id="aoe4cp-left-content">Waiting for opponent picks…</div>';
      document.documentElement.appendChild(left);
    }
    if (!document.getElementById('aoe4cp-right')) {
      const right = document.createElement('aside'); right.id = 'aoe4cp-right';
      right.innerHTML = '<div class="aoe4cp-side-title">Opponent counter options</div><div class="aoe4cp-side-subtitle">Best win rates against your picks</div><div class="aoe4cp-side-content" id="aoe4cp-right-content">Waiting for your picks…</div>';
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

  // Which flag is focused per side panel (null = all picks combined).
  const focusedCiv = { left: null, right: null };

  function makeFlag(civ, focused, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'aoe4cp-flag' + (focused ? ' aoe4cp-flag-active' : '');
    btn.title = `${shownName(civ)} — click to show the best counters against this civ only`;
    btn.setAttribute('aria-pressed', String(focused));
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
    // Forget a focus whose civ is no longer picked.
    if (focusedCiv[side] && !picks.some(p => civKey(p) === civKey(focusedCiv[side]))) focusedCiv[side] = null;
    const focus = focusedCiv[side];

    const title = document.createElement('div'); title.className = 'aoe4cp-selected';
    const label = document.createElement('span'); label.textContent = `${titlePrefix}:`;
    title.appendChild(label);
    const flags = document.createElement('span'); flags.className = 'aoe4cp-flags';
    picks.forEach((pick, i) => {
      if (i) { const plus = document.createElement('span'); plus.className = 'aoe4cp-plus'; plus.textContent = '+'; flags.appendChild(plus); }
      const isFocus = !!focus && civKey(focus) === civKey(pick);
      flags.appendChild(makeFlag(pick, isFocus, () => {
        focusedCiv[side] = isFocus ? null : pick;
        showCounters();
      }));
    });
    title.appendChild(flags);
    container.replaceChildren(title);

    const target = focus ? [focus] : picks;
    let rows = combinedCounters(target, picks);
    const list = document.createElement('div');
    if (focus) {
      rows = rows.map(r => ({ ...r, winRate: r.minRate }));
      renderRows(list, rows, 'normal');
    } else {
      renderRows(list, rows, 'combined');
    }
    container.appendChild(list);

    const hint = document.createElement('p'); hint.className = 'aoe4cp-note';
    if (focus) hint.textContent = `Best counters against ${shownName(focus)} only. Click its flag again to go back to all picks.`;
    else if (picks.length > 1) hint.textContent = 'Click a flag to see the best counters against that civ only.';
    if (hint.textContent) container.appendChild(hint);

    if (!focus && rows.length) {
      const note = document.createElement('p'); note.className = 'aoe4cp-note';
      note.textContent = 'Ranked by the lowest win rate across all picks (maximin), then average win rate. Every listed civ has data against each pick.';
      container.appendChild(note);
    }
    if (extraNote) {
      const note = document.createElement('p'); note.className = 'aoe4cp-note'; note.textContent = extraNote;
      container.appendChild(note);
    }
  }

  function showCounters() {
    if (!allMatchups) { setStatus('Matchup data is not loaded yet.'); return; }
    const records = extractRecords(allMatchups);

    // Recommendations depend only on the picks that are actually shown in the draft.
    // The picks of both captains are visible at the same time, so the left panel is
    // computed as soon as the opponent has at least one pick.
    const guestPicks = detectedGuestPicks;
    const hostPicks = detectedHostPicks;
    const leftContent = document.getElementById('aoe4cp-left-content');
    const rightContent = document.getElementById('aoe4cp-right-content');
    if (!leftContent || !rightContent) return;

    if (!guestPicks.length) {
      leftContent.textContent = 'Waiting for opponent picks…';
    } else {
      renderCombinedPanel(leftContent, guestPicks, 'Opponent picks',
        hostPicks.length > guestPicks.length ? `Opponent has ${guestPicks.length} pick(s) so far vs. your ${hostPicks.length}; this updates when more appear.` : '', 'left');
    }

    if (!hostPicks.length) {
      rightContent.textContent = 'Waiting for your (Host Captain) picks…';
    } else {
      renderCombinedPanel(rightContent, hostPicks, 'Your picks',
        guestPicks.length > hostPicks.length ? `You have ${hostPicks.length} pick(s) so far vs. opponent's ${guestPicks.length}.` : '', 'right');
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

    if (!guestPicks.length) setStatus('Matchup data ready. Waiting for draft picks.');
    else setStatus(`Countering ${guestPicks.map(shownName).join(' + ')} · robust win-rate ranking`);
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
      const known = canonicalCiv(text);
      if (!known && !learnedNames.has(norm(text))) learnedNames.set(norm(text), text);
      const civ = known || text;
      const src = imageFromPanel(panelEl);
      if (src) civImages.set(norm(civ), src);
      if (!picks.includes(civ)) picks.push(civ);
    }
    return picks;
  }
  function detectGuestPicks() { return readSidePicks('player-guest'); }
  function detectHostPicks() { return readSidePicks('player-host'); }
  function syncPicks() {
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

  // ---- Draft-only activation + show/hide button ------------------------------
  // The UI exists only on draft pages (/draft/<id> or /spectate/<id>). Elsewhere on
  // aoe2cm.net nothing is injected. AoE2CM can change pages without a full reload,
  // so the route is re-checked on DOM changes, back/forward and hash changes.
  const VISIBLE_KEY = 'aoe4cp_ui_visible';
  const AWAY_KEY = 'aoe4cp_away';
  const UI_IDS = ['aoe4cp-left', 'aoe4cp-right', 'aoe4cp-winrate', 'aoe4cp-toggle',
    'aoe4cp-tab-left', 'aoe4cp-tab-right', 'aoe4cp-tab-top', 'aoe4cp-settings', 'aoe4cp-tab-settings'];
  // Each panel can slide away to its own edge and be brought back with an arrow tab.
  // side -> [panel id, hide-arrow glyph (points to the edge), show-tab glyph, title for tooltips]
  const AWAY = {
    left:   ['aoe4cp-left',    '◀', '▶', 'left counters'],
    right:  ['aoe4cp-right',   '▶', '◀', 'right counters'],
    top:    ['aoe4cp-winrate', '▲', '▼', 'draft win-rate'],
    settings: ['aoe4cp-settings', '▶', '⚙', 'settings'],
  };
  // The settings panel is hidden by default; its gear tab stays at the screen edge.
  const away = { left: false, right: false, top: false, settings: true };
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
    if (!active) return;
    applyOff();
    makePanel();
    syncSettingsControls();
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
    for (const side of ['left', 'right', 'top']) document.documentElement.classList.remove(`aoe4cp-off-${side}`);
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
