// The trait picker's vocabulary and compiler. Pure — no DOM, no fetch — so
// every export is unit-testable, same contract as scoring.js.
//
// A trait is a curated one-click front end over an enum field in FIELDS:
// YES compiles to a must-have `in` rule, NO to the same rule as a
// deal-breaker, IGNORE to nothing. Selections live in the shared prefs blob
// as `traits: { <trait_id>: 'yes' | 'no' }` and are compiled fresh on every
// render — compiled criteria are never stored, so the criteria list and the
// picker cannot drift apart.
//
// The vocabulary, each formula, and the reviewed thresholds are documented in
// docs/trait-picker-classification.md.

// `yes_only: true` marks rows where NO is a control with no sane use — a NO
// on "flat sleeping floor" would mean "rule out vehicles with flat floors".
// The UI renders those rows without a NO button and sanitizeTraits drops a
// stored 'no' for them (review decision, 2026-08-17).
export const TRAITS = [
  // --- Power & climate -------------------------------------------------------
  { id: 'engine_off_climate', group: 'Power & climate',
    label: 'Engine-off overnight climate',
    blurb: 'PHEV/EV only: heat and A/C run off the battery — silent, no idling, no exhaust.',
    field: 'overnight_climate', yes_values: ['engine-off'] },
  { id: 'quiet_overnight_climate', group: 'Power & climate',
    label: 'Overnight climate without idling all night',
    blurb: 'Engine-off (PHEV/EV) or hybrid auto-cycling; rules out idle-only gas vehicles.',
    field: 'overnight_climate', yes_values: ['engine-off', 'engine-cycling'], yes_only: true },
  { id: 'ac_outlet_any', group: 'Power & climate',
    label: 'Factory 120V outlet (any wattage)',
    blurb: 'A household AC outlet available on this generation, any trim or option.',
    field: 'onboard_ac_power', yes_values: ['low_watt', 'high_watt'], yes_only: true },
  { id: 'ac_power_high', group: 'Power & climate',
    label: 'High-power 120V (runs a fridge or cooktop)',
    blurb: '1000W+ (e.g. a 1500W inverter); a 150W outlet only covers laptops and phones.',
    field: 'onboard_ac_power', yes_values: ['high_watt'], yes_only: true },
  { id: 'dc_fast_charging', group: 'Power & climate',
    label: 'DC fast charging',
    blurb: 'Plug-ins only; gas and hybrid vehicles are an honest no.',
    field: 'dc_fast_charging', yes_values: ['yes'], yes_only: true },

  // --- Space & sleeping ------------------------------------------------------
  { id: 'sleeps_six_feet', group: 'Space & sleeping',
    label: 'Sleeps a 6-footer straight',
    blurb: '75+ in behind the front seats (72-in body plus bedding margin); 70–74.9 reads as tight.',
    field: 'sleeps_six_feet', yes_values: ['yes'], yes_only: true },
  { id: 'flat_sleep_floor', group: 'Space & sleeping',
    label: 'Flat sleeping floor (folds flat or seats remove)',
    blurb: 'No platform build needed to get a flat deck.',
    field: 'rear_seat_fold', yes_values: ['flat', 'removable'], yes_only: true },
  { id: 'fold_flat_in_place', group: 'Space & sleeping',
    label: 'Folds flat with no seat removal',
    blurb: "Stow 'n Go and fold-into-floor designs — nothing to store at home.",
    field: 'rear_seat_fold', yes_values: ['flat'], yes_only: true },
  { id: 'sliding_doors', group: 'Space & sleeping',
    label: 'Sliding doors',
    blurb: 'Class-derived: every van/minivan here has them, no SUV/wagon/hatch does.',
    field: 'sliding_doors', yes_values: ['yes'] },

  // --- Capability ------------------------------------------------------------
  { id: 'awd', group: 'Capability',
    label: 'AWD or 4WD',
    blurb: "The listed trim's drivetrain; NO rules AWD/4WD out.",
    field: 'drivetrain_bucket', yes_values: ['awd'] },
  { id: 'clearance_high', group: 'Capability',
    label: 'Dirt-road ground clearance (8.5+ in)',
    blurb: 'Manufacturer-published clearance; 7.0–8.4 is moderate, under 7.0 is low-slung.',
    field: 'clearance_class', yes_values: ['high'] },
  { id: 'tow_any', group: 'Capability',
    label: 'Rated to tow at all',
    blurb: 'Rules out the 0-lb "never tow" vehicles.',
    field: 'tow_class', yes_values: ['light', 'moderate', 'substantial'], yes_only: true },
  { id: 'tow_trailer', group: 'Capability',
    label: 'Tows a small camping trailer (2,000+ lb)',
    blurb: 'Teardrops and small utility trailers; 3,500+ is the substantial tier.',
    field: 'tow_class', yes_values: ['moderate', 'substantial'], yes_only: true },

  // --- Practicality ----------------------------------------------------------
  { id: 'stealth_high', group: 'Practicality',
    label: 'High urban stealth',
    blurb: 'Class-derived judgment: vans and commuter hatchbacks read anonymous; SUVs/wagons show gear through glass.',
    field: 'stealth_profile', yes_values: ['high'] },
  { id: 'strong_aftermarket', group: 'Practicality',
    label: 'Strong camper aftermarket',
    blurb: 'camper_popularity rating High — platform kits, mattresses, guides all exist.',
    field: 'camper_popularity_tier', yes_values: ['High'], yes_only: true },
  { id: 'spare_tire', group: 'Practicality',
    label: 'Spare tire on board',
    blurb: 'Full-size or compact from the factory; NO-spare vehicles ship a sealant kit.',
    field: 'spare_tire', yes_values: ['full-size', 'compact'], yes_only: true },
  { id: 'still_in_production', group: 'Practicality',
    label: 'Still sold new in the US',
    blurb: 'This generation or a direct successor — a parts and support proxy.',
    field: 'still_in_production', yes_values: ['yes'], yes_only: true },

  // --- Equipment (collapsed subsection in the UI, per review addition R2) ----
  ...[
    ['heated_front_seats', 'Heated front seats'],
    ['heated_steering_wheel', 'Heated steering wheel'],
    ['ventilated_front_seats', 'Ventilated front seats'],
    ['dual_zone_climate', 'Dual-zone climate'],
    ['remote_start', 'Remote start'],
    ['sunroof', 'Sunroof'],
    ['roof_rails', 'Roof rails'],
    ['power_liftgate', 'Power liftgate'],
    ['cargo_power_outlet', 'Cargo area power outlet'],
    ['fold_flat_passenger', 'Fold-flat front passenger seat'],
  ].map(([field, label]) => ({
    id: `eq_${field}`, group: 'Equipment', label,
    blurb: 'Standard on the listed trim; optional counts as no.',
    field, yes_values: ['yes'],
  })),
];

const BY_ID = new Map(TRAITS.map(t => [t.id, t]));

// Selections come back from KV, where /api/prefs guarantees only "some JSON
// value" — treat everything as hostile. Unknown ids and values are dropped,
// as is a 'no' on a yes_only row (there is no button that produces one, so a
// stored one is stale or hand-crafted).
export function sanitizeTraits(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, val] of Object.entries(raw)) {
    const t = BY_ID.get(id);
    if (!t) continue;
    if (val === 'yes' || (val === 'no' && !t.yes_only)) out[id] = val;
  }
  return out;
}

// Selections → criteria in the existing schema, nothing new for the scorer to
// learn. All compiled criteria are gates (must-have / deal-breaker), so the
// weight/rank fields are inert placeholders — gates filter, they never score.
// Ids are stable (`trait_<id>`) and labels human-readable because they are
// what the ✕/? badges display.
export function compileTraits(traitsMap) {
  const clean = sanitizeTraits(traitsMap);
  const out = [];
  for (const t of TRAITS) {
    const sel = clean[t.id];
    if (sel !== 'yes' && sel !== 'no') continue;
    out.push({
      id: `trait_${t.id}`,
      label: t.label,
      tier: sel === 'yes' ? 'must-have' : 'deal-breaker',
      kind: 'hard',
      rank: 0,
      weight: 1,
      weight_locked: true,
      rule: { field: t.field, op: 'in', value: [...t.yes_values] },
      source_text: 'trait picker',
    });
  }
  return out;
}
