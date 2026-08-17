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
  // Wants no field can express. Absent from older stored blobs, so every
  // reader must treat a missing value as empty rather than assume the key.
  notes: '',
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

// Both handlers read through here so they agree on what the stored blob *is*.
// They have to: the etag GET hands out is the one PUT compares against, so if
// GET treats an unparseable value as the defaults while PUT hashes the raw
// corrupt string, the two etags can never match. Every save then 409s, and the
// client's 409 message tells the user to reload — which re-runs GET and returns
// the same mismatched etag. Corrupt storage would otherwise be a permanent,
// self-inflicted deadlock only an operator with KV access could clear.
//
// "Readable" means usable, not merely parseable. `null`, `42`, `"hello"` and
// `[]` are all valid JSON, and accepting them reopens the same trap by a
// different door: a stored `null` gives a clean 200 with no warning and then
// throws in the page before anything renders, and a blob missing `pins` boots
// fine but 400s on every save, because the client only ever re-initializes
// `criteria` and `notes`. Both leave the user reloading forever.
//
// Requiring the shape here means every unusable value takes the same path as an
// unparseable one — treated as absent, warned about, and overwritten by the next
// successful save.
function usable(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && Array.isArray(v.pins) && Array.isArray(v.criteria);
}

// Exported for tests: the aliasing and shape rules below are invisible through
// the HTTP response, which is serialized either way.
// Throws on a KV read failure; callers turn that into a 503.
export async function readStored(env) {
  const stored = await env.PREFS.get(KEY);
  if (stored !== null && stored !== undefined) {
    try {
      const parsed = JSON.parse(stored);
      if (usable(parsed)) return { prefs: parsed, text: stored, corrupted: false };
    } catch (e) {
      // Unparseable — falls through with everything else we cannot use.
    }
  }
  // A fresh copy, never the shared EMPTY: handing out the module constant means
  // any future caller that mutates the returned prefs poisons the defaults for
  // every later request in the same isolate.
  const fallback = { ...EMPTY, pins: [...EMPTY.pins], criteria: [] };
  // `corrupted` distinguishes "nothing saved yet" from "something saved but
  // unusable"; only the latter warrants warning the client.
  return {
    prefs: fallback,
    text: JSON.stringify(fallback),
    corrupted: stored !== null && stored !== undefined,
  };
}

export async function onRequestGet({ request, env }) {
  const { email, response } = await requireUser(request, env);
  if (response) return response;

  let read;
  try {
    read = await readStored(env);
  } catch (e) {
    return json({ error: 'Preferences store is unavailable' }, 503);
  }

  // `email` is the caller's own signed-in identity (from the verified Access
  // JWT), distinct from `prefs.updated_by` (who last saved) — a shared tool
  // needs both shown, not just one standing in for the other.
  const body = { prefs: read.prefs, etag: await etagOf(read.text), email };
  if (read.corrupted) {
    // Say so rather than falling back silently, which would look to the client
    // like an empty blob was intentional.
    body.warning = 'Stored preferences were corrupted; showing defaults.';
  }
  return json(body);
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

  // Free text, so this is the field a caller would use to turn the blob into
  // general-purpose storage. It counts toward the size limit below, and is
  // coerced rather than rejected so a null from an older client is not an error.
  const notes = typeof body.prefs.notes === 'string' ? body.prefs.notes : '';

  // Only these fields are ever persisted (see next, below) — measure against
  // what will actually be stored, not the whole caller-supplied body.
  const candidateSize = new TextEncoder().encode(
    JSON.stringify({ pins: body.prefs.pins, criteria: body.prefs.criteria, notes })
  ).length;
  if (candidateSize > MAX_BODY_BYTES) {
    return json({ error: `prefs must be under ${MAX_BODY_BYTES} bytes` }, 400);
  }

  let read;
  try {
    read = await readStored(env);
  } catch (e) {
    return json({ error: 'Preferences store is unavailable' }, 503);
  }
  const currentEtag = await etagOf(read.text);
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
    notes,
  };
  const text = JSON.stringify(next);
  try {
    await env.PREFS.put(KEY, text);
  } catch (e) {
    return json({ error: 'Preferences store is unavailable' }, 503);
  }
  return json({ prefs: next, etag: await etagOf(text) });
}
