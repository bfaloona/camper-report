import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_EMAILS, verifiedEmail, requireUser, _resetJwksCache } from './auth.js';

const enc = new TextEncoder();
const b64urlJson = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const b64url = bytes => Buffer.from(bytes).toString('base64url');

const ENV = { CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-tag' };
const req = headers => new Request('https://example.com/api/prefs', { headers });
const loopbackReq = headers => new Request('http://localhost/api/prefs', { headers });
const previewReq = headers => new Request('https://preview-branch.pages.dev/api/prefs', { headers });

let privateKey, jwk;

async function keys() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']);
  privateKey = pair.privateKey;
  jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test-kid' };
}

async function signedWithHeader(header, payload) {
  const head = b64urlJson(header);
  const body = b64urlJson(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

async function signed(payload, kid = 'test-kid') {
  return signedWithHeader({ alg: 'RS256', kid, typ: 'JWT' }, payload);
}

const jwksDeps = () => ({ fetch: async () => ({ ok: true, json: async () => ({ keys: [jwk] }) }) });
const valid = (email = 'bfaloona@gmail.com') =>
  ({ email, aud: ['aud-tag'], exp: Math.floor(Date.now() / 1000) + 600 });

beforeEach(async () => { _resetJwksCache(); await keys(); });

test('the allowlist is exactly the two accounts', () => {
  assert.deepEqual([...ALLOWED_EMAILS].sort(), ['bfaloona@gmail.com', 'kristenwalshseattle@gmail.com']);
});

test('accepts a correctly signed token from the assertion header', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed(valid()) });
  assert.equal(await verifiedEmail(r, ENV, jwksDeps()), 'bfaloona@gmail.com');
});

test('accepts a correctly signed token from the CF_Authorization cookie', async () => {
  const r = req({ cookie: `CF_Authorization=${await signed(valid('kristenwalshseattle@gmail.com'))}` });
  assert.equal(await verifiedEmail(r, ENV, jwksDeps()), 'kristenwalshseattle@gmail.com');
});

test('normalizes case and whitespace on the email claim', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed(valid('  BFaloona@Gmail.com ')) });
  assert.equal(await verifiedEmail(r, ENV, jwksDeps()), 'bfaloona@gmail.com');
});

test('rejects a token whose payload was swapped after signing', async () => {
  const token = await signed(valid());
  const [head, , sig] = token.split('.');
  const forged = `${head}.${b64urlJson(valid('attacker@example.com'))}.${sig}`;
  assert.equal(await verifiedEmail(req({ 'cf-access-jwt-assertion': forged }), ENV, jwksDeps()), null);
});

test('rejects a token signed by a different key', async () => {
  const token = await signed(valid());
  await keys(); // the JWKS now serves a key that did not sign this token
  assert.equal(await verifiedEmail(req({ 'cf-access-jwt-assertion': token }), ENV, jwksDeps()), null);
});

test('rejects a token for a different audience', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed({ ...valid(), aud: ['other-app'] }) });
  assert.equal(await verifiedEmail(r, ENV, jwksDeps()), null);
});

test('rejects an expired token', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed({ ...valid(), exp: Math.floor(Date.now() / 1000) - 1 }) });
  assert.equal(await verifiedEmail(r, ENV, jwksDeps()), null);
});

test('rejects an alg:none token', async () => {
  const head = b64urlJson({ alg: 'none', kid: 'test-kid' });
  const r = req({ 'cf-access-jwt-assertion': `${head}.${b64urlJson(valid())}.` });
  assert.equal(await verifiedEmail(r, ENV, jwksDeps()), null);
});

test('rejects a token whose header claims a non-RS256 alg even though the signature is genuinely valid RS256', async () => {
  // Signed for real, over this exact header+body, with the real RSA private
  // key — crypto.subtle.verify will succeed under RSASSA-PKCS1-v1_5 regardless
  // of what the header's `alg` field says, because the code hardcodes RS256
  // for the verify call and never branches on header.alg to pick an algorithm.
  // That's exactly why the explicit `header.alg !== 'RS256'` pin has to exist:
  // without it, a token whose header claims HS256 (or anything else) still
  // verifies successfully. Swapping the header onto an already-signed token
  // (as opposed to signing over the swapped header) would invalidate the
  // signature for an unrelated reason and not exercise this pin at all.
  const token = await signedWithHeader({ alg: 'HS256', kid: 'test-kid', typ: 'JWT' }, valid());
  assert.equal(await verifiedEmail(req({ 'cf-access-jwt-assertion': token }), ENV, jwksDeps()), null);
});

test('verifiedEmail rejects when CF_ACCESS_AUD is not configured, regardless of the token', async () => {
  // payload.aud is JS `undefined` here (no aud claim at all — not JSON null),
  // and env.CF_ACCESS_AUD would also be `undefined` if this guard were missing.
  // [undefined].includes(undefined) is true, so without an explicit check this
  // would silently pass the audience check for any caller that forgets to
  // configure CF_ACCESS_AUD.
  const token = await signed({ email: 'bfaloona@gmail.com', exp: Math.floor(Date.now() / 1000) + 600 });
  const envWithoutAud = { CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com' };
  assert.equal(await verifiedEmail(req({ 'cf-access-jwt-assertion': token }), envWithoutAud, jwksDeps()), null);
});

test('returns null on a malformed token rather than throwing', async () => {
  assert.equal(await verifiedEmail(req({ 'cf-access-jwt-assertion': 'not.a.jwt' }), ENV, jwksDeps()), null);
  assert.equal(await verifiedEmail(req({ 'cf-access-jwt-assertion': 'garbage' }), ENV, jwksDeps()), null);
});

test('returns null when no token is present', async () => {
  assert.equal(await verifiedEmail(req({}), ENV, jwksDeps()), null);
});

test('returns null when the JWKS cannot be fetched', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed(valid()) });
  const failing = { fetch: async () => { throw new Error('network'); } };
  assert.equal(await verifiedEmail(r, ENV, failing), null);
});

test('caches the JWKS across calls', async () => {
  let calls = 0;
  const counting = { fetch: async () => { calls++; return { ok: true, json: async () => ({ keys: [jwk] }) }; } };
  const r = req({ 'cf-access-jwt-assertion': await signed(valid()) });
  await verifiedEmail(r, ENV, counting);
  await verifiedEmail(r, ENV, counting);
  assert.equal(calls, 1);
});

test('requireUser returns the email for an allowed account', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed(valid()) });
  assert.deepEqual(await requireUser(r, ENV, jwksDeps()), { email: 'bfaloona@gmail.com', response: null });
});

test('requireUser returns 403 for a verified but unlisted account', async () => {
  const r = req({ 'cf-access-jwt-assertion': await signed(valid('someone-else@gmail.com')) });
  const { email, response } = await requireUser(r, ENV, jwksDeps());
  assert.equal(email, null);
  assert.equal(response.status, 403);
});

test('requireUser returns 401 when no token is present', async () => {
  const { response } = await requireUser(req({}), ENV, jwksDeps());
  assert.equal(response.status, 401);
});

test('the 401 body stays generic regardless of which check failed (diagnosis goes to logs, not the caller)', async () => {
  const cases = [
    req({}), // no token
    req({ 'cf-access-jwt-assertion': 'garbage' }), // malformed
    req({ 'cf-access-jwt-assertion': await signed({ ...valid(), aud: ['other-app'] }) }), // aud mismatch
    req({ 'cf-access-jwt-assertion': await signed({ ...valid(), exp: Math.floor(Date.now() / 1000) - 1 }) }), // expired
  ];
  for (const r of cases) {
    const { response } = await requireUser(r, ENV, jwksDeps());
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Not authenticated' });
  }
});

test('requireUser returns 500 when Access verification is unconfigured', async () => {
  const { response } = await requireUser(req({}), {}, jwksDeps());
  assert.equal(response.status, 500);
});

test('the dev bypass works only when CF_ACCESS_AUD is unset', async () => {
  const devEnv = { DEV_BYPASS_EMAIL: 'bfaloona@gmail.com' };
  assert.equal((await requireUser(loopbackReq({}), devEnv, jwksDeps())).email, 'bfaloona@gmail.com');

  const prodEnv = { ...ENV, DEV_BYPASS_EMAIL: 'bfaloona@gmail.com' };
  const { email, response } = await requireUser(loopbackReq({}), prodEnv, jwksDeps());
  assert.equal(email, null);
  assert.equal(response.status, 401);
});

test('the dev bypass honors an x-dev-email override so 403s can be exercised', async () => {
  const devEnv = { DEV_BYPASS_EMAIL: 'bfaloona@gmail.com' };
  const { response } = await requireUser(loopbackReq({ 'x-dev-email': 'nobody@example.com' }), devEnv, jwksDeps());
  assert.equal(response.status, 403);
});

test('the dev bypass is rejected on a non-loopback host even with both env vars set for bypass', async () => {
  // This is the scenario the loopback check exists for: DEV_BYPASS_EMAIL leaked
  // onto a deployed environment (a preview deploy) where CF_ACCESS_AUD was
  // never configured, and the request reaches the Function anyway (Access
  // policy doesn't cover the preview hostname). Without the loopback condition
  // this would silently grant 'bfaloona@gmail.com' full access with no
  // authentication at all.
  const devEnv = { DEV_BYPASS_EMAIL: 'bfaloona@gmail.com' };
  const { email, response } = await requireUser(previewReq({}), devEnv, jwksDeps());
  assert.equal(email, null);
  assert.notEqual(response, null);
});
