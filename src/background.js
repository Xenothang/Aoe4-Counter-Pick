/*
 * AoE4 Counter Pick for AoE2CM — background script / service worker.
 *
 * Content scripts are subject to the page's CORS rules, so cross-origin requests to
 * AoE4World are made here, where the extension's host permissions apply.
 * Works in Firefox (event page) and Chromium browsers (MV3 service worker).
 */
const api = globalThis.browser ?? globalThis.chrome;

const ALLOWED_HOSTS = new Set(['aoe4world.com', 'www.aoe4world.com']);
// Only the two endpoints the extension actually needs.
const ALLOWED_PATHS = new Set(['/api/v0/stats/rm_solo/matchups', '/stats/rm_solo/matchups']);

async function handleFetch(message) {
  try {
    const url = new URL(message.url);
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || !ALLOWED_PATHS.has(url.pathname)) {
      throw new Error('Blocked request to an unapproved URL');
    }
    const response = await fetch(url.href, { credentials: 'omit', cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url.hostname}`);
    const data = message.action === 'text' ? await response.text() : await response.json();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) };
  }
}

// `sendResponse` + `return true` is the one pattern that works in both Firefox and Chrome.
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'AOE4CP_FETCH') return false;
  if (sender && sender.id && sender.id !== api.runtime.id) return false;
  handleFetch(message).then(sendResponse);
  return true;
});
