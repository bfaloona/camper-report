import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '../_lib/auth.js';

const NUMERIC_FIELDS = [
  'length_in', 'width_in', 'height_in', 'cargo_length_in', 'max_cargo_cf',
  'mpg_city', 'mpg_hwy', 'ev_range_mi', 'price_low', 'price_high', 'tow_max',
  'reliability_score', 'safety_feature_count', 'conversion_kit_count',
  'camper_popularity', 'listed_year',
];
const ENUM_FIELDS = {
  vehicle_class: ['SUV', 'Minivan', 'Compact minivan', 'Compact van', 'Wagon', 'Hatchback'],
  powertrain: ['gas', 'hybrid', 'phev', 'ev'],
  drivetrain_bucket: ['awd', '2wd'],
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

// Anything the model produced that we cannot express against the field
// vocabulary survives as kind:"manual" — the user's intent is preserved and
// shown, it just doesn't drive the score automatically.
export function validateCriteria(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!label) continue;
    if (!TIERS.includes(entry.tier)) continue;

    const rule = entry.kind === 'manual' ? null : validRule(entry.rule);
    const kind = rule === null ? 'manual' : (rule.direction ? 'fuzzy' : 'hard');
    const rank = out.length + 1;

    out.push({
      id: newId(),
      label,
      tier: entry.tier,
      rank,
      weight: weightForRank(rank),
      weight_locked: false,
      kind,
      rule,
      source_text: typeof entry.source_text === 'string' ? entry.source_text : label,
    });
  }
  return out;
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
  },
  required: ['criteria'],
  additionalProperties: false,
};

const SYSTEM = `You turn a person's prose about the vehicle they want into structured criteria for a camper-conversion shortlist tool.

Split the prose into one criterion per distinct want. For each:

- "tier": "deal-breaker" if violating it rules a vehicle out entirely; "must-have" if it is required but a judgment call; "nice-to-have" if it is a preference; "dislike" if it is something to avoid.
- "kind": "hard" when the want maps to a threshold or set membership on one of the available fields; "fuzzy" when it maps to a direction on a numeric field but has no threshold ("as much cargo room as possible"); "manual" when no field expresses it.
- "rule": for "hard", {field, op, value}. For "fuzzy", {field, direction}. For "manual", null.
- "label": a short human-readable restatement, under 60 characters.
- "source_text": the fragment of the person's input this came from, verbatim.

Units are inches for dimensions, USD for prices, pounds for towing. camper_popularity is ordinal: 1 = Low, 2 = Medium, 3 = High. Prefer "manual" over forcing a want onto a field that does not really mean the same thing.`;

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

  return json({ criteria: validateCriteria(parsed.criteria) });
}
