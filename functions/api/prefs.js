import { requireUser } from '../_lib/auth.js';

const KEY = 'prefs:v1';

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
  const { response } = await requireUser(request, env);
  if (response) return response;

  const stored = await env.PREFS.get(KEY);
  const text = stored ?? JSON.stringify(EMPTY);
  return json({ prefs: JSON.parse(text), etag: await etagOf(text) });
}

// Known limitation: KV is eventually consistent across edge locations, so two
// simultaneous edits from different regions can in principle both see the same
// etag and the later write wins. Acceptable residual risk for a two-person tool;
// Durable Objects would be the fix if it ever bites.
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

  const stored = await env.PREFS.get(KEY);
  const currentEtag = await etagOf(stored ?? JSON.stringify(EMPTY));
  if (body.etag !== currentEtag) {
    return json({ error: 'Preferences changed since you loaded them', etag: currentEtag }, 409);
  }

  const next = {
    ...body.prefs,
    version: 1,
    updated_at: new Date().toISOString(),
    updated_by: email,
  };
  const text = JSON.stringify(next);
  await env.PREFS.put(KEY, text);
  return json({ prefs: next, etag: await etagOf(text) });
}
