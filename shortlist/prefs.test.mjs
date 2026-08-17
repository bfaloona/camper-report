import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNotes, formatNotes, mergeNotes } from './prefs.js';

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
