import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, fieldValue, evaluateGate, rankVehicles } from './scoring.js';

const v = (id, over = {}) => ({
  id,
  make: 'Test', model: id, class: 'SUV', powertrain: 'gas', drivetrain: 'AWD', listed_year: 2024,
  exterior_in: { length: 190, width: 73, height: 67 },
  cargo_length_behind_front_seats_in: { value: 70 },
  max_cargo_cf: { value: 70 },
  mpg: { city: 25, hwy: 30 },
  kbb_value_usd: { low: 30000, high: 35000 },
  tow_rating: { max: 3500, tongue: 350 },
  reliability: { score: 4.0 },
  safety: { features: ['a', 'b', 'c'] },
  conversion_products: [{ name: 'x' }],
  camper_popularity: { rating: 'Medium' },
  ...over,
});

const hard = (field, op, value, tier = 'must-have') =>
  ({ id: 'h', label: 'gate', tier, kind: 'hard', rank: 1, weight: 5, rule: { field, op, value } });
const fuzzy = (field, direction, tier = 'nice-to-have', weight = 3) =>
  ({ id: 'f', label: 'pref', tier, kind: 'fuzzy', rank: 1, weight, rule: { field, direction } });

test('every documented field resolves', () => {
  const car = v('a');
  for (const id of Object.keys(FIELDS)) {
    assert.doesNotThrow(() => fieldValue(car, id), `${id} threw`);
  }
});

// The parser and the scorer keep two copies of the field vocabulary. If they
// drift, the parser emits criteria naming fields the scorer cannot read, and
// those criteria silently never score — no error, just a preference that
// quietly does nothing. This test is the only thing preventing that.
test('every field the parser can emit is one the scorer can read', async () => {
  const { FIELD_IDS } = await import('../functions/api/parse.js');
  const missing = FIELD_IDS.filter(id => !(id in FIELDS));
  assert.deepEqual(missing, [], `parse.js emits fields scoring.js cannot resolve: ${missing}`);
});

test('no scorer field resolves to a raw object', () => {
  // e.g. max_cargo_cf is `{value, config, source}` in vehicles.json — the
  // getter must reach `.value`, not hand the scorer a dict to compare with `<`.
  const car = v('a');
  for (const id of Object.keys(FIELDS)) {
    const out = fieldValue(car, id);
    assert.ok(out === null || typeof out === 'number' || typeof out === 'string',
      `${id} returned ${typeof out}`);
  }
});

test('drivetrain buckets AWD and 4WD together', () => {
  assert.equal(fieldValue(v('a', { drivetrain: '4WD' }), 'drivetrain_bucket'), 'awd');
  assert.equal(fieldValue(v('a', { drivetrain: 'FWD' }), 'drivetrain_bucket'), '2wd');
});

test('camper_popularity is ordinal', () => {
  assert.equal(fieldValue(v('a', { camper_popularity: { rating: 'High' } }), 'camper_popularity'), 3);
});

test('a missing optional field reads as null', () => {
  assert.equal(fieldValue(v('a', { max_cargo_cf: null }), 'max_cargo_cf'), null);
});

// EV fuel economy: EPA MPGe on a BEV is an energy-equivalence figure, not a
// fuel-burn figure. The Chevrolet Bolt shows 131 city / 109 hwy MPGe — reading
// those as MPG would rank it first on efficiency against every gas vehicle in
// the set, which is nonsense. Treat mpg.city/mpg.hwy as unknown for EVs so an
// MPG criterion neither excludes nor falsely favors them.
test('an EV reads mpg_city and mpg_hwy as unknown, not as MPGe', () => {
  const bolt = v('bolt', {
    powertrain: 'ev',
    mpg: { city: 131, hwy: 109, mpge: 120, ev_range_mi: 259 },
  });
  assert.equal(fieldValue(bolt, 'mpg_city'), null);
  assert.equal(fieldValue(bolt, 'mpg_hwy'), null);
});

test('an EV MPG gate reads as unknown, never as pass or fail', () => {
  const bolt = v('bolt', { powertrain: 'ev', mpg: { city: 131, hwy: 109 } });
  assert.equal(evaluateGate(bolt, hard('mpg_city', '>', 30)), 'unknown');
});

test('gate passes and fails on numeric comparison', () => {
  assert.equal(evaluateGate(v('a'), hard('length_in', '<', 195)), 'pass');
  assert.equal(evaluateGate(v('a'), hard('length_in', '<', 180)), 'fail');
});

test('between is inclusive', () => {
  assert.equal(evaluateGate(v('a'), hard('length_in', 'between', [190, 200])), 'pass');
  assert.equal(evaluateGate(v('a'), hard('length_in', 'between', [191, 200])), 'fail');
});

test('enum in and not_in', () => {
  assert.equal(evaluateGate(v('a'), hard('drivetrain_bucket', 'in', ['awd'])), 'pass');
  assert.equal(evaluateGate(v('a'), hard('drivetrain_bucket', 'not_in', ['awd'])), 'fail');
});

test('a missing value is unknown, never a failure', () => {
  assert.equal(evaluateGate(v('a', { max_cargo_cf: null }), hard('max_cargo_cf', '>', 60)), 'unknown');
});

test('a failed must-have excludes the vehicle', () => {
  const out = rankVehicles([v('a'), v('b', { exterior_in: { length: 210, width: 73, height: 67 } })],
    [hard('length_in', '<', 195)], new Set());
  assert.equal(out.find(r => r.vehicle.id === 'a').excluded, false);
  assert.equal(out.find(r => r.vehicle.id === 'b').excluded, true);
});

test('a failed must-have gate excludes the vehicle', () => {
  const out = rankVehicles([v('b', { exterior_in: { length: 210, width: 73, height: 67 } })],
    [hard('length_in', '<', 195, 'must-have')], new Set());
  assert.equal(out[0].excluded, true);
  assert.deepEqual(out[0].violations.map(x => x.id), ['h']);
});

test('a pinned vehicle survives a failed gate but keeps the violation', () => {
  const out = rankVehicles([v('b', { exterior_in: { length: 210, width: 73, height: 67 } })],
    [hard('length_in', '<', 195, 'must-have')], new Set(['b']));
  assert.equal(out[0].excluded, false);
  assert.equal(out[0].pinned, true);
  assert.deepEqual(out[0].violations.map(x => x.id), ['h']);
});

test('an unknown value is reported but does not exclude', () => {
  const out = rankVehicles([v('a', { max_cargo_cf: null })], [hard('max_cargo_cf', '>', 60)], new Set());
  assert.equal(out[0].excluded, false);
  assert.deepEqual(out[0].unknowns.map(x => x.id), ['h']);
});

test('fuzzy higher ranks the larger value first', () => {
  const out = rankVehicles(
    [v('small', { max_cargo_cf: { value: 50 } }), v('big', { max_cargo_cf: { value: 100 } })],
    [fuzzy('max_cargo_cf', 'higher')], new Set());
  assert.deepEqual(out.map(r => r.vehicle.id), ['big', 'small']);
  assert.equal(out[0].score, 100);
  assert.equal(out[1].score, 0);
});

test('fuzzy lower inverts the ordering', () => {
  const out = rankVehicles(
    [v('cheap', { kbb_value_usd: { low: 10000, high: 12000 } }),
     v('dear', { kbb_value_usd: { low: 50000, high: 55000 } })],
    [fuzzy('price_low', 'lower')], new Set());
  assert.deepEqual(out.map(r => r.vehicle.id), ['cheap', 'dear']);
});

test('a dislike tier subtracts', () => {
  const out = rankVehicles(
    [v('short', { exterior_in: { length: 170, width: 73, height: 67 } }),
     v('long', { exterior_in: { length: 210, width: 73, height: 67 } })],
    [fuzzy('length_in', 'higher', 'dislike')], new Set());
  assert.deepEqual(out.map(r => r.vehicle.id), ['short', 'long']);
});

test('weights change the ordering', () => {
  const cheapRoomy = v('a', { kbb_value_usd: { low: 10000, high: 12000 }, max_cargo_cf: { value: 50 } });
  const dearRoomier = v('b', { kbb_value_usd: { low: 50000, high: 55000 }, max_cargo_cf: { value: 100 } });
  const priceHeavy = rankVehicles([cheapRoomy, dearRoomier],
    [{ ...fuzzy('price_low', 'lower'), id: 'p', weight: 5 },
     { ...fuzzy('max_cargo_cf', 'higher'), id: 'c', weight: 1 }], new Set());
  assert.equal(priceHeavy[0].vehicle.id, 'a');
  const cargoHeavy = rankVehicles([cheapRoomy, dearRoomier],
    [{ ...fuzzy('price_low', 'lower'), id: 'p', weight: 1 },
     { ...fuzzy('max_cargo_cf', 'higher'), id: 'c', weight: 5 }], new Set());
  assert.equal(cargoHeavy[0].vehicle.id, 'b');
});

test('manual criteria never affect the score', () => {
  const manual = { id: 'm', label: 'vibes', tier: 'nice-to-have', kind: 'manual', rank: 1, weight: 5, rule: null };
  const out = rankVehicles([v('a'), v('b')], [manual], new Set());
  assert.equal(out[0].score, out[1].score);
  assert.deepEqual(out[0].contributions, []);
});

test('no scoring criteria yields a flat score and preserves input order', () => {
  const out = rankVehicles([v('a'), v('b')], [], new Set());
  assert.deepEqual(out.map(r => r.vehicle.id), ['a', 'b']);
  assert.equal(out[0].score, 0);
});

test('identical values across the set do not divide by zero', () => {
  const out = rankVehicles([v('a'), v('b')], [fuzzy('max_cargo_cf', 'higher')], new Set());
  assert.ok(Number.isFinite(out[0].score));
  assert.equal(out[0].score, out[1].score);
});

test('excluded vehicles sort after included ones regardless of score', () => {
  const good = v('good', { max_cargo_cf: { value: 50 } });
  const bigButLong = v('long', { max_cargo_cf: { value: 100 }, exterior_in: { length: 210, width: 73, height: 67 } });
  const out = rankVehicles([good, bigButLong],
    [hard('length_in', '<', 195), fuzzy('max_cargo_cf', 'higher')], new Set());
  assert.deepEqual(out.map(r => r.vehicle.id), ['good', 'long']);
  assert.equal(out[1].excluded, true);
});

test('contributions explain the score', () => {
  const out = rankVehicles(
    [v('a', { max_cargo_cf: { value: 100 } }), v('b', { max_cargo_cf: { value: 50 } })],
    [fuzzy('max_cargo_cf', 'higher')], new Set());
  const c = out[0].contributions[0];
  assert.equal(c.id, 'f');
  assert.equal(c.normalized, 1);
  assert.equal(c.weighted, 3);
});

// --- Robustness against untrusted/malformed stored criteria -----------------
// The preferences endpoint validates only that `criteria` is an array; items
// are stored verbatim (parse.js owns the schema). A criterion loaded back
// from KV may be malformed or written by an older version. rankVehicles must
// degrade gracefully, never throw.

test('rankVehicles does not throw on a criterion missing rule entirely', () => {
  const bad = { id: 'x', label: 'bad', tier: 'nice-to-have', kind: 'hard', rank: 1, weight: 3 };
  assert.doesNotThrow(() => rankVehicles([v('a')], [bad], new Set()));
});

test('rankVehicles does not throw on a rule with no field', () => {
  const bad = { id: 'x', label: 'bad', tier: 'must-have', kind: 'hard', rank: 1, weight: 3, rule: { op: '<', value: 5 } };
  const out = rankVehicles([v('a')], [bad], new Set());
  assert.equal(out[0].excluded, false);
});

test('rankVehicles does not throw on an unknown field id', () => {
  const bad = hard('totally_unknown_field', '<', 5);
  const out = rankVehicles([v('a')], [bad], new Set());
  assert.deepEqual(out[0].unknowns.map(x => x.id), ['h']);
});

test('rankVehicles does not throw on an enum rule with a missing value array', () => {
  const bad = { id: 'x', label: 'bad', tier: 'must-have', kind: 'hard', rank: 1, weight: 3,
    rule: { field: 'drivetrain_bucket', op: 'in' } };
  assert.doesNotThrow(() => rankVehicles([v('a')], [bad], new Set()));
});

test('rankVehicles does not throw on a between rule with a malformed value', () => {
  const bad = hard('length_in', 'between', 190);
  assert.doesNotThrow(() => rankVehicles([v('a')], [bad], new Set()));
});

test('rankVehicles does not throw on a fuzzy criterion with a missing rule', () => {
  const bad = { id: 'x', label: 'bad', tier: 'nice-to-have', kind: 'fuzzy', rank: 1, weight: 3, rule: null };
  assert.doesNotThrow(() => rankVehicles([v('a'), v('b')], [bad], new Set()));
});

test('rankVehicles does not throw on a completely null entry in criteria', () => {
  assert.doesNotThrow(() => rankVehicles([v('a')], [null, undefined, hard('length_in', '<', 195)], new Set()));
});

// --- Survivor-relative normalization -----------------------------------
// Fuzzy fields are normalized against vehicles that survive the hard gates,
// not the whole input list. A vehicle a gate has already dropped must not
// stretch the range the survivors are judged against, or the best of what's
// left reads as mediocre because of vehicles nobody will see.

test('a single survivor is normalized to the top of the scale, not stretched by excluded vehicles', () => {
  const keep = v('keep', { exterior_in: { length: 190, width: 73, height: 67 }, max_cargo_cf: { value: 50 } });
  const drop = v('drop', { exterior_in: { length: 210, width: 73, height: 67 }, max_cargo_cf: { value: 200 } });
  const out = rankVehicles([keep, drop],
    [hard('length_in', '<', 195, 'must-have'), fuzzy('max_cargo_cf', 'higher')], new Set());
  const keptRow = out.find(r => r.vehicle.id === 'keep');
  assert.equal(keptRow.excluded, false);
  assert.equal(keptRow.score, 100);
});

test('zero survivors does not throw and yields no NaN scores', () => {
  const a = v('a', { exterior_in: { length: 210, width: 73, height: 67 } });
  const b = v('b', { exterior_in: { length: 220, width: 73, height: 67 } });
  const out = rankVehicles([a, b],
    [hard('length_in', '<', 195, 'must-have'), fuzzy('max_cargo_cf', 'higher')], new Set());
  assert.equal(out.length, 2);
  for (const row of out) {
    assert.equal(row.excluded, true);
    assert.ok(Number.isFinite(row.score), `score was ${row.score}`);
  }
});

test('a pinned gate-violating vehicle still stretches the normalization range', () => {
  const a = v('a', { max_cargo_cf: { value: 50 } });
  const b = v('b', { exterior_in: { length: 210, width: 73, height: 67 }, max_cargo_cf: { value: 150 } });
  const out = rankVehicles([a, b],
    [hard('length_in', '<', 195, 'must-have'), fuzzy('max_cargo_cf', 'higher')], new Set(['b']));
  const rowA = out.find(r => r.vehicle.id === 'a');
  const rowB = out.find(r => r.vehicle.id === 'b');
  assert.equal(rowB.pinned, true);
  assert.equal(rowB.excluded, false);
  // If b were dropped from the range instead of counted (it's visible, just
  // gate-violating), a would be the sole survivor and score 100.
  assert.equal(rowA.score, 0);
  assert.equal(rowB.score, 100);
});

test('with no hard gates every vehicle survives, so ranges are unchanged from whole-fleet', () => {
  const out = rankVehicles(
    [v('small', { max_cargo_cf: { value: 50 } }), v('big', { max_cargo_cf: { value: 100 } })],
    [fuzzy('max_cargo_cf', 'higher')], new Set());
  assert.deepEqual(out.map(r => r.vehicle.id), ['big', 'small']);
  assert.equal(out[0].score, 100);
  assert.equal(out[1].score, 0);
});

test('a deal-breaker excludes the vehicles its rule MATCHES', async () => {
  // The bug this pins: deal-breaker used to behave identically to must-have, so
  // "cargo length < 74" as a deal-breaker KEPT the short vehicles instead of
  // eliminating them. Real numbers from the dataset: the Prius measures 68.
  const short = { id: 'prius', cargo_length_behind_front_seats_in: { value: 68 } };
  const long  = { id: 'van',   cargo_length_behind_front_seats_in: { value: 90 } };
  const crit = [{
    id: 'c1', label: 'Nothing under 74in', tier: 'deal-breaker', kind: 'hard',
    rank: 1, weight: 5, rule: { field: 'cargo_length_in', op: '<', value: 74 },
  }];
  const out = rankVehicles([short, long], crit, new Set());
  const byId = Object.fromEntries(out.map(r => [r.vehicle.id, r]));
  assert.equal(byId.prius.excluded, true, '68in must be ruled out by "< 74 is a deal-breaker"');
  assert.equal(byId.van.excluded, false, '90in must survive');
});

test('the same rule as a must-have does the opposite', async () => {
  // Same rule, different tier: must-have keeps what matches. If these two ever
  // agree, the tiers have collapsed back into each other.
  const short = { id: 'prius', cargo_length_behind_front_seats_in: { value: 68 } };
  const long  = { id: 'van',   cargo_length_behind_front_seats_in: { value: 90 } };
  const crit = [{
    id: 'c1', label: 'Under 74in', tier: 'must-have', kind: 'hard',
    rank: 1, weight: 5, rule: { field: 'cargo_length_in', op: '<', value: 74 },
  }];
  const out = rankVehicles([short, long], crit, new Set());
  const byId = Object.fromEntries(out.map(r => [r.vehicle.id, r]));
  assert.equal(byId.prius.excluded, false);
  assert.equal(byId.van.excluded, true);
});

test('missing data never excludes, in either tier direction', async () => {
  // Inverting a gate must not turn "no data" into an exclusion. A vehicle we
  // lack a measurement for should surface for a human, not vanish -- and that
  // has to hold for deal-breakers too, where the naive inversion of 'unknown'
  // would be 'fail'.
  const unknown = { id: 'mystery' }; // no cargo_length at all
  for (const tier of ['must-have', 'deal-breaker']) {
    const crit = [{
      id: 'c1', label: 'x', tier, kind: 'hard', rank: 1, weight: 5,
      rule: { field: 'cargo_length_in', op: '<', value: 74 },
    }];
    const [r] = rankVehicles([unknown], crit, new Set());
    assert.equal(r.excluded, false, `${tier}: unknown data must not exclude`);
    assert.equal(r.unknowns.length, 1, `${tier}: should be flagged as no-data`);
  }
});
