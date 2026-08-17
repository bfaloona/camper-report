// Thin client over /api/prefs. The etag round-trip is what stops two people
// editing at once from silently overwriting each other.
let etag = null;

// Returns { prefs, email, warning }: `email` is the caller's own signed-in
// identity (distinct from prefs.updated_by, who last saved); `warning` is set
// when the stored blob was corrupted and defaults were served instead — the
// server sends it specifically so this doesn't fail silently, so callers must
// not drop it.
export async function loadPrefs() {
  const res = await fetch('/api/prefs', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Could not load preferences (${res.status})`);
  const body = await res.json();
  etag = body.etag;
  return { prefs: body.prefs, email: body.email, warning: body.warning };
}

export async function savePrefs(prefs) {
  const res = await fetch('/api/prefs', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prefs, etag }),
  });
  if (res.status === 409) {
    const err = new Error('Someone else saved changes while you were editing. Reload to see them.');
    err.conflict = true;
    throw err;
  }
  if (!res.ok) throw new Error(`Could not save preferences (${res.status})`);
  const body = await res.json();
  etag = body.etag;
  return body.prefs;
}

export async function parseProse(text) {
  const res = await fetch('/api/parse', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Could not parse that text (${res.status})`);
  }
  const body = await res.json();
  // `notes` carries the wants no field can express. Defaulted here because an
  // older deployment of /api/parse returns only `criteria`.
  return { criteria: body.criteria ?? [], notes: Array.isArray(body.notes) ? body.notes : [] };
}

// --- Notes formatting -------------------------------------------------------
// Notes are stored as one free-text string but presented as structured prose:
//
//   likes:
//   - heated seats
//
//   dislikes:
//   - looks like a work van
//
// The parser emits each unmappable want with a polarity, and these merge it
// into the right section instead of appending a flat list. Kept pure and
// exported so the merge is unit-tested — hand-rolled text munging that silently
// eats a user's typing is the obvious failure here.

const SECTION_RE = /^\s*(likes|dislikes)\s*:\s*$/i;
const ITEM_RE = /^\s*[-*]\s+(.*)$/;

// Returns { likes, dislikes, freeform }. `freeform` keeps anything that isn't
// inside a recognised section, so text typed by hand is never dropped.
export function parseNotes(text) {
  const out = { likes: [], dislikes: [], freeform: [] };
  let current = null;
  for (const line of String(text ?? '').split('\n')) {
    const header = line.match(SECTION_RE);
    if (header) { current = header[1].toLowerCase(); continue; }
    const item = line.match(ITEM_RE);
    if (item && current) {
      if (item[1].trim()) out[current].push(item[1].trim());
      continue;
    }
    if (line.trim()) out.freeform.push(line.trim());
  }
  return out;
}

export function formatNotes({ likes = [], dislikes = [], freeform = [] }) {
  const block = [];
  if (likes.length) block.push('likes:', ...likes.map(s => `- ${s}`));
  if (likes.length && dislikes.length) block.push('');
  if (dislikes.length) block.push('dislikes:', ...dislikes.map(s => `- ${s}`));
  // Freeform last so the structured sections stay at the top where they're scannable.
  if (freeform.length) block.push(...(block.length ? [''] : []), ...freeform);
  return block.join('\n');
}

// `additions` is [{ text, polarity }] from /api/parse. Case-insensitive dedupe,
// because re-running the same prose should not double every note.
export function mergeNotes(existingText, additions) {
  const parsed = parseNotes(existingText);
  for (const a of additions ?? []) {
    const text = typeof a?.text === 'string' ? a.text.trim() : '';
    if (!text) continue;
    const bucket = a.polarity === 'dislike' ? parsed.dislikes : parsed.likes;
    const seen = new Set([...parsed.likes, ...parsed.dislikes].map(s => s.toLowerCase()));
    if (!seen.has(text.toLowerCase())) bucket.push(text);
  }
  return formatNotes(parsed);
}
