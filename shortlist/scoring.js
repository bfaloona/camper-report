// Pure scoring for the Shortlist tool. No DOM, no fetch — everything here is a
// function of (vehicles, criteria, pins), which is what makes it testable.

const POP_ORDER = { Low: 1, Medium: 2, High: 3 };
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);

// Equipment facts are booleans in the data but enums here, so they reuse the
// existing enum path end to end: `in ['yes']` gates in a must-have tier and
// scores pass/fail in a nice-to-have one, with no new field type and no change
// to evaluateGate. `null` stays null so an unresearched fact reads as "no data"
// rather than as a "no" — the difference matters when the answer is unknown
// rather than absent.
const yesNo = b => (b === true ? 'yes' : b === false ? 'no' : null);

export const FIELDS = {
  length_in:            { label: 'Length (in)',         type: 'number', get: v => num(v.exterior_in?.length) },
  width_in:             { label: 'Width (in)',          type: 'number', get: v => num(v.exterior_in?.width) },
  height_in:            { label: 'Height (in)',         type: 'number', get: v => num(v.exterior_in?.height) },
  cargo_length_in:      { label: 'Cargo length (in)',   type: 'number', get: v => num(v.cargo_length_behind_front_seats_in?.value) },
  max_cargo_cf:         { label: 'Max cargo (cu ft)',   type: 'number', get: v => num(v.max_cargo_cf?.value) },
  // EPA MPGe on a battery-electric vehicle is an energy-equivalence figure,
  // not a fuel-burn figure — the Bolt EV shows 131 city / 109 hwy MPGe.
  // Reading those as MPG would rank it first on efficiency against every gas
  // vehicle in the set, which is nonsense. Treat mpg.city/mpg.hwy as unknown
  // for EVs so an MPG criterion neither excludes nor falsely favors them.
  mpg_city:             { label: 'MPG city',            type: 'number', get: v => (v.powertrain === 'ev' ? null : num(v.mpg?.city)) },
  mpg_hwy:               { label: 'MPG highway',         type: 'number', get: v => (v.powertrain === 'ev' ? null : num(v.mpg?.hwy)) },
  ev_range_mi:          { label: 'EV range (mi)',       type: 'number', get: v => num(v.mpg?.ev_range_mi) },
  price_low:            { label: 'KBB low ($)',         type: 'number', get: v => num(v.kbb_value_usd?.low) },
  price_high:           { label: 'KBB high ($)',        type: 'number', get: v => num(v.kbb_value_usd?.high) },
  tow_max:              { label: 'Tow rating (lbs)',    type: 'number', get: v => num(v.tow_rating?.max) },
  reliability_score:    { label: 'Reliability (/5)',    type: 'number', get: v => num(v.reliability?.score) },
  safety_feature_count: { label: 'Safety features',     type: 'number', get: v => (Array.isArray(v.safety?.features) ? v.safety.features.length : null) },
  conversion_kit_count: { label: 'Conversion kits',     type: 'number', get: v => (Array.isArray(v.conversion_products) ? v.conversion_products.length : null) },
  camper_popularity:    { label: 'Camper popularity',   type: 'number', get: v => POP_ORDER[v.camper_popularity?.rating] ?? null },
  listed_year:          { label: 'Model year',          type: 'number', get: v => num(v.listed_year) },
  vehicle_class:        { label: 'Class',               type: 'enum',   get: v => v.class ?? null },
  powertrain:           { label: 'Powertrain',          type: 'enum',   get: v => v.powertrain ?? null },
  drivetrain_bucket:    { label: 'Drivetrain',          type: 'enum',   get: v => (v.drivetrain === 'AWD' || v.drivetrain === '4WD' ? 'awd' : v.drivetrain ? '2wd' : null) },

  // Equipment, as standard on the record's listed trim. Optional or
  // dealer-installed reads as 'no' — see `equipment.basis` on each record.
  heated_front_seats:   { label: 'Heated front seats',  type: 'enum',   get: v => yesNo(v.equipment?.heated_front_seats) },
  heated_steering_wheel:{ label: 'Heated steering wheel', type: 'enum', get: v => yesNo(v.equipment?.heated_steering_wheel) },
  ventilated_front_seats:{ label: 'Ventilated front seats', type: 'enum', get: v => yesNo(v.equipment?.ventilated_front_seats) },
  dual_zone_climate:    { label: 'Dual-zone climate',   type: 'enum',   get: v => yesNo(v.equipment?.dual_zone_climate) },
  remote_start:         { label: 'Remote start',        type: 'enum',   get: v => yesNo(v.equipment?.remote_start) },
  sunroof:              { label: 'Sunroof',             type: 'enum',   get: v => yesNo(v.equipment?.sunroof) },
  roof_rails:           { label: 'Roof rails',          type: 'enum',   get: v => yesNo(v.equipment?.roof_rails) },
  power_liftgate:       { label: 'Power liftgate',      type: 'enum',   get: v => yesNo(v.equipment?.power_liftgate) },
  cargo_power_outlet:   { label: 'Cargo power outlet',  type: 'enum',   get: v => yesNo(v.equipment?.cargo_area_power_outlet) },
  fold_flat_passenger:  { label: 'Fold-flat front passenger seat', type: 'enum', get: v => yesNo(v.equipment?.fold_flat_front_passenger_seat) },
  rear_seat_fold:       { label: 'Rear seat fold',      type: 'enum',   get: v => v.equipment?.rear_seat_fold ?? null },

  // Height above the sleeping surface — whether you can sit up in bed. A
  // community measurement, not a manufacturer spec, and deliberately NOT
  // derived from published rear headroom, which is taken at the upright
  // seating position and means something else entirely.
  sitting_height_in:    { label: 'Sitting height (in)', type: 'number', get: v => num(v.sitting_height_over_folded_seats_in?.value) },

  // --- Derived camper traits -------------------------------------------------
  // Each is a pure formula over other fields, written down here so a reader can
  // argue with it rather than hand-rated per vehicle (Approach A in
  // docs/trait-picker-classification.md, which also records the reviewed
  // thresholds). Formulas return null on missing input — null gates as
  // 'unknown' and never excludes, in either direction.

  // What running heat/AC overnight costs you: PHEV/EV climate runs off the
  // battery with the engine off; a hybrid auto-cycles its engine; a gas
  // vehicle idles all night.
  overnight_climate: { label: 'Overnight climate', type: 'enum', get: v => (
    v.powertrain === 'phev' || v.powertrain === 'ev' ? 'engine-off'
    : v.powertrain === 'hybrid' ? 'engine-cycling'
    : v.powertrain === 'gas' ? 'idle-only' : null) },

  // Every van/minivan class in this dataset has sliding doors; no SUV, wagon
  // or hatchback does. Class-derived rather than researched per vehicle.
  sliding_doors: { label: 'Sliding doors', type: 'enum', get: v => (
    ['Minivan', 'Compact minivan', 'Compact van'].includes(v.class) ? 'yes'
    : ['SUV', 'Wagon', 'Hatchback'].includes(v.class) ? 'no' : null) },

  // Judgment trait, class-only by design (glass area is not a field): vans and
  // commuter hatchbacks read as anonymous with no gear on view ('high');
  // SUVs/wagons blend in but show gear through the glass ('medium'). The
  // bullets genuinely conflict here (Highlander claims stealth, RAV4 denies
  // it) — this formula takes a side; argue with it in the classification doc.
  stealth_profile: { label: 'Urban stealth', type: 'enum', get: v => (
    ['Minivan', 'Compact minivan', 'Compact van', 'Hatchback'].includes(v.class) ? 'high'
    : ['SUV', 'Wagon'].includes(v.class) ? 'medium' : null) },

  // camper_popularity.rating verbatim, as an enum the picker can gate on.
  // Deliberately NOT conversion_products.length bucketed: that counts how many
  // products the research pass listed, not market depth (the Forester Hybrid's
  // two entries include a spare-tire kit; the 4Runner's "biggest aftermarket"
  // has three rows). The rating's `evidence` field is what answers this.
  camper_popularity_tier: { label: 'Camper aftermarket', type: 'enum', get: v => (
    ['High', 'Medium', 'Low'].includes(v.camper_popularity?.rating) ? v.camper_popularity.rating : null) },

  // 72-in body plus bedding margin: >=75 sleeps a six-footer straight,
  // 70-74.9 is tight, under 70 means diagonal or seats-forward compromises.
  sleeps_six_feet: { label: 'Sleeps a 6-footer', type: 'enum', get: v => {
    const len = num(v.cargo_length_behind_front_seats_in?.value);
    return len === null ? null : len >= 75 ? 'yes' : len >= 70 ? 'tight' : 'no';
  } },

  // 0 is "not rated for US towing" per the tow_rating convention, a different
  // fact from a missing rating (null).
  tow_class: { label: 'Towing class', type: 'enum', get: v => {
    const t = num(v.tow_rating?.max);
    return t === null ? null : t === 0 ? 'none' : t < 2000 ? 'light' : t < 3500 ? 'moderate' : 'substantial';
  } },

  // Reads the researched ground_clearance_in field; null (unknown, never
  // excludes) until that data lands on a record.
  clearance_class: { label: 'Ground clearance class', type: 'enum', get: v => {
    const g = num(v.ground_clearance_in?.value);
    return g === null ? null : g >= 8.5 ? 'high' : g >= 7 ? 'moderate' : 'low';
  } },

  // --- Researched camper facts (new record fields, value + source) -----------
  // Unlike `equipment`, onboard_ac_power's basis is "available on this
  // generation from the factory, any trim or option" — a deliberate,
  // documented divergence (decision Q2, 2026-08-17): the listed-trim rule
  // would erase the Sienna's optional 1500W inverter, exactly the fact a
  // camper shopper cares about. Each record's `basis` restates this.
  spare_tire: { label: 'Spare tire', type: 'enum', get: v => (
    ['full-size', 'compact', 'none'].includes(v.spare_tire?.value) ? v.spare_tire.value : null) },
  onboard_ac_power: { label: '120V AC power', type: 'enum', get: v => (
    ['none', 'low_watt', 'high_watt'].includes(v.onboard_ac_power?.value) ? v.onboard_ac_power.value : null) },
  still_in_production: { label: 'Still sold new', type: 'enum', get: v => yesNo(v.still_in_production?.value) },
  dc_fast_charging: { label: 'DC fast charging', type: 'enum', get: v => yesNo(v.dc_fast_charging?.value) },
};

export function fieldValue(vehicle, fieldId) {
  const f = FIELDS[fieldId];
  return f ? f.get(vehicle) : null;
}

// 'pass' | 'fail' | 'unknown'. Missing data is never a failure — a vehicle we
// lack a measurement for should surface for a human to check, not vanish.
//
// `criterion` may be untrusted data loaded back from storage (the
// preferences endpoint validates only that criteria is an array, not the
// shape of each item) — every field below is read defensively so a
// malformed rule degrades to 'unknown' rather than throwing.
export function evaluateGate(vehicle, criterion) {
  const rule = criterion?.rule;
  if (!rule || typeof rule !== 'object' || rule.direction) return 'pass';
  const value = fieldValue(vehicle, rule.field);
  if (value === null) return 'unknown';

  switch (rule.op) {
    case '<':  return value <  rule.value ? 'pass' : 'fail';
    case '<=': return value <= rule.value ? 'pass' : 'fail';
    case '>':  return value >  rule.value ? 'pass' : 'fail';
    case '>=': return value >= rule.value ? 'pass' : 'fail';
    case '==': return value === rule.value ? 'pass' : 'fail';
    case '!=': return value !== rule.value ? 'pass' : 'fail';
    case 'between': {
      if (!Array.isArray(rule.value) || rule.value.length !== 2) return 'unknown';
      const [lo, hi] = rule.value;
      return value >= lo && value <= hi ? 'pass' : 'fail';
    }
    case 'in':
      return Array.isArray(rule.value) && rule.value.includes(value) ? 'pass' : 'fail';
    case 'not_in':
      return Array.isArray(rule.value) ? (rule.value.includes(value) ? 'fail' : 'pass') : 'unknown';
    default: return 'unknown';
  }
}

const GATE_TIERS = new Set(['must-have', 'deal-breaker']);
const isGate    = c => !!c && c.kind === 'hard' && GATE_TIERS.has(c.tier);

// The four tiers are two pairs: a hard and a soft form of "want this" and of
// "avoid this". `dislike` already inverts when scoring (sign = -1), and
// `deal-breaker` is its hard counterpart — matching the rule is what rules the
// vehicle OUT.
//
// It used to behave identically to `must-have`, which made it a redundant tier
// whose name said the opposite of what it did: "cargo length < 74" as a
// deal-breaker KEPT the vehicles under 74 instead of eliminating them.
//
// Only gating needs this. `dislike` is not a gate tier, and its scoring
// inversion is already handled by the sign, so inverting here too would cancel
// itself out.
//
// 'pass' means "survives this gate". Unknown stays unknown in both directions:
// missing data must never exclude a vehicle, whichever way the rule points.
function gateVerdict(vehicle, criterion) {
  const verdict = evaluateGate(vehicle, criterion);
  if (verdict === 'unknown' || criterion?.tier !== 'deal-breaker') return verdict;
  return verdict === 'pass' ? 'fail' : 'pass';
}
const isScoring = c => !!c && ((c.kind === 'fuzzy') || (c.kind === 'hard' && !GATE_TIERS.has(c.tier)));

// A malformed or stale weight (missing, NaN, a string) falls back to 1
// rather than propagating NaN through the whole score.
const weightOf = c => {
  const w = typeof c.weight === 'number' && Number.isFinite(c.weight) ? c.weight : 1;
  return Math.abs(w);
};

function rangesFor(vehicles, criteria) {
  const ranges = new Map();
  for (const c of criteria) {
    if (!c || c.kind !== 'fuzzy') continue;
    const field = c.rule?.field;
    let lo = Infinity, hi = -Infinity;
    if (field) {
      for (const v of vehicles) {
        const x = fieldValue(v, field);
        if (x === null) continue;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    ranges.set(c.id, Number.isFinite(lo) ? { lo, hi } : null);
  }
  return ranges;
}

export function rankVehicles(vehicles, criteria, pins) {
  const list = Array.isArray(criteria) ? criteria : [];
  const gates = list.filter(isGate);
  const scorers = list.filter(isScoring);

  // Pass 1: gates only. This decides who survives, which fuzzy normalization
  // (pass 2) depends on — so it has to finish first, not interleave with it.
  const gated = vehicles.map((vehicle, index) => {
    const violations = [];
    const unknowns = [];
    for (const c of gates) {
      const verdict = gateVerdict(vehicle, c);
      if (verdict === 'fail') violations.push({ id: c.id, label: c.label });
      else if (verdict === 'unknown') unknowns.push({ id: c.id, label: c.label });
    }
    const pinned = pins.has(vehicle.id);
    const excluded = violations.length > 0 && !pinned;
    return { vehicle, index, violations, unknowns, pinned, excluded };
  });

  // Fuzzy fields are normalized against the surviving set — every vehicle
  // that isn't excluded, which includes a pinned vehicle that failed a gate
  // (it still shows up in the list, so it's still part of the visible
  // scale). A vehicle a hard gate has already dropped must not stretch the
  // range the survivors are judged against, or the best of what's left
  // reads as mediocre because of vehicles nobody will see.
  const survivors = gated.filter(g => !g.excluded).map(g => g.vehicle);
  const ranges = rangesFor(survivors, scorers);

  // The reachable range of `raw`, so the 0..100 mapping puts the worst possible
  // vehicle at 0 and the best at 100 whatever mix of tiers is in play.
  const posWeight = scorers.reduce((s, c) => s + (c.tier === 'dislike' ? 0 : weightOf(c)), 0);
  const negWeight = scorers.reduce((s, c) => s + (c.tier === 'dislike' ? weightOf(c) : 0), 0);
  const span = posWeight + negWeight;

  const rows = gated.map(({ vehicle, index, violations, unknowns: gateUnknowns, pinned, excluded }) => {
    const unknowns = [...gateUnknowns];
    const contributions = [];
    let raw = 0;
    for (const c of scorers) {
      const weight = weightOf(c);
      const sign = c.tier === 'dislike' ? -1 : 1;
      let normalized = null;

      if (c.kind === 'fuzzy') {
        const range = ranges.get(c.id);
        const field = c.rule?.field;
        const x = field ? fieldValue(vehicle, field) : null;
        if (range && x !== null) {
          const spanX = range.hi - range.lo;
          const t = spanX === 0 ? 1 : (x - range.lo) / spanX;
          normalized = c.rule?.direction === 'lower' ? 1 - t : t;
        }
      } else {
        const verdict = evaluateGate(vehicle, c);
        if (verdict !== 'unknown') normalized = verdict === 'pass' ? 1 : 0;
        else unknowns.push({ id: c.id, label: c.label });
      }

      if (normalized === null) continue;
      const weighted = Math.round(sign * weight * normalized * 100) / 100;
      raw += weighted;
      contributions.push({ id: c.id, label: c.label, normalized, weighted });
    }

    // Map the signed total onto 0..100 so scores are comparable between runs.
    const score = span === 0 ? 0 : Math.round(((raw + negWeight) / span) * 1000) / 10;

    return {
      vehicle,
      score,
      pinned,
      excluded,
      violations,
      unknowns,
      contributions,
      _index: index,
    };
  });

  rows.sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    return a._index - b._index;
  });
  return rows.map(({ _index, ...row }) => row);
}
