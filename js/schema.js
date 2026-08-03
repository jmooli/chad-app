/**
 * Client-side validation, mirroring the checks in chad-data/validate.mjs.
 *
 * The repo's CI is the real guardrail; this exists so a bad record is caught
 * before it becomes a commit, rather than after.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateSession(s, { exerciseIds }) {
  const e = [];
  if (!DATE_RE.test(s.date || '')) e.push('Date must be YYYY-MM-DD.');
  if (!s.day) e.push('Rotation day is required.');
  if (s.duration_min !== undefined && (!isInt(s.duration_min) || s.duration_min <= 0)) e.push('Duration must be a whole number of minutes.');
  if (!Array.isArray(s.exercises) || !s.exercises.length) {
    e.push('Log at least one exercise with at least one set.');
    return e;
  }
  s.exercises.forEach((ex, i) => {
    const label = ex.ex || `exercise ${i + 1}`;
    if (!exerciseIds.has(ex.ex)) e.push(`"${label}" is not in the exercise registry.`);
    if (!Array.isArray(ex.sets) || !ex.sets.length) {
      e.push(`${label}: no sets recorded.`);
      return;
    }
    ex.sets.forEach((st, j) => {
      const at = `${label} set ${j + 1}`;
      if (st.reps === undefined && st.secs === undefined && st.km === undefined) e.push(`${at}: needs reps, time or distance.`);
      if (st.reps !== undefined && (!isInt(st.reps) || st.reps < 0)) e.push(`${at}: reps must be a whole number.`);
      if (st.secs !== undefined && (!isNum(st.secs) || st.secs <= 0)) e.push(`${at}: time must be positive.`);
      if (st.km !== undefined && (!isNum(st.km) || st.km <= 0)) e.push(`${at}: distance must be positive.`);
      if (st.kg !== undefined && !isNum(st.kg)) e.push(`${at}: weight must be a number.`);
      if (st.rpe !== undefined && (!isNum(st.rpe) || st.rpe < 1 || st.rpe > 10)) e.push(`${at}: RPE must be 1–10.`);
    });
  });
  return e;
}

export function validateReading(r, { types, sourceIds }) {
  const e = [];
  if (!TS_RE.test(r.ts || '')) e.push('Timestamp must be ISO 8601 with an offset.');
  const type = types.get(r.type);
  if (!type) {
    e.push(`Metric type "${r.type}" is not in the registry.`);
  } else if (type.shape === 'number') {
    if (!isNum(r.value)) e.push(`${type.name} must be a number (${type.unit}).`);
  } else if (isObj(type.shape)) {
    if (!isObj(r.value)) {
      e.push(`${type.name} needs values for ${Object.keys(type.shape).join(', ')}.`);
    } else {
      for (const k of type.primary_series || []) {
        if (!isNum(r.value[k])) e.push(`${type.name}: ${k} is required.`);
      }
      for (const [k, v] of Object.entries(r.value)) {
        if (!(k in type.shape)) e.push(`${type.name}: "${k}" is not part of this metric.`);
        else if (!isNum(v)) e.push(`${type.name}: ${k} must be a number.`);
      }
    }
  }
  if (!sourceIds.has(r.src)) e.push(`Source "${r.src}" is not in the registry.`);
  if (r.tags !== undefined && (!Array.isArray(r.tags) || r.tags.some((t) => typeof t !== 'string'))) e.push('Tags must be text.');
  return e;
}

/** Warnings do not block a save; they nudge toward analysable data. */
export function warnReading(r) {
  const w = [];
  if (r.type === 'bp' && !(r.tags || []).some((t) => t === 'morning' || t === 'evening')) {
    w.push('Blood pressure without a morning/evening tag cannot be split in the clinical report.');
  }
  return w;
}
