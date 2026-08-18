import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRAITS, GROUPS, compileTraits, sanitizeTraits, traitRule } from './traits.js';
import { FIELDS, rankVehicles, evaluateGate } from './scoring.js';

// The trait-picker analogue of the FIELD_IDS ⊆ FIELDS test: a trait naming a
// field the scorer can't read, or a value the field can never produce, would
// silently never filter — no error, just a toggle that does nothing.
test('every trait references an enum field the scorer can read', async () => {
  const { FIELD_IDS } = await import('../functions/api/parse.js');
  for (const t of TRAITS) {
    assert.ok(FIELDS[t.field], `${t.id}: field ${t.field} missing from FIELDS`);
    assert.equal(FIELDS[t.field].type, 'enum', `${t.id}: field ${t.field} is not an enum`);
    assert.ok(FIELD_IDS.includes(t.field), `${t.id}: field ${t.field} missing from parse.js FIELD_IDS`);
  }
});

test('every trait yes-value is one the parser vocabulary allows', async () => {
  const { FIELD_IDS } = await import('../functions/api/parse.js');
  assert.ok(FIELD_IDS.length > 0);
  // ENUM_FIELDS isn't exported; validateCriteria is the gate that embodies it.
  // A compiled criterion must round-trip parse.js's own validator unchanged —
  // if validRule rejects it, the picker emits rules the rest of the system
  // considers malformed.
  const { validateCriteria } = await import('../functions/api/parse.js');
  const all = Object.fromEntries(TRAITS.map(t => [t.id, 'yes']));
  const compiled = compileTraits(all);
  assert.equal(compiled.length, TRAITS.length);
  const validated = validateCriteria(compiled);
  assert.equal(validated.length, compiled.length,
    'parse.js validRule rejected a compiled trait criterion');
});

test('trait ids are unique', () => {
  const ids = TRAITS.map(t => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('yes compiles to a must-have in-rule, no to a deal-breaker', () => {
  const [yes] = compileTraits({ awd: 'yes' });
  assert.deepEqual(yes.rule, { field: 'drivetrain_bucket', op: 'in', value: ['awd'] });
  assert.equal(yes.tier, 'must-have');
  assert.equal(yes.kind, 'hard');
  assert.equal(yes.id, 'trait_awd');
  const [no] = compileTraits({ awd: 'no' });
  assert.equal(no.tier, 'deal-breaker');
  assert.deepEqual(no.rule, yes.rule);
});

test('ignore (absent or unknown value) compiles to nothing', () => {
  assert.deepEqual(compileTraits({}), []);
  assert.deepEqual(compileTraits({ awd: 'maybe' }), []);
  assert.deepEqual(compileTraits(null), []);
});

test('a no on a yes-only row is dropped, not compiled', () => {
  assert.deepEqual(compileTraits({ flat_sleep_floor: 'no' }), []);
  assert.equal(compileTraits({ flat_sleep_floor: 'yes' }).length, 1);
});

test('sanitizeTraits drops garbage and keeps valid picks', () => {
  assert.deepEqual(sanitizeTraits(null), {});
  assert.deepEqual(sanitizeTraits([]), {});
  assert.deepEqual(sanitizeTraits('yes'), {});
  assert.deepEqual(sanitizeTraits({ not_a_trait: 'yes' }), {});
  assert.deepEqual(sanitizeTraits({ awd: 'YES' }), {});
  assert.deepEqual(
    sanitizeTraits({ awd: 'no', sleeps_six_feet: 'yes', tow_any: 'no', junk: 1 }),
    { awd: 'no', sleeps_six_feet: 'yes' }); // tow_any is yes_only → its 'no' drops
});

test('compiled criteria mutate nothing they are handed', () => {
  const picks = { awd: 'yes' };
  const [c] = compileTraits(picks);
  c.rule.value.push('2wd');
  const [again] = compileTraits(picks);
  assert.deepEqual(again.rule.value, ['awd'], 'yes_values leaked by reference');
});

// End to end through the real scorer: a YES gate excludes a failing vehicle,
// and a vehicle with no data for the field stays (null never excludes).
test('compiled traits gate through rankVehicles', () => {
  const awdCar = { id: 'awd-car', drivetrain: 'AWD' };
  const fwdCar = { id: 'fwd-car', drivetrain: 'FWD' };
  const mystery = { id: 'mystery' }; // no drivetrain at all
  const rows = rankVehicles([awdCar, fwdCar, mystery], compileTraits({ awd: 'yes' }), new Set());
  const byId = Object.fromEntries(rows.map(r => [r.vehicle.id, r]));
  assert.equal(byId['awd-car'].excluded, false);
  assert.equal(byId['fwd-car'].excluded, true);
  assert.deepEqual(byId['fwd-car'].violations.map(x => x.id), ['trait_awd']);
  assert.equal(byId.mystery.excluded, false);
  assert.deepEqual(byId.mystery.unknowns.map(x => x.id), ['trait_awd']);
});

test('a NO trait excludes the vehicles that match it', () => {
  const awdCar = { id: 'awd-car', drivetrain: 'AWD' };
  const fwdCar = { id: 'fwd-car', drivetrain: 'FWD' };
  const rows = rankVehicles([awdCar, fwdCar], compileTraits({ awd: 'no' }), new Set());
  const byId = Object.fromEntries(rows.map(r => [r.vehicle.id, r]));
  assert.equal(byId['awd-car'].excluded, true);
  assert.equal(byId['fwd-car'].excluded, false);
});

// The panel renders one section per GROUPS entry and pulls its rows by name, so
// a trait whose group is absent or misspelled disappears from the UI entirely
// with nothing thrown.
test('every trait group has a panel section', () => {
  const named = new Set(GROUPS.map(g => g.name));
  for (const t of TRAITS) {
    assert.ok(named.has(t.group), `${t.id}: group "${t.group}" is not in GROUPS`);
  }
  for (const g of GROUPS) {
    assert.ok(TRAITS.some(t => t.group === g.name), `GROUPS has an empty section: ${g.name}`);
  }
});

// The evidence badges evaluate traitRule through evaluateGate; the compiled
// gate uses the same rule. If those ever diverge, a green tick would sit beside
// a vehicle the same selection filters out.
test('the badge rule and the compiled gate rule agree', () => {
  const awdCar = { id: 'awd-car', drivetrain: 'AWD' };
  const t = TRAITS.find(x => x.field === 'drivetrain_bucket');
  const [compiled] = compileTraits({ [t.id]: 'yes' });
  assert.deepEqual(traitRule(t), compiled.rule);
  assert.equal(evaluateGate(awdCar, { rule: traitRule(t) }), 'pass');
  assert.equal(evaluateGate({ id: 'x' }, { rule: traitRule(t) }), 'unknown');
});
