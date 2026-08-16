import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCriteria, FIELD_IDS } from './parse.js';

test('the field vocabulary includes the documented fields', () => {
  for (const f of ['length_in', 'safety_feature_count', 'powertrain', 'drivetrain_bucket']) {
    assert.ok(FIELD_IDS.includes(f), `${f} missing from FIELD_IDS`);
  }
});

test('keeps a well-formed hard numeric criterion', () => {
  const [c] = validateCriteria([{
    label: 'Under 195 inches long', tier: 'deal-breaker', kind: 'hard',
    rule: { field: 'length_in', op: '<', value: 195 }, source_text: 'shorter than 195 in',
  }]);
  assert.equal(c.kind, 'hard');
  assert.deepEqual(c.rule, { field: 'length_in', op: '<', value: 195 });
  assert.match(c.id, /^c_/);
});

test('keeps a well-formed fuzzy criterion', () => {
  const [c] = validateCriteria([{
    label: 'Max safety features', tier: 'must-have', kind: 'fuzzy',
    rule: { field: 'safety_feature_count', direction: 'higher' }, source_text: 'max safety',
  }]);
  assert.equal(c.kind, 'fuzzy');
  assert.equal(c.rule.direction, 'higher');
});

test('demotes an unknown field to manual instead of dropping it', () => {
  const [c] = validateCriteria([{
    label: 'Good stereo', tier: 'nice-to-have', kind: 'hard',
    rule: { field: 'stereo_quality', op: '>', value: 3 }, source_text: 'good stereo',
  }]);
  assert.equal(c.kind, 'manual');
  assert.equal(c.rule, null);
  assert.equal(c.label, 'Good stereo');
});

test('demotes an unknown operator to manual', () => {
  const [c] = validateCriteria([{
    label: 'Length', tier: 'must-have', kind: 'hard',
    rule: { field: 'length_in', op: 'approximately', value: 195 }, source_text: 'about 195',
  }]);
  assert.equal(c.kind, 'manual');
});

test('demotes a non-numeric value on a numeric field', () => {
  const [c] = validateCriteria([{
    label: 'Length', tier: 'must-have', kind: 'hard',
    rule: { field: 'length_in', op: '<', value: 'short' }, source_text: 'short',
  }]);
  assert.equal(c.kind, 'manual');
});

test('accepts enum membership rules', () => {
  const [c] = validateCriteria([{
    label: 'AWD only', tier: 'must-have', kind: 'hard',
    rule: { field: 'drivetrain_bucket', op: 'in', value: ['awd'] }, source_text: 'awd',
  }]);
  assert.equal(c.kind, 'hard');
});

test('rejects an unknown tier', () => {
  assert.deepEqual(validateCriteria([{ label: 'x', tier: 'wishlist', kind: 'manual', rule: null }]), []);
});

test('drops entries with no usable label', () => {
  assert.deepEqual(validateCriteria([{ label: '   ', tier: 'must-have', kind: 'manual', rule: null }]), []);
});

test('assigns sequential ranks and derived weights', () => {
  const out = validateCriteria([
    { label: 'A', tier: 'must-have', kind: 'manual', rule: null },
    { label: 'B', tier: 'nice-to-have', kind: 'manual', rule: null },
  ]);
  assert.deepEqual(out.map(c => c.rank), [1, 2]);
  assert.deepEqual(out.map(c => c.weight), [5, 4]);
  assert.deepEqual(out.map(c => c.weight_locked), [false, false]);
});

test('returns an empty array for a non-array input', () => {
  assert.deepEqual(validateCriteria(null), []);
  assert.deepEqual(validateCriteria({ criteria: [] }), []);
});
