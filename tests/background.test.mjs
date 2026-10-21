import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'background.js');

async function loadBackground() {
  let listener;
  globalThis.browser = { runtime: { id: 'test-id', onMessage: { addListener: fn => { listener = fn; } } } };
  const fetched = [];
  globalThis.fetch = async url => { fetched.push(url); return { ok: true, status: 200, json: async () => ({ data: [] }), text: async () => '<html></html>' }; };
  await import(pathToFileURL(file).href + '?t=' + Math.random());
  const call = message => new Promise(resolve => {
    const keepOpen = listener(message, { id: 'test-id' }, resolve);
    if (keepOpen !== true) resolve(undefined);
  });
  return { call, fetched };
}

test('fetches the AoE4World matchup endpoints and answers asynchronously', async () => {
  const { call, fetched } = await loadBackground();
  const json = await call({ type: 'AOE4CP_FETCH', action: 'json', url: 'https://aoe4world.com/api/v0/stats/rm_solo/matchups?patch=1&rank_level=x' });
  assert.deepEqual(json, { ok: true, data: { data: [] } });
  const text = await call({ type: 'AOE4CP_FETCH', action: 'text', url: 'https://aoe4world.com/stats/rm_solo/matchups' });
  assert.equal(text.ok, true);
  assert.equal(fetched.length, 2);
});

test('blocks other hosts, other paths and non-https URLs', async () => {
  const { call, fetched } = await loadBackground();
  for (const url of ['https://evil.example/api/v0/stats/rm_solo/matchups', 'https://aoe4world.com/api/v0/players', 'http://aoe4world.com/stats/rm_solo/matchups']) {
    const res = await call({ type: 'AOE4CP_FETCH', action: 'json', url });
    assert.equal(res.ok, false, url);
  }
  assert.equal(fetched.length, 0);
});

test('ignores unrelated messages', async () => {
  const { call } = await loadBackground();
  assert.equal(await call({ type: 'SOMETHING_ELSE' }), undefined);
});
