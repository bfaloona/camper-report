import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '../_lib/auth.js';

const NUMERIC_FIELDS = [
  'length_in', 'width_in', 'height_in', 'cargo_length_in', 'max_cargo_cf',
  'mpg_city', 'mpg_hwy', 'ev_range_mi', 'price_low', 'price_high', 'tow_max',
  'reliability_score', 'safety_feature_count', 'conversion_kit_count',
  'camper_popularity', 'listed_year', 'sitting_height_in',
];

// Equipment booleans are modelled as yes/no enums rather than a new boolean
// type, so they flow through the existing enum ops unchanged. Every one of
// these must also exist in FIELDS in shortlist/scoring.js — scoring.test.mjs
// enforces FIELD_IDS ⊆ FIELDS, because a criterion naming a field the scorer
// cannot read silently never scores.
const YES_NO = ['yes', 'no'];
const ENUM_FIELDS = {
  vehicle_class: ['SUV', 'Minivan', 'Compact minivan', 'Compact van', 'Wagon', 'Hatchback'],
  powertrain: ['gas', 'hybrid', 'phev', 'ev'],
  drivetrain_bucket: ['awd', '2wd'],
  heated_front_seats: YES_NO,
  heated_steering_wheel: YES_NO,
  dual_zone_climate: YES_NO,
  remote_start: YES_NO,
  sunroof: YES_NO,
  roof_rails: YES_NO,
  power_liftgate: YES_NO,
  cargo_power_outlet: YES_NO,
  fold_flat_passenger: YES_NO,
  rear_seat_fold: ['flat', 'near-flat', 'uneven', 'removable'],
};

export const FIELD_IDS = [...NUMERIC_FIELDS, ...Object.keys(ENUM_FIELDS)];

const TIERS = ['must-have', 'nice-to-have', 'dislike', 'deal-breaker'];
const NUMERIC_OPS = ['<', '<=', '>', '>=', '==', '!=', 'between'];
const ENUM_OPS = ['in', 'not_in'];

// Rank 1 is the most important; weight falls off to a floor of 1.
const weightForRank = rank => Math.max(1, 6 - rank);

let seq = 0;
const newId = () => `c_${Date.now()}_${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function validRule(rule) {
  if (!rule || typeof rule !== 'object' || typeof rule.field !== 'string') return null;
  const numeric = NUMERIC_FIELDS.includes(rule.field);
  const isEnum = Object.prototype.hasOwnProperty.call(ENUM_FIELDS, rule.field);
  if (!numeric && !isEnum) return null;

  if (typeof rule.direction === 'string') {
    if (!numeric || !['higher', 'lower'].includes(rule.direction)) return null;
    return { field: rule.field, direction: rule.direction };
  }

  if (numeric) {
    if (!NUMERIC_OPS.includes(rule.op)) return null;
    if (rule.op === 'between') {
      if (!Array.isArray(rule.value) || rule.value.length !== 2) return null;
      if (!rule.value.every(n => typeof n === 'number' && Number.isFinite(n))) return null;
      return { field: rule.field, op: 'between', value: [...rule.value].sort((a, b) => a - b) };
    }
    if (typeof rule.value !== 'number' || !Number.isFinite(rule.value)) return null;
    return { field: rule.field, op: rule.op, value: rule.value };
  }

  if (!ENUM_OPS.includes(rule.op)) return null;
  const allowed = ENUM_FIELDS[rule.field];
  const values = Array.isArray(rule.value) ? rule.value : [rule.value];
  if (!values.length || !values.every(v => allowed.includes(v))) return null;
  return { field: rule.field, op: rule.op, value: values };
}

// Anything we cannot express against the field vocabulary becomes a NOTE, not
// a criterion. It used to survive as kind:"manual", which preserved the intent
// but gave it a criterion's whole apparatus — tier, weight, rank, reorder
// arrows — none of which did anything, because the scorer ignores a criterion
// with no rule. A must-have that filtered nothing still reported itself as met.
// A note claims nothing, so it cannot lie.
export function validateCriteria(raw) {
  return splitParse(raw).criteria;
}

export function splitParse(raw, extraNotes) {
  const criteria = [];
  const notes = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      if (!label) continue;
      if (!TIERS.includes(entry.tier)) continue;

      // validRule is the authority, not the model's own `kind`. A want the
      // model labelled "hard" against a field that does not exist, or an op the
      // field cannot take, lands here the same as one it gave up on.
      const rule = entry.kind === 'manual' ? null : validRule(entry.rule);
      if (rule === null) {
        notes.push(label);
        continue;
      }
      const rank = criteria.length + 1;
      criteria.push({
        id: newId(),
        label,
        tier: entry.tier,
        rank,
        weight: weightForRank(rank),
        weight_locked: false,
        kind: rule.direction ? 'fuzzy' : 'hard',
        rule,
        source_text: typeof entry.source_text === 'string' ? entry.source_text : label,
      });
    }
  }
  if (Array.isArray(extraNotes)) {
    for (const n of extraNotes) {
      const s = typeof n === 'string' ? n.trim() : '';
      if (s) notes.push(s);
    }
  }
  // Duplicates are easy here: the model can emit a want as both an unusable
  // criterion and a note.
  return { criteria, notes: [...new Set(notes)] };
}

// Exported for tests only. The structured-outputs endpoint validates this
// schema server-side and rejects the whole request on a violation, so a defect
// here is invisible until a live call fails -- which is how `value: {}` shipped.
export const SCHEMA = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          tier: { type: 'string', enum: TIERS },
          kind: { type: 'string', enum: ['hard', 'fuzzy', 'manual'] },
          source_text: { type: 'string' },
          rule: {
            anyOf: [
              { type: 'null' },
              {
                type: 'object',
                properties: {
                  field: { type: 'string', enum: FIELD_IDS },
                  op: { type: 'string', enum: [...NUMERIC_OPS, ...ENUM_OPS] },
                  // Every branch needs a concrete type: structured outputs
                  // reject `{}` outright ("Empty schema that accepts any JSON
                  // value is not supported"), which fails the whole request
                  // with a 400 rather than degrading. The union mirrors what
                  // validRule accepts -- a number for most numeric ops, a
                  // string for enum equality, an array for `between` (two
                  // numbers) and for enum `in`/`not_in` (strings). This shape
                  // is a hint to the model, not a guarantee: validRule is
                  // still the gate, and anything it rejects becomes a manual
                  // criterion.
                  value: {
                    anyOf: [
                      { type: 'number' },
                      { type: 'string' },
                      { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'string' }] } },
                    ],
                  },
                },
                required: ['field', 'op', 'value'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  field: { type: 'string', enum: NUMERIC_FIELDS },
                  direction: { type: 'string', enum: ['higher', 'lower'] },
                },
                required: ['field', 'direction'],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ['label', 'tier', 'kind', 'rule', 'source_text'],
        additionalProperties: false,
      },
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['criteria', 'notes'],
  additionalProperties: false,
};

const SYSTEM = `You turn a person's prose about the vehicle they want into structured criteria for a camper-conversion shortlist tool.

Split the prose into one distinct want per entry. Each want becomes EITHER a criterion (if a field expresses it) or a note (if none does).

For a criterion:

- "tier": "deal-breaker" if violating it rules a vehicle out entirely; "must-have" if it is required but a judgment call; "nice-to-have" if it is a preference; "dislike" if it is something to avoid.
- "kind": "hard" when the want maps to a threshold or set membership on one of the available fields; "fuzzy" when it maps to a direction on a numeric field but has no threshold ("as much cargo room as possible").
- "rule": for "hard", {field, op, value}. For "fuzzy", {field, direction}.
- "label": a short human-readable restatement, under 60 characters.
- "source_text": the fragment of the person's input this came from, verbatim.

Put a want in "notes" instead when no field expresses it. The dataset describes dimensions, cargo, economy, price, towing, reliability, driver-assist safety feature counts, conversion-kit availability, camper popularity, class, powertrain, drivetrain, a specific list of comfort and convenience equipment, and interior sitting height above the folded seats. Wants outside that list — upholstery material, infotainment, paint colour, brand preference, styling — are notes. A note is a plain sentence, no fields.

The equipment fields are yes/no enums: use op "in" with value ["yes"] for "must have it" and ["no"] for "must not". They record what is STANDARD on each vehicle's listed trim, so a want phrased as "available" or "can be optioned" is still a note, not a criterion. Equipment beyond that list (leather, tow hitch, third row, all-weather mats) is a note.

rear_seat_fold describes the surface with the rear seats down: "flat", "near-flat", "uneven", or "removable". Map "seats fold flat", "flat load floor" or "somewhere to sleep" to in ["flat","removable"] unless the person is clearly stricter.

sitting_height_in is inches of headroom above the folded seats — the "can I sit up in bed" number. Map wants about sitting up, sitting headroom or interior height when camping to it. Do NOT map general "tall interior" or "high roof" wants to height_in, which is the vehicle's EXTERIOR height and mostly measures ground clearance and roof rails.

Do not emit a criterion whose rule you cannot fill in. There is no "manual" kind: a want with no usable rule belongs in "notes", where it is shown to the person as something to weigh themselves. That is better than a criterion that appears to filter and does not.

Map wants about driver-assistance or safety technology ("good safety tech", "maximum driver aids", "modern safety features") to safety_feature_count with direction "higher" — that field counts the driver-assist features on record. Only send such a want to notes if it names specific equipment the count cannot capture.

Units are inches for dimensions, USD for prices, pounds for towing. camper_popularity is ordinal: 1 = Low, 2 = Medium, 3 = High. Prefer a note over forcing a want onto a field that does not really mean the same thing.`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function onRequestPost({ request, env }) {
  const { response } = await requireUser(request, env);
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Body must be JSON' }, 400);
  }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'Body must be { text }' }, 400);
  if (text.length > 4000) return json({ error: 'Text is too long (4000 character limit)' }, 400);

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'The parsing service is not configured.' }, 500);
  }

  let message;
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    message = await client.messages.create({
      model: 'claude-opus-5',
      // Thinking is on by default on Opus 5 and shares this budget with the
      // JSON output, so this is deliberately roomy for a short extraction task.
      max_tokens: 16000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    });
  } catch (e) {
    // The message is logged, unlike in the auth guard, because an upstream
    // failure here is otherwise undiagnosable: a 400 says the request body was
    // rejected without saying which field, and the status alone sent a real
    // debugging session down a wrong path. Anthropic's error body describes the
    // rejected request, never the credential -- the key travels in a header the
    // response does not echo. Truncated so a long body can't flood the log.
    console.error('parse: upstream failure', e?.name, e?.status, String(e?.message ?? '').slice(0, 400));
    return json({ error: 'Could not reach the parsing service. Add criteria by hand and try again later.' }, 502);
  }

  if (message.stop_reason === 'refusal') {
    return json({ error: 'The parsing service declined that input.' }, 422);
  }
  if (message.stop_reason === 'max_tokens') {
    return json({ error: 'That was too much to parse at once. Try a shorter description.' }, 422);
  }

  const block = message.content.find(b => b.type === 'text');
  if (!block) return json({ error: 'Empty response from the parsing service' }, 502);

  let parsed;
  try {
    parsed = JSON.parse(block.text);
  } catch (e) {
    return json({ error: 'Unparseable response from the parsing service' }, 502);
  }

  return json(splitParse(parsed.criteria, parsed.notes));
}
