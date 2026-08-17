import { requireUser } from '../_lib/auth.js';

const KEY = 'prefs:v1';

// Generous for a criteria/pins list and well under KV's 25 MB value limit; big
// enough that no real usage should hit it, small enough that the blob can't be
// abused as general-purpose storage.
const MAX_BODY_BYTES = 100 * 1024;

const EMPTY = {
  version: 1,
  updated_at: null,
  updated_by: null,
  pins: ['mazda5-gen3', 'chevrolet-bolt-ev-gen1'],
  criteria: [],
};

async function etagOf(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function onRequestGet({ request, env }) {
  const { email, response } = await requireUser(request, env);
  if (response) return response;

  let stored;
  try {
    stored = await env.PREFS.get(KEY);
  } catch (e) {
    return json({ error: 'Preferences store is unavailable' }, 503);
  }

  const text = stored ?? JSON.stringify(EMPTY);
  let prefs;
  try {
    prefs = JSON.parse(text);
  } catch (e) {
    // Corrupted stored value: don't fail the read, fall back to defaults, but
    // say so — a silent fallback would look to the client like an empty blob
    // was intentional.
    const fallbackText = JSON.stringify(EMPTY);
    return json({
      prefs: EMPTY,
      etag: await etagOf(fallbackText),
      email,
      warning: 'Stored preferences were corrupted; showing defaults.',
    });
  }
  // `email` is the caller's own signed-in identity (from the verified Access
  // JWT), distinct from `prefs.updated_by` (who last saved) — a shared tool
  // needs both shown, not just one standing in for the other.
  return json({ prefs, etag: await etagOf(text), email });
}

// Known limitation: Workers KV has no compare-and-swap, so this endpoint's
// concurrency control is check-then-act, not atomic. If two PUTs both read the
// current etag before either writes, both see the same etag, both pass this
// check, and the second write silently wins — no 409. The etag catches
// *sequential* staleness (a PUT that arrives after someone else's write) but
// not two writes racing each other from the same starting etag. Acceptable
// residual risk for a two-person tool; Durable Objects would give real
// compare-and-swap if this ever bites.
export async function onRequestPut({ request, env }) {
  const { email, response } = await requireUser(request, env);
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Body must be JSON' }, 400);
  }
  if (!body || typeof body.prefs !== 'object' || body.prefs === null) {
    return json({ error: 'Body must be { prefs, etag }' }, 400);
  }
  if (!Array.isArray(body.prefs.criteria) || !Array.isArray(body.prefs.pins)) {
    return json({ error: 'prefs.criteria and prefs.pins must be arrays' }, 400);
  }

  // Only these two fields are ever persisted (see next, below) — measure
  // against what will actually be stored, not the whole caller-supplied body.
  const candidateSize = new TextEncoder().encode(
    JSON.stringify({ pins: body.prefs.pins, criteria: body.prefs.criteria })
  ).length;
  if (candidateSize > MAX_BODY_BYTES) {
    return json({ error: `prefs must be under ${MAX_BODY_BYTES} bytes` }, 400);
  }

  let stored;
  try {
    stored = await env.PREFS.get(KEY);
  } catch (e) {
    return json({ error: 'Preferences store is unavailable' }, 503);
  }
  const currentEtag = await etagOf(stored ?? JSON.stringify(EMPTY));
  if (body.etag !== currentEtag) {
    return json({ error: 'Preferences changed since you loaded them', etag: currentEtag }, 409);
  }

  // Pick only known fields — never spread the caller's body verbatim. Spreading
  // would store (and echo back) any extra top-level key the caller sent, with
  // no size bound, turning this blob into arbitrary storage.
  const next = {
    version: 1,
    updated_at: new Date().toISOString(),
    updated_by: email,
    pins: body.prefs.pins,
    criteria: body.prefs.criteria,
  };
  const text = JSON.stringify(next);
  try {
    await env.PREFS.put(KEY, text);
  } catch (e) {
    return json({ error: 'Preferences store is unavailable' }, 503);
  }
  return json({ prefs: next, etag: await etagOf(text) });
}
