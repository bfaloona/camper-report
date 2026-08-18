import { test } from 'node:test';
import assert from 'node:assert/strict';

// prefs.js is browser code. isSessionExpired compares against location.origin,
// so supply the one global it reads before the module is imported.
globalThis.location ??= { origin: 'https://camper-report.brandon-eaa.workers.dev' };
const ORIGIN = globalThis.location.origin;

const { parseNotes, formatNotes, mergeNotes, isSessionExpired, SESSION_EXPIRED } =
  await import('./prefs.js');

test('parseNotes reads the structured shape', () => {
  const r = parseNotes('likes:\n- heated seats\n- sunroof\n\ndislikes:\n- work van look');
  assert.deepEqual(r.likes, ['heated seats', 'sunroof']);
  assert.deepEqual(r.dislikes, ['work van look']);
  assert.deepEqual(r.freeform, []);
});

test('text typed outside any section is preserved, not eaten', () => {
  // The whole field is user-editable free text. Anything this does not
  // recognise must survive the round trip or it silently deletes their typing.
  const original = 'ask Kristen about the roof rack\nlikes:\n- sunroof';
  const r = parseNotes(original);
  assert.deepEqual(r.likes, ['sunroof']);
  assert.deepEqual(r.freeform, ['ask Kristen about the roof rack']);
  assert.match(formatNotes(r), /ask Kristen about the roof rack/);
});

test('mergeNotes files additions under the right heading', () => {
  const out = mergeNotes('likes:\n- sunroof', [
    { text: 'ventilated seats', polarity: 'like' },
    { text: 'looks like a work van', polarity: 'dislike' },
  ]);
  assert.equal(out, 'likes:\n- sunroof\n- ventilated seats\n\ndislikes:\n- looks like a work van');
});

test('re-running the same prose does not duplicate notes', () => {
  const first = mergeNotes('', [{ text: 'Sunroof', polarity: 'like' }]);
  const second = mergeNotes(first, [{ text: 'sunroof', polarity: 'like' }]);
  assert.equal(second, first, 'case-insensitive dedupe');
});

test('merging into empty notes produces the structure from scratch', () => {
  assert.equal(mergeNotes('', [{ text: 'a', polarity: 'like' }]), 'likes:\n- a');
  assert.equal(mergeNotes(null, [{ text: 'b', polarity: 'dislike' }]), 'dislikes:\n- b');
});

test('malformed additions are skipped rather than written as blanks', () => {
  assert.equal(mergeNotes('', [null, { text: '   ' }, { polarity: 'like' }, 42]), '');
});

test('a round trip through parse and format is stable', () => {
  const text = 'likes:\n- a\n- b\n\ndislikes:\n- c';
  assert.equal(formatNotes(parseNotes(text)), text);
});

// --- Expired Access session -------------------------------------------------
// Access answers an expired session with a redirect to its login page on
// another origin, which a same-origin fetch cannot follow. boot() aborts on the
// first rejection, so without this the whole tool reads as broken.

test('a redirect off-origin is an expired session', () => {
  assert.equal(isSessionExpired({
    status: 200, redirected: true,
    url: 'https://bfaloona.cloudflareaccess.com/cdn-cgi/access/login/camper-report',
  }), true);
});

test('our own guard 401 is an expired session', () => {
  assert.equal(isSessionExpired({ status: 401, url: `${ORIGIN}/api/prefs` }), true);
});

test('an opaque response is an expired session', () => {
  assert.equal(isSessionExpired({ type: 'opaqueredirect', url: '' }), true);
});

test('an ordinary same-origin response is not', () => {
  assert.equal(isSessionExpired({ status: 200, redirected: false, url: `${ORIGIN}/api/prefs` }), false);
});

// A 503 from a KV read is a real fault with its own message. Mislabelling it
// "sign in again" would send someone chasing the wrong problem.
test('a server error is not an expired session', () => {
  assert.equal(isSessionExpired({ status: 503, redirected: false, url: `${ORIGIN}/api/prefs` }), false);
});

// A same-origin redirect (a trailing-slash normalisation, say) is not a sign-out.
test('a same-origin redirect is not an expired session', () => {
  assert.equal(isSessionExpired({ status: 200, redirected: true, url: `${ORIGIN}/api/prefs/` }), false);
});

test('the message tells the reader what to do', () => {
  assert.match(SESSION_EXPIRED, /reload/i);
});
