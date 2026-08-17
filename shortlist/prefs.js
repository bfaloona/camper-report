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
