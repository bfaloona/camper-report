import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_EMAILS, verifiedEmail, requireUser, _resetJwksCache } from './auth.js';

const enc = new TextEncoder();
const b64urlJson = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const b64url = bytes => Buffer.from(bytes).toString('base64url');

const ENV = { CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-tag' };
const req = headers => new Request('https://example.com/api/prefs', { headers });

let privateKey, jwk;

async function keys() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']);
  privateKey = pair.privateKey;
  jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test-kid' };
}

async function signed(payload, kid = 'test-kid') {
  const head = b64urlJson({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64urlJson(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
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

test('requireUser returns 500 when Access verification is unconfigured', async () => {
  const { response } = await requireUser(req({}), {}, jwksDeps());
  assert.equal(response.status, 500);
});

test('the dev bypass works only when CF_ACCESS_AUD is unset', async () => {
  const devEnv = { DEV_BYPASS_EMAIL: 'bfaloona@gmail.com' };
  assert.equal((await requireUser(req({}), devEnv, jwksDeps())).email, 'bfaloona@gmail.com');

  const prodEnv = { ...ENV, DEV_BYPASS_EMAIL: 'bfaloona@gmail.com' };
  const { email, response } = await requireUser(req({}), prodEnv, jwksDeps());
  assert.equal(email, null);
  assert.equal(response.status, 401);
});

test('the dev bypass honors an x-dev-email override so 403s can be exercised', async () => {
  const devEnv = { DEV_BYPASS_EMAIL: 'bfaloona@gmail.com' };
  const { response } = await requireUser(req({ 'x-dev-email': 'nobody@example.com' }), devEnv, jwksDeps());
  assert.equal(response.status, 403);
});
