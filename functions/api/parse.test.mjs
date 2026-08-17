import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCriteria, splitParse, FIELD_IDS, onRequestPost } from './parse.js';

// Loopback + DEV_BYPASS_EMAIL, no CF_ACCESS_AUD: exercises the real requireUser
// dev-bypass path (see functions/_lib/auth.js) rather than stubbing the guard —
// a stubbed guard would prove nothing about whether this endpoint is behind it.
const AUTHED_ENV = { DEV_BYPASS_EMAIL: 'bfaloona@gmail.com' };
const parseReq = text => new Request('http://localhost/api/parse', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text }),
});

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

test('routes an unknown field to notes instead of dropping it', () => {
  const r = splitParse([{
    label: 'Good stereo', tier: 'nice-to-have', kind: 'hard',
    rule: { field: 'stereo_quality', op: '>', value: 3 }, source_text: 'good stereo',
  }]);
  assert.deepEqual(r.criteria, []);
  assert.deepEqual(r.notes, ['Good stereo']);
});

test('routes an unknown operator to notes', () => {
  const r = splitParse([{
    label: 'Length', tier: 'must-have', kind: 'hard',
    rule: { field: 'length_in', op: 'approximately', value: 195 }, source_text: 'about 195',
  }]);
  assert.deepEqual(r.criteria, []);
  assert.deepEqual(r.notes, ['Length']);
});

test('routes a non-numeric value on a numeric field to notes', () => {
  const r = splitParse([{
    label: 'Length', tier: 'must-have', kind: 'hard',
    rule: { field: 'length_in', op: '<', value: 'short' }, source_text: 'short',
  }]);
  assert.deepEqual(r.criteria, []);
  assert.deepEqual(r.notes, ['Length']);
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
  // Uses real rules now: an entry with no rule no longer becomes a criterion,
  // so the old all-manual fixture would have produced an empty list.
  const out = validateCriteria([
    { label: 'A', tier: 'must-have', kind: 'hard', rule: { field: 'length_in', op: '<', value: 200 } },
    { label: 'B', tier: 'nice-to-have', kind: 'hard', rule: { field: 'width_in', op: '<', value: 80 } },
  ]);
  assert.deepEqual(out.map(c => c.rank), [1, 2]);
  assert.deepEqual(out.map(c => c.weight), [5, 4]);
  assert.deepEqual(out.map(c => c.weight_locked), [false, false]);
});

test('returns an empty array for a non-array input', () => {
  assert.deepEqual(validateCriteria(null), []);
  assert.deepEqual(validateCriteria({ criteria: [] }), []);
});

test('a missing ANTHROPIC_API_KEY returns a clear 500 and never names the variable', async () => {
  const res = await onRequestPost({
    request: parseReq('under 195 inches long'),
    env: AUTHED_ENV, // no ANTHROPIC_API_KEY
  });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
  assert.doesNotMatch(body.error, /ANTHROPIC_API_KEY/i);
  assert.doesNotMatch(body.error, /api[_ -]?key/i);
});

test('keeps a valid "between" rule, ordering the values low-to-high', () => {
  const [c] = validateCriteria([{
    label: 'Mid-size price', tier: 'must-have', kind: 'hard',
    rule: { field: 'price_low', op: 'between', value: [40000, 25000] }, source_text: '$25k-$40k',
  }]);
  assert.equal(c.kind, 'hard');
  assert.deepEqual(c.rule, { field: 'price_low', op: 'between', value: [25000, 40000] });
});

test('routes a "between" rule whose value is not a two-element numeric array to notes', () => {
  const r = splitParse([{
    label: 'Mid-size price', tier: 'must-have', kind: 'hard',
    rule: { field: 'price_low', op: 'between', value: [25000] }, source_text: 'around $25k',
  }]);
  assert.deepEqual(r.criteria, []);
  assert.deepEqual(r.notes, ['Mid-size price']);
});

test('accepts a bare enum scalar and normalizes it to an array', () => {
  const [c] = validateCriteria([{
    label: 'AWD only', tier: 'must-have', kind: 'hard',
    rule: { field: 'drivetrain_bucket', op: 'in', value: 'awd' }, source_text: 'awd',
  }]);
  assert.equal(c.kind, 'hard');
  assert.deepEqual(c.rule, { field: 'drivetrain_bucket', op: 'in', value: ['awd'] });
});

test('routes an enum value outside the allowed set to notes', () => {
  const r = splitParse([{
    label: 'Hovercraft powertrain', tier: 'nice-to-have', kind: 'hard',
    rule: { field: 'powertrain', op: 'in', value: ['hovercraft'] }, source_text: 'hovercraft',
  }]);
  assert.deepEqual(r.criteria, []);
  assert.deepEqual(r.notes, ['Hovercraft powertrain']);
});

test('routes a numeric operator applied to an enum field to notes', () => {
  const r = splitParse([{
    label: 'Powertrain', tier: 'nice-to-have', kind: 'hard',
    rule: { field: 'powertrain', op: '<', value: 3 }, source_text: 'powertrain < 3',
  }]);
  assert.deepEqual(r.criteria, []);
  assert.deepEqual(r.notes, ['Powertrain']);
});

test('an unauthenticated request never reaches the API key check (401/403 before spending money)', async () => {
  // CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD set (so requireUser doesn't 500 for
  // being unconfigured) but no DEV_BYPASS_EMAIL and no token on the request, so
  // requireUser must reject before onRequestPost ever looks at
  // ANTHROPIC_API_KEY. If auth ran after the key check, a missing key here
  // would produce 500, not 401/403 — that's the ordering this test pins.
  const env = { CF_ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-tag' };
  const res = await onRequestPost({ request: parseReq('under 195 inches long'), env });
  assert.ok([401, 403].includes(res.status), `expected 401 or 403, got ${res.status}`);
});

test('the output schema declares a concrete type everywhere', async () => {
  // Structured outputs reject an empty schema `{}` with a 400 naming the field,
  // and the failure is invisible until a live API call is made -- no local test
  // exercised it, so `value: {}` shipped and every parse attempt failed.
  const { SCHEMA } = await import('./parse.js');
  const offenders = [];
  const walk = (node, path) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const keys = Object.keys(node);
    if (keys.length === 0) { offenders.push(path); return; }
    // A schema node is concrete if it says what it is, or defers to a combinator.
    const isSchemaNode = 'type' in node || 'anyOf' in node || 'oneOf' in node
      || 'allOf' in node || 'enum' in node || '$ref' in node;
    const isContainer = path.endsWith('.properties') || path.endsWith('.items');
    if (!isSchemaNode && !isContainer && ('properties' in node) === false
        && path !== '' && !path.endsWith(']')) {
      // A node under `properties` that declares nothing concrete.
      if (path.includes('.properties.')) offenders.push(path);
    }
    for (const [k, v] of Object.entries(node)) {
      if (Array.isArray(v)) v.forEach((el, i) => walk(el, `${path}.${k}[${i}]`));
      else walk(v, `${path}.${k}`);
    }
  };
  walk(SCHEMA, '');
  assert.deepEqual(offenders, [], `schema nodes with no concrete type: ${offenders.join(', ')}`);
});

test('a want with no usable rule becomes a note, not an inert criterion', async () => {
  // The old behaviour kept it as kind:"manual" -- a criterion with a tier and a
  // weight that filtered nothing and scored nothing, while reporting itself as
  // a satisfied must-have.
  const { splitParse } = await import('./parse.js');
  const r = splitParse([
    { label: 'Has heated seats', tier: 'nice-to-have', kind: 'manual', rule: null, source_text: 'heated seats' },
    { label: 'Under 193 inches', tier: 'must-have', kind: 'hard',
      rule: { field: 'length_in', op: '<', value: 193 }, source_text: 'under 193' },
  ]);
  assert.equal(r.criteria.length, 1);
  assert.equal(r.criteria[0].label, 'Under 193 inches');
  assert.deepEqual(r.notes, ['Has heated seats']);
  assert.equal(r.criteria.every(c => c.kind !== 'manual'), true, 'no manual criteria may survive');
});

test('a criterion naming an unknown field becomes a note even when the model calls it hard', async () => {
  // validRule is the authority, not the model's own `kind` -- otherwise a
  // confident hallucination reintroduces exactly the inert criterion we removed.
  const { splitParse } = await import('./parse.js');
  const r = splitParse([
    { label: 'Sunroof', tier: 'nice-to-have', kind: 'hard',
      rule: { field: 'has_sunroof', op: '==', value: true }, source_text: 'sunroof' },
  ]);
  assert.deepEqual(r.criteria, []);
  assert.deepEqual(r.notes, ['Sunroof']);
});

test('notes from the model merge with unusable criteria, without duplicates', async () => {
  const { splitParse } = await import('./parse.js');
  const r = splitParse(
    [{ label: 'Sunroof', tier: 'nice-to-have', kind: 'manual', rule: null, source_text: 'sunroof' }],
    ['Sunroof', 'Prefer a quiet cabin', '  ', 42],
  );
  assert.deepEqual(r.notes, ['Sunroof', 'Prefer a quiet cabin']);
});

test('ranks stay contiguous when unusable entries are filtered out', async () => {
  // Ranks used to be assigned before the manual/hard split existed; dropping
  // entries mid-list must not leave a gap the weight calculation inherits.
  const { splitParse } = await import('./parse.js');
  const hard = n => ({ label: n, tier: 'must-have', kind: 'hard',
    rule: { field: 'length_in', op: '<', value: 200 }, source_text: n });
  const dud = n => ({ label: n, tier: 'must-have', kind: 'manual', rule: null, source_text: n });
  const r = splitParse([hard('a'), dud('x'), hard('b'), dud('y'), hard('c')]);
  assert.deepEqual(r.criteria.map(c => c.rank), [1, 2, 3]);
  assert.deepEqual(r.criteria.map(c => c.label), ['a', 'b', 'c']);
});
