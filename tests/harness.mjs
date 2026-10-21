import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONTENT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content.js'), 'utf8');
export const sleep = ms => new Promise(r => setTimeout(r, ms));

const pickPanel = name => `<div class="civ-panel pick has-value"><div class="box-content"><div class="stretchy-wrapper"><div class="stretchy-image civ-indicator"><img src="/img/${name.replace(/\W/g, '')}.png"></div><div class="stretchy-text">${name}</div></div></div></div>`;
const emptyPanel = '<div class="civ-panel pick"><div class="stretchy-text"></div></div>';

export const rec = (civilization, other_civilization, win_rate, games_count = 300) => ({ civilization, other_civilization, win_rate, games_count });

export const DEFAULT_STATS_HTML = `<select name="patch_id"><option value="any">All</option><option value="10604,10884" selected>16.2 (June 1st)</option><option value="9999">15.9 (old)</option></select>
<select name="rank_level"><option value="≥conqueror">Conqueror+</option><option value="≥diamond">Diamond+</option><option value="bronze">Bronze</option></select>`;

/** Builds a fake aoe2cm draft page, runs the content script in it and returns helpers. */
export function createPage({ url = 'https://www.aoe2cm.net/draft/test', host = [], guest = [], data = [], statsHtml = DEFAULT_STATS_HTML, store = {} } = {}) {
  const html = `<body><div id="player-host"><div class="picks">${host.map(pickPanel).join('')}${emptyPanel}</div></div><div id="player-guest"><div class="picks">${guest.map(pickPanel).join('')}</div></div></body>`;
  const w = new JSDOM(html, { runScripts: 'outside-only', url }).window;
  const requests = [];
  w.browser = {
    runtime: { sendMessage: async m => { requests.push(decodeURIComponent(m.url)); return m.action === 'text' ? { ok: true, data: statsHtml } : { ok: true, data: { data } }; } },
    storage: { local: { get: async ks => Object.fromEntries([].concat(ks).map(k => [k, store[k]])), set: async o => { Object.assign(store, o); } } },
  };
  // jsdom's console noise from console.debug diagnostics is not useful in test output.
  w.console.debug = () => {};
  w.eval(CONTENT);
  const d = w.document;
  const $ = sel => d.querySelector(sel);
  const $$ = sel => [...d.querySelectorAll(sel)];
  return {
    window: w, document: d, store, requests, $, $$,
    htmlClasses: () => [...d.documentElement.classList].filter(c => c.startsWith('aoe4cp')),
    fire: (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true })),
    rows: id => $$(`#${id} .aoe4cp-side-row`).map(r => ({
      name: r.querySelector('.aoe4cp-name').textContent,
      rate: r.querySelector('strong').textContent,
      cls: r.querySelector('strong').className,
    })),
  };
}
