import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPut } from './prefs.js';

const KEY = 'prefs:v1';
const DEFAULT_PREFS = {
  version: 1,
  updated_at: null,
  updated_by: null,
  pins: ['mazda5-gen3', 'chevrolet-bolt-ev-gen1'],
  criteria: [],
  notes: '',
};

// A tiny fake KV backed by a Map. `get`/`put` can be overwritten per-test to
// throw, so the error-handling paths can be exercised without wrangler or a
// real KV outage.
function makeKv(initialText) {
  const store = new Map();
  if (initialText !== undefined) store.set(KEY, initialText);
  return {
    store,
    get: async key => (store.has(key) ? store.get(key) : null),
    put: async (key, value) => { store.set(key, value); },
  };
}

// Loopback + DEV_BYPASS_EMAIL, no CF_ACCESS_AUD: this exercises the real
// requireUser dev-bypass path (see functions/_lib/auth.js) rather than
// stubbing the guard out — a test that stubs the guard proves nothing about
// whether this endpoint is actually behind it.
function makeEnv(kv, overrides = {}) {
  return { PREFS: kv, DEV_BYPASS_EMAIL: 'bfaloona@gmail.com', ...overrides };
}

const getReq = () => new Request('http://localhost/api/prefs');
const putReq = body => new Request('http://localhost/api/prefs', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

async function currentEtag(env) {
  const res = await onRequestGet({ request: getReq(), env });
  return (await res.json()).etag;
}

test('onRequestGet returns a JSON 5xx, not a throw, when the KV read fails', async () => {
  const kv = makeKv();
  kv.get = async () => { throw new Error('kv unavailable'); };
  const env = makeEnv(kv);
  const res = await onRequestGet({ request: getReq(), env });
  assert.ok(res.status >= 500 && res.status < 600, `expected 5xx, got ${res.status}`);
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
});

test('onRequestPut returns a JSON 5xx, not a throw, when the KV write fails', async () => {
  const kv = makeKv();
  const env = makeEnv(kv);
  const etag = await currentEtag(env);
  kv.put = async () => { throw new Error('kv unavailable'); };
  const res = await onRequestPut({
    request: putReq({ etag, prefs: { pins: [], criteria: [] } }),
    env,
  });
  assert.ok(res.status >= 500 && res.status < 600, `expected 5xx, got ${res.status}`);
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
});

test('onRequestGet falls back to defaults and says so when the stored value is corrupted', async () => {
  const kv = makeKv('not valid json{{{');
  const env = makeEnv(kv);
  const res = await onRequestGet({ request: getReq(), env });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.prefs, DEFAULT_PREFS);
  assert.match(body.warning, /corrupted/i);
});

test('a save succeeds against corrupted storage instead of 409ing forever', async () => {
  // GET and PUT once disagreed about what a corrupt value hashes to: GET
  // reported the defaults' etag, PUT compared against the raw garbage string's.
  // The client cannot escape that on its own — its 409 handler tells the user to
  // reload, and reloading re-runs GET and returns the same losing etag. Assert
  // the whole round trip, not just that the two hashes match, so the test still
  // means something if the etag scheme changes.
  const kv = makeKv('not valid json{{{');
  const env = makeEnv(kv);

  const etag = await currentEtag(env);
  const res = await onRequestPut({
    request: putReq({ etag, prefs: { pins: ['mazda5-gen3'], criteria: [] } }),
    env,
  });

  assert.equal(res.status, 200, `expected the save to land, got ${res.status}`);
  // The garbage must actually be gone, not merely accepted.
  assert.deepEqual(JSON.parse(kv.store.get(KEY)).pins, ['mazda5-gen3']);

  // And the corruption warning must clear once real data is stored.
  const after = await (await onRequestGet({ request: getReq(), env })).json();
  assert.equal(after.warning, undefined);
});

test('onRequestGet does not warn about corruption when nothing has been saved yet', async () => {
  // The empty store and the corrupt store both fall back to the defaults; only
  // the corrupt one is worth alarming the user about.
  const res = await onRequestGet({ request: getReq(), env: makeEnv(makeKv()) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).warning, undefined);
});

test('onRequestGet returns the caller\'s own authenticated email, not just who last saved', async () => {
  const kv = makeKv();
  const env = makeEnv(kv);
  const res = await onRequestGet({ request: getReq(), env });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.email, 'bfaloona@gmail.com');
});

test('PUT drops unexpected top-level keys before writing to KV', async () => {
  const kv = makeKv();
  const putCalls = [];
  const rawPut = kv.put.bind(kv);
  kv.put = async (key, value) => { putCalls.push(value); return rawPut(key, value); };
  const env = makeEnv(kv);
  const etag = await currentEtag(env);

  const res = await onRequestPut({
    request: putReq({
      etag,
      junk: 'x',
      prefs: { pins: ['mazda5-gen3'], criteria: [], alsoJunk: 'y' },
    }),
    env,
  });

  assert.equal(res.status, 200);
  assert.equal(putCalls.length, 1);
  const stored = JSON.parse(putCalls[0]);
  assert.deepEqual(Object.keys(stored).sort(), ['criteria', 'notes', 'pins', 'updated_at', 'updated_by', 'version']);
  assert.deepEqual(stored.pins, ['mazda5-gen3']);
  assert.deepEqual(stored.criteria, []);
});

test('PUT rejects a prefs blob over the 100 KB limit with 400 and never calls KV.put', async () => {
  const kv = makeKv();
  let putCalled = false;
  kv.put = async () => { putCalled = true; };
  const env = makeEnv(kv);
  const etag = await currentEtag(env);

  const oversizedCriteria = Array(600).fill('x'.repeat(200)); // ~120 KB serialized
  const res = await onRequestPut({
    request: putReq({ etag, prefs: { pins: [], criteria: oversizedCriteria } }),
    env,
  });

  assert.equal(res.status, 400);
  assert.equal(putCalled, false);
});

test('PUT ignores a caller-supplied updated_by and stores the authenticated email instead', async () => {
  const kv = makeKv();
  const env = makeEnv(kv);
  const etag = await currentEtag(env);

  const res = await onRequestPut({
    request: putReq({
      etag,
      prefs: { pins: [], criteria: [], updated_by: 'attacker@example.com' },
    }),
    env,
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.prefs.updated_by, 'bfaloona@gmail.com');
  const stored = JSON.parse(kv.store.get(KEY));
  assert.equal(stored.updated_by, 'bfaloona@gmail.com');
});

test('notes round-trip through a save', async () => {
  const kv = makeKv();
  const env = makeEnv(kv);
  const etag = await currentEtag(env);
  const res = await onRequestPut({
    request: putReq({ etag, prefs: { pins: [], criteria: [], notes: 'Heated seats.\nSunroof.' } }),
    env,
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).prefs.notes, 'Heated seats.\nSunroof.');
  assert.equal(JSON.parse(kv.store.get(KEY)).notes, 'Heated seats.\nSunroof.');
});

test('a non-string notes value is coerced, not rejected', async () => {
  // An older client sends no notes at all, and a malformed one could send null.
  // Neither should turn a working save into a 400.
  const kv = makeKv();
  const env = makeEnv(kv);
  for (const bad of [undefined, null, 42, { a: 1 }, ['x']]) {
    const etag = await currentEtag(env);
    const res = await onRequestPut({
      request: putReq({ etag, prefs: { pins: [], criteria: [], notes: bad } }),
      env,
    });
    assert.equal(res.status, 200, `notes=${JSON.stringify(bad)} should not fail the save`);
    assert.equal((await res.json()).prefs.notes, '');
  }
});

test('oversized notes are rejected by the size limit', async () => {
  // notes is the only free-text field, so it is the one a caller would use to
  // turn the shared blob into general-purpose storage.
  const kv = makeKv();
  const env = makeEnv(kv);
  const etag = await currentEtag(env);
  const res = await onRequestPut({
    request: putReq({ etag, prefs: { pins: [], criteria: [], notes: 'x'.repeat(200 * 1024) } }),
    env,
  });
  assert.equal(res.status, 400);
});
