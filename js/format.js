/**
 * Canonical JSON formatting for the data repo.
 *
 * MIRROR OF chad-data/validate.mjs — the two implementations must stay in
 * sync. If they diverge, every write from this app will trip the "formatting
 * drift" error in the data repo's CI.
 *
 * The rule that matters: records live one per line, so a commit that logs one
 * training session reads as "+1 line" in git history for the next decade.
 */

const RECORD_KEYS = new Set(['exercises', 'types', 'sources', 'sessions', 'readings']);
const WIDTH = 110;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function compact(v) {
  if (Array.isArray(v)) return '[' + v.map(compact).join(', ') + ']';
  if (isObj(v)) return '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + compact(x)).join(', ') + '}';
  return JSON.stringify(v);
}

function hasRecordArray(v) {
  if (Array.isArray(v)) return v.some(hasRecordArray);
  if (isObj(v)) return Object.entries(v).some(([k, x]) => RECORD_KEYS.has(k) || hasRecordArray(x));
  return false;
}

function render(v, indent, key) {
  const pad = ' '.repeat(indent);
  const inner = ' '.repeat(indent + 2);

  if (Array.isArray(v) && RECORD_KEYS.has(key)) {
    if (v.length === 0) return '[]';
    return '[\n' + v.map((el) => inner + compact(el)).join(',\n') + '\n' + pad + ']';
  }
  if (!Array.isArray(v) && !isObj(v)) return JSON.stringify(v);

  const flat = compact(v);
  if (!hasRecordArray(v) && flat.length + indent <= WIDTH) return flat;

  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return '[\n' + v.map((el) => inner + render(el, indent + 2)).join(',\n') + '\n' + pad + ']';
  }
  const entries = Object.entries(v);
  if (entries.length === 0) return '{}';
  return '{\n' + entries.map(([k, x]) => inner + JSON.stringify(k) + ': ' + render(x, indent + 2, k)).join(',\n') + '\n' + pad + '}';
}

export const formatDataFile = (obj) => render(obj, 0) + '\n';

/**
 * Records are written with a fixed key order so that editing a record produces
 * a one-field diff rather than a reordered line.
 */
const ORDER = {
  session: ['date', 'day', 'exercises', 'duration_min', 'notes', 'src', 'ext_id'],
  sessionExercise: ['ex', 'sets', 'note'],
  set: ['kg', 'km', 'reps', 'secs', 'rpe', 'to_failure'],
  reading: ['ts', 'type', 'value', 'src', 'tags', 'note', 'ext_id'],
};

const pick = (obj, order) => {
  const out = {};
  for (const k of order) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};

export const orderSession = (s) => {
  const o = pick(s, ORDER.session);
  o.exercises = (s.exercises || []).map((e) => {
    const eo = pick(e, ORDER.sessionExercise);
    eo.sets = (e.sets || []).map((st) => pick(st, ORDER.set));
    return eo;
  });
  return pick(o, ORDER.session);
};

export const orderReading = (r) => pick(r, ORDER.reading);
