import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, fieldValue, fieldNA, evaluateGate, rankVehicles } from './scoring.js';

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

// --- Derived camper-trait formulas ------------------------------------------
// Pure formulas over other fields; thresholds reviewed 2026-08-17 (see
// docs/trait-picker-classification.md Group B). Null input must yield null,
// which gates as 'unknown' — never a pass or a fail.

test('overnight_climate maps powertrain to climate cost', () => {
  assert.equal(fieldValue(v('a', { powertrain: 'phev' }), 'overnight_climate'), 'engine-off');
  assert.equal(fieldValue(v('a', { powertrain: 'ev' }), 'overnight_climate'), 'engine-off');
  assert.equal(fieldValue(v('a', { powertrain: 'hybrid' }), 'overnight_climate'), 'engine-cycling');
  assert.equal(fieldValue(v('a', { powertrain: 'gas' }), 'overnight_climate'), 'idle-only');
  assert.equal(fieldValue(v('a', { powertrain: undefined }), 'overnight_climate'), null);
});

test('sliding_doors and stealth_profile derive from class', () => {
  assert.equal(fieldValue(v('a', { class: 'Minivan' }), 'sliding_doors'), 'yes');
  assert.equal(fieldValue(v('a', { class: 'Compact van' }), 'sliding_doors'), 'yes');
  assert.equal(fieldValue(v('a', { class: 'SUV' }), 'sliding_doors'), 'no');
  assert.equal(fieldValue(v('a', { class: 'Sedan' }), 'sliding_doors'), null);
  assert.equal(fieldValue(v('a', { class: 'Hatchback' }), 'stealth_profile'), 'high');
  assert.equal(fieldValue(v('a', { class: 'Compact minivan' }), 'stealth_profile'), 'high');
  assert.equal(fieldValue(v('a', { class: 'Wagon' }), 'stealth_profile'), 'medium');
  assert.equal(fieldValue(v('a', { class: undefined }), 'stealth_profile'), null);
});

test('camper_popularity_tier passes the rating through and rejects junk', () => {
  assert.equal(fieldValue(v('a', { camper_popularity: { rating: 'High' } }), 'camper_popularity_tier'), 'High');
  assert.equal(fieldValue(v('a', { camper_popularity: { rating: 'whatever' } }), 'camper_popularity_tier'), null);
  assert.equal(fieldValue(v('a', { camper_popularity: null }), 'camper_popularity_tier'), null);
});

test('sleeps_six_feet buckets cargo length at 75 and 70 inches', () => {
  const at = len => fieldValue(v('a', { cargo_length_behind_front_seats_in: { value: len } }), 'sleeps_six_feet');
  assert.equal(at(75), 'yes');
  assert.equal(at(74.9), 'tight');
  assert.equal(at(70), 'tight');
  assert.equal(at(69.9), 'no');
  assert.equal(fieldValue(v('a', { cargo_length_behind_front_seats_in: { value: null } }), 'sleeps_six_feet'), null);
  assert.equal(fieldValue(v('a', { cargo_length_behind_front_seats_in: null }), 'sleeps_six_feet'), null);
});

test('tow_class buckets at 0, 2000 and 3500 lbs, and 0 is none, not null', () => {
  const at = max => fieldValue(v('a', { tow_rating: { max } }), 'tow_class');
  assert.equal(at(0), 'none');
  assert.equal(at(1), 'light');
  assert.equal(at(1999), 'light');
  assert.equal(at(2000), 'moderate');
  assert.equal(at(3499), 'moderate');
  assert.equal(at(3500), 'substantial');
  assert.equal(fieldValue(v('a', { tow_rating: null }), 'tow_class'), null);
});

test('clearance_class buckets at 8.5 and 7.0 in, and is null pre-research', () => {
  const at = value => fieldValue(v('a', { ground_clearance_in: { value } }), 'clearance_class');
  assert.equal(at(8.5), 'high');
  assert.equal(at(8.4), 'moderate');
  assert.equal(at(7), 'moderate');
  assert.equal(at(6.9), 'low');
  // The fixture has no ground_clearance_in at all — the pre-Step-6 state of
  // every record. Must read as unknown, not throw and not fail a gate.
  assert.equal(fieldValue(v('a'), 'clearance_class'), null);
  assert.equal(evaluateGate(v('a'), hard('clearance_class', 'in', ['high'])), 'unknown');
});

test('researched fact getters validate their value and read missing as null', () => {
  assert.equal(fieldValue(v('a', { spare_tire: { value: 'full-size', source: 'x' } }), 'spare_tire'), 'full-size');
  assert.equal(fieldValue(v('a', { spare_tire: { value: 'donut' } }), 'spare_tire'), null);
  assert.equal(fieldValue(v('a'), 'spare_tire'), null);
  assert.equal(fieldValue(v('a', { onboard_ac_power: { value: 'high_watt' } }), 'onboard_ac_power'), 'high_watt');
  assert.equal(fieldValue(v('a', { onboard_ac_power: { value: 1500 } }), 'onboard_ac_power'), null);
  assert.equal(fieldValue(v('a', { still_in_production: { value: true } }), 'still_in_production'), 'yes');
  assert.equal(fieldValue(v('a', { still_in_production: { value: false } }), 'still_in_production'), 'no');
  assert.equal(fieldValue(v('a', { still_in_production: { value: null } }), 'still_in_production'), null);
  assert.equal(fieldValue(v('a', { dc_fast_charging: { value: false } }), 'dc_fast_charging'), 'no');
  assert.equal(fieldValue(v('a'), 'dc_fast_charging'), null);
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
  // Mid-scale, not 0: with nothing to score against, no vehicle is worst.
  assert.equal(out[0].score, 50);
  assert.equal(out[1].score, 50);
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

// --- Unknowns are exempt, not worst-case --------------------------------
// A scoring criterion with no data for a vehicle drops out of that vehicle's
// denominator (and dislike offset): the vehicle is scored on the criteria it
// has data for. Documented absences (fieldNA) are the exception — they score
// worst-case and are NOT exempt.

test('an unknown no longer drags a score down', () => {
  const known   = v('known',   { max_cargo_cf: { value: 100 }, sitting_height_over_folded_seats_in: { value: 40 } });
  const unknown = v('unknown', { max_cargo_cf: { value: 100 } }); // no sitting height measured
  const out = rankVehicles([known, unknown],
    [{ ...fuzzy('max_cargo_cf', 'higher'), id: 'c1' },
     { ...fuzzy('sitting_height_in', 'higher'), id: 'c2' }], new Set());
  const byId = Object.fromEntries(out.map(r => [r.vehicle.id, r]));
  // Both max out every criterion they have data for. Before this change the
  // unknown vehicle scored 50: the missing criterion stayed in its denominator.
  assert.equal(byId.known.score, 100);
  assert.equal(byId.unknown.score, 100);
  assert.deepEqual(byId.known.exempt, []);
  assert.deepEqual(byId.unknown.exempt.map(x => x.id), ['c2']);
});

test('two vehicles differing only in whether a criterion is known rank as expected', () => {
  // Same reliability everywhere; cargo is worst / best / unmeasured. The
  // unmeasured vehicle must not sort below the measured-worst one on data it
  // lacks.
  const worst = v('worst', { max_cargo_cf: { value: 50 } });
  const best  = v('best',  { max_cargo_cf: { value: 100 } });
  const nodata = v('nodata', { max_cargo_cf: null });
  const out = rankVehicles([worst, best, nodata],
    [{ ...fuzzy('max_cargo_cf', 'higher'), id: 'c1' },
     { ...fuzzy('reliability_score', 'higher'), id: 'c2' }], new Set());
  const byId = Object.fromEntries(out.map(r => [r.vehicle.id, r]));
  assert.equal(byId.best.score, 100);
  assert.equal(byId.nodata.score, 100); // scored on reliability alone, which it maxes
  assert.equal(byId.worst.score, 50);
  assert.deepEqual(byId.nodata.exempt.map(x => x.id), ['c1']);
});

test('a dislike criterion with an unknown behaves symmetrically', () => {
  // The vehicle missing the length measurement lands mid-pack on cargo. Its
  // score must be identical whether the unevaluable criterion is a like or a
  // dislike. Before this change: 25 under a like, 75 under a dislike — the
  // dislike offset stayed in even when the contribution was exempt.
  const cars = () => [
    v('lo',  { max_cargo_cf: { value: 50 } }),
    v('hi',  { max_cargo_cf: { value: 150 } }),
    v('mid', { max_cargo_cf: { value: 100 }, exterior_in: null }),
  ];
  const run = tier => {
    const out = rankVehicles(cars(),
      [{ ...fuzzy('length_in', 'higher', tier), id: 'c1' },
       { ...fuzzy('max_cargo_cf', 'higher'), id: 'c2' }], new Set());
    return out.find(r => r.vehicle.id === 'mid');
  };
  const asLike = run('nice-to-have');
  const asDislike = run('dislike');
  assert.equal(asLike.score, 50);
  assert.equal(asDislike.score, 50);
  assert.deepEqual(asLike.exempt.map(x => x.id), ['c1']);
  assert.deepEqual(asDislike.exempt.map(x => x.id), ['c1']);
});

test('a vehicle with no evaluable scoring criteria at all floats to mid-list', () => {
  const known = v('known', { sitting_height_over_folded_seats_in: { value: 40 } });
  const mystery = v('mystery');
  const out = rankVehicles([known, mystery], [fuzzy('sitting_height_in', 'higher')], new Set());
  const byId = Object.fromEntries(out.map(r => [r.vehicle.id, r]));
  // 50, not 0 — being unmeasured must not read as being bad.
  assert.equal(byId.mystery.score, 50);
  assert.deepEqual(byId.mystery.contributions, []);
  assert.equal(byId.mystery.exempt.length, 1);
  assert.deepEqual(out.map(r => r.vehicle.id), ['known', 'mystery']);
});

test('an unmeasured vehicle sorts above one that scored badly, below one that scored well', () => {
  const good = v('good', { sitting_height_over_folded_seats_in: { value: 44 } });
  const bad  = v('bad',  { sitting_height_over_folded_seats_in: { value: 30 } });
  const none = v('none');
  const out = rankVehicles([good, bad, none], [fuzzy('sitting_height_in', 'higher')], new Set());
  assert.deepEqual(out.map(r => r.vehicle.id), ['good', 'none', 'bad']);
});

// --- n/a: documented absences score from their own value, not exempt -----

test('fieldNA returns the documented value and null for everything else', () => {
  assert.equal(fieldNA(v('g', { powertrain: 'gas' }), 'ev_range_mi'), 0);
  assert.equal(fieldNA(v('h', { powertrain: 'hybrid' }), 'ev_range_mi'), 0);
  assert.equal(fieldNA(v('p', { powertrain: 'phev' }), 'ev_range_mi'), null);
  assert.equal(fieldNA(v('x', { powertrain: undefined }), 'ev_range_mi'), null);
  assert.equal(fieldNA(v('e', { powertrain: 'ev' }), 'mpg_city'), Infinity);
  assert.equal(fieldNA(v('e', { powertrain: 'ev' }), 'mpg_hwy'), Infinity);
  assert.equal(fieldNA(v('g'), 'mpg_city'), null);
  assert.equal(fieldNA(v('g'), 'max_cargo_cf'), null);
});

test('a gas car on an EV-range criterion scores worst-case with no exemption', () => {
  const gas = v('gas');
  const phev = v('phev', { powertrain: 'phev', mpg: { city: 25, hwy: 30, ev_range_mi: 40 } });
  const out = rankVehicles([gas, phev], [fuzzy('ev_range_mi', 'higher')], new Set());
  const byId = Object.fromEntries(out.map(r => [r.vehicle.id, r]));
  assert.equal(byId.phev.score, 100);
  assert.equal(byId.gas.score, 0);           // worst case, not exempt
  assert.deepEqual(byId.gas.exempt, []);      // so no asterisk
  assert.equal(byId.gas.contributions[0].na, true);
  assert.equal(byId.gas.contributions[0].weighted, 0);
});

test('an EV tops an MPG criterion: no gasoline, so no figure can beat it', () => {
  const gas = v('gas');
  const ev = v('ev', { powertrain: 'ev', mpg: { city: 131, hwy: 109, ev_range_mi: 259 } });
  const out = rankVehicles([gas, ev], [fuzzy('mpg_city', 'higher')], new Set());
  const byId = Object.fromEntries(out.map(r => [r.vehicle.id, r]));
  assert.equal(byId.ev.score, 100);
  assert.deepEqual(byId.ev.exempt, []);       // documented fact, so no asterisk
  assert.equal(byId.ev.contributions[0].na, true);
});

test('the EV\'s infinite MPG does not stretch the scale for everyone else', () => {
  // Two gas cars 20 mpg apart must still read 100 and 0 against each other
  // with an EV in the list — an actual Infinity in the range would collapse
  // both to the bottom.
  const thirsty = v('thirsty', { mpg: { city: 20, hwy: 25 } });
  const frugal  = v('frugal',  { mpg: { city: 40, hwy: 45 } });
  const ev = v('ev', { powertrain: 'ev', mpg: { city: 131, hwy: 109, ev_range_mi: 259 } });
  const out = rankVehicles([thirsty, frugal, ev], [fuzzy('mpg_city', 'higher')], new Set());
  const byId = Object.fromEntries(out.map(r => [r.vehicle.id, r]));
  assert.equal(byId.frugal.score, 100);
  assert.equal(byId.thirsty.score, 0);
  assert.equal(byId.ev.score, 100);
});

test('direction is respected: preferring LOWER mpg puts the EV last', () => {
  // Nobody wants this, but it proves n/a is a value on the scale rather than
  // a hardcoded "best" — flip the preference and infinity becomes the worst.
  const thirsty = v('thirsty', { mpg: { city: 20, hwy: 25 } });
  const frugal  = v('frugal',  { mpg: { city: 40, hwy: 45 } });
  const ev = v('ev', { powertrain: 'ev', mpg: { city: 131, hwy: 109, ev_range_mi: 259 } });
  const out = rankVehicles([thirsty, frugal, ev], [fuzzy('mpg_city', 'lower')], new Set());
  const byId = Object.fromEntries(out.map(r => [r.vehicle.id, r]));
  assert.equal(byId.thirsty.score, 100);
  assert.equal(byId.ev.score, 0);
});

test('a hard MPG nice-to-have is satisfied by a car that burns no fuel', () => {
  const ev = v('ev', { powertrain: 'ev', mpg: { city: 131, hwy: 109, ev_range_mi: 259 } });
  const out = rankVehicles([ev], [hard('mpg_city', '>=', 40, 'nice-to-have')], new Set());
  assert.equal(out[0].contributions[0].normalized, 1);
  assert.equal(out[0].contributions[0].na, true);
  assert.deepEqual(out[0].exempt, []);
});

test('an unknown powertrain on an EV-range criterion is exempt, not n/a', () => {
  // Without the powertrain fact we cannot say the range is absent rather
  // than unmeasured, so it must not be scored as a zero.
  const who = v('who', { powertrain: undefined });
  const phev = v('phev', { powertrain: 'phev', mpg: { city: 25, hwy: 30, ev_range_mi: 40 } });
  const out = rankVehicles([who, phev], [fuzzy('ev_range_mi', 'higher')], new Set());
  const byId = Object.fromEntries(out.map(r => [r.vehicle.id, r]));
  assert.deepEqual(byId.who.exempt.map(x => x.id), ['f']);
});

test('gates are unchanged: an EV-range must-have never excludes a gas car', () => {
  const gas = v('gas');
  assert.equal(evaluateGate(gas, hard('ev_range_mi', '>=', 100)), 'unknown');
  const out = rankVehicles([gas], [hard('ev_range_mi', '>=', 100)], new Set());
  assert.equal(out[0].excluded, false);
  assert.deepEqual(out[0].unknowns.map(x => x.id), ['h']);
});

test('a hard nice-to-have with no data is exempt; with n/a data it scores 0', () => {
  const gas = v('gas');                       // ev_range: n/a for a gas car
  const nosit = v('nosit');                   // sitting height: unmeasured
  const evRange = { ...hard('ev_range_mi', '>=', 100, 'nice-to-have'), id: 'r' };
  const sit = { ...hard('sitting_height_in', '>=', 35, 'nice-to-have'), id: 's' };
  const out = rankVehicles([gas, nosit], [evRange, sit], new Set());
  const g = out.find(r => r.vehicle.id === 'gas');
  assert.deepEqual(g.exempt.map(x => x.id), ['s']);     // no measurement → exempt
  const naContrib = g.contributions.find(c => c.id === 'r');
  assert.equal(naContrib.na, true);                     // documented absence → 0
  assert.equal(naContrib.normalized, 0);
});

test('a malformed scoring criterion is exempt for every vehicle, never throws', () => {
  const bad = { id: 'x', label: 'bad', tier: 'nice-to-have', kind: 'hard', rank: 1, weight: 3,
    rule: { field: 'totally_unknown_field', op: '<', value: 5 } };
  const out = rankVehicles([v('a'), v('b')], [bad, fuzzy('max_cargo_cf', 'higher')], new Set());
  for (const r of out) {
    assert.deepEqual(r.exempt.map(x => x.id), ['x']);
    assert.ok(Number.isFinite(r.score));
  }
});

// clearance_in is the numeric twin of clearance_class, matching cargo_length_in
// beside sleeps_six_feet and tow_max beside tow_class: "at least 8 inches" has
// to be expressible, not just "handles forest-service roads".
test('clearance_in exposes the measurement the class buckets', () => {
  assert.equal(fieldValue({ ground_clearance_in: { value: 8.7 } }, 'clearance_in'), 8.7);
  assert.equal(fieldValue({ ground_clearance_in: { value: 8.7 } }, 'clearance_class'), 'high');
  // No measurement stays unknown in both views — unknown never excludes.
  assert.equal(fieldValue({}, 'clearance_in'), null);
  assert.equal(fieldValue({ ground_clearance_in: { value: null } }, 'clearance_in'), null);
});
