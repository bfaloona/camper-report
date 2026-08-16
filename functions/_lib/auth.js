// Cloudflare Access is the gate. This is the second lock, and it only counts as
// one because it verifies the JWT signature: an unverified base64 decode — or
// trusting Cf-Access-Authenticated-User-Email — is forgeable by anything that
// reaches this Function without passing Access, which is the exact failure this
// is here to catch. /api/parse spends money, so that matters.
export const ALLOWED_EMAILS = new Set([
  'bfaloona@gmail.com',
  'kristenwalshseattle@gmail.com',
]);

const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = { url: null, keys: null, fetchedAt: 0 };

export function _resetJwksCache() {
  jwksCache = { url: null, keys: null, fetchedAt: 0 };
}

function b64urlToBytes(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64urlToJson = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

function cookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    if (pair.slice(0, idx).trim() === name) return pair.slice(idx + 1).trim();
  }
  return null;
}

export function tokenFromRequest(request) {
  return request.headers.get('cf-access-jwt-assertion')
    || cookie(request, 'CF_Authorization')
    || null;
}

async function jwks(teamDomain, fetchImpl) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (jwksCache.keys && jwksCache.url === url && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const body = await res.json();
  jwksCache = { url, keys: body.keys || [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

export async function verifiedEmail(request, env, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const nowSeconds = deps.now ? deps.now() : Math.floor(Date.now() / 1000);

  const token = tokenFromRequest(request);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header, payload;
  try {
    header = b64urlToJson(parts[0]);
    payload = b64urlToJson(parts[1]);
  } catch (e) {
    return null;
  }

  if (header.alg !== 'RS256') return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.CF_ACCESS_AUD)) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  if (typeof payload.email !== 'string') return null;

  let keys;
  try {
    keys = await jwks(env.CF_ACCESS_TEAM_DOMAIN, fetchImpl);
  } catch (e) {
    return null;
  }

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let signature;
  try {
    signature = b64urlToBytes(parts[2]);
  } catch (e) {
    return null;
  }

  const candidates = keys.filter(k => !header.kid || !k.kid || k.kid === header.kid);
  for (const k of candidates) {
    const { use, key_ops, ...jwkKey } = k;
    try {
      const key = await crypto.subtle.importKey(
        'jwk', { ...jwkKey, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data)) {
        return payload.email.trim().toLowerCase();
      }
    } catch (e) {
      // Unusable key — try the next one.
    }
  }
  return null;
}

function deny(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function requireUser(request, env, deps) {
  // Local only: wrangler pages dev can't mint an Access token. Gated on
  // CF_ACCESS_AUD being absent, which never happens in a deployed environment,
  // so this stays inert in production even if the variable is set there.
  if (env.DEV_BYPASS_EMAIL && !env.CF_ACCESS_AUD) {
    const email = (request.headers.get('x-dev-email') || env.DEV_BYPASS_EMAIL).trim().toLowerCase();
    if (!ALLOWED_EMAILS.has(email)) return { email: null, response: deny(403, 'Not authorized') };
    return { email, response: null };
  }

  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    return { email: null, response: deny(500, 'Access verification is not configured') };
  }

  const email = await verifiedEmail(request, env, deps);
  if (!email) return { email: null, response: deny(401, 'Not authenticated') };
  if (!ALLOWED_EMAILS.has(email)) return { email: null, response: deny(403, 'Not authorized') };
  return { email, response: null };
}
