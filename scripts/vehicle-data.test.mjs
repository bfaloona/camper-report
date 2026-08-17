import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The trait picker gates on the researched fields below. A record that lacks
// one doesn't error — the field getter returns null and the vehicle silently
// reads as "no data" for that trait forever. This guard makes the omission a
// test failure instead, so vehicle 26 can't ship half-researched. Null VALUES
// are allowed (honestly-unanswerable is a legitimate research outcome, per the
// sitting-height precedent); missing KEYS are not.

const data = JSON.parse(await readFile(new URL('../vehicles.json', import.meta.url), 'utf8'));

const RESEARCHED = {
  ground_clearance_in: v => v === null || (typeof v === 'number' && v > 0 && v < 15),
  spare_tire: v => v === null || ['full-size', 'compact', 'none'].includes(v),
  onboard_ac_power: v => v === null || ['none', 'low_watt', 'high_watt'].includes(v),
  still_in_production: v => v === null || typeof v === 'boolean',
  dc_fast_charging: v => v === null || typeof v === 'boolean',
};

test('every vehicle record carries every researched trait field', () => {
  for (const vehicle of data.vehicles) {
    for (const [key, valid] of Object.entries(RESEARCHED)) {
      assert.ok(key in vehicle, `${vehicle.id}: missing ${key}`);
      const field = vehicle[key];
      assert.ok(field && typeof field === 'object', `${vehicle.id}.${key}: not an object`);
      assert.ok('value' in field, `${vehicle.id}.${key}: no value key`);
      assert.ok(valid(field.value), `${vehicle.id}.${key}: bad value ${JSON.stringify(field.value)}`);
      // A non-null value must be defensible from a URL (house rule); a null
      // value documents why in a note instead.
      if (field.value !== null && !(key === 'dc_fast_charging' && field.value === false)) {
        assert.equal(typeof field.source, 'string', `${vehicle.id}.${key}: non-null value needs a source`);
        assert.match(field.source, /^https?:\/\//, `${vehicle.id}.${key}: source is not a URL`);
      }
    }
    // The Q2 divergence must be stated on the record, not just in docs: this
    // field's basis differs from equipment's, and a cold reader needs to see it.
    assert.match(vehicle.onboard_ac_power.basis ?? '', /generation/i,
      `${vehicle.id}.onboard_ac_power: missing the availability-basis statement`);
  }
});

test('dc_fast_charging is false for every non-plug-in', () => {
  for (const vehicle of data.vehicles) {
    if (vehicle.powertrain === 'gas' || vehicle.powertrain === 'hybrid') {
      assert.equal(vehicle.dc_fast_charging?.value, false,
        `${vehicle.id}: a ${vehicle.powertrain} vehicle cannot DC fast charge`);
    }
  }
});
