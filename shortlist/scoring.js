// Pure scoring for the Shortlist tool. No DOM, no fetch — everything here is a
// function of (vehicles, criteria, pins), which is what makes it testable.

const POP_ORDER = { Low: 1, Medium: 2, High: 3 };
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);

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
      const verdict = evaluateGate(vehicle, c);
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
