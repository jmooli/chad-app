/**
 * Data access layer: loads the registries, plan and year shards, and performs
 * all mutations as SHA-checked commits.
 *
 * Everything the views render comes from here; no view talks to GitHub directly.
 */

import { getFile, updateJson } from './github.js';
import { orderSession, orderReading } from './format.js';

const pad = (n) => String(n).padStart(2, '0');

export const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function isoWithOffset(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${todayISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}

const logPath = (y) => `logs/logs-${y}.json`;
const metricPath = (y) => `metrics/metrics-${y}.json`;

export const state = {
  exercises: new Map(),
  types: new Map(),
  sources: new Map(),
  plan: null,
  targets: null,
  mealPlans: [],
  logYears: new Map(),    // year -> sessions[]
  metricYears: new Map(),  // year -> readings[]
  loaded: false,
};

export const exerciseName = (id) => state.exercises.get(id)?.name || id;
export const metricType = (id) => state.types.get(id);
export const exerciseIds = () => new Set(state.exercises.keys());
export const sourceIds = () => new Set(state.sources.keys());

/* --- loading ------------------------------------------------------------ */

export async function loadRegistries() {
  const [ex, mt, src, plan, targets, meals] = await Promise.all([
    getFile('registry/exercises.json'),
    getFile('registry/metric-types.json'),
    getFile('registry/sources.json'),
    getFile('plan/current.json'),
    getFile('plan/targets.json'),
    getFile('registry/meal-plans.json'),
  ]);
  if (!ex || !mt || !src) throw new Error('Registry files are missing from the data repo.');

  state.exercises = new Map(ex.json.exercises.map((e) => [e.id, e]));
  state.types = new Map(mt.json.types.map((t) => [t.id, t]));
  state.sources = new Map(src.json.sources.map((s) => [s.id, s]));
  state.plan = plan ? plan.json : null;
  state.targets = targets ? targets.json : null;
  state.mealPlans = meals ? meals.json.plans || [] : [];
  state.loaded = true;
}

export const mealPlanById = (id) => state.mealPlans.find((p) => p.id === id) || null;
export const activeMealPlans = () => state.mealPlans.filter((p) => p.status === 'active');

/** Metric types logged as one whole number per day (bowl-count). */
export const dailyCountTypes = () => [...state.types.values()].filter((t) => t.cadence === 'daily' && t.value_type === 'integer');

export async function loadLogYear(year) {
  if (state.logYears.has(year)) return state.logYears.get(year);
  const f = await getFile(logPath(year));
  const sessions = f ? f.json.sessions || [] : [];
  state.logYears.set(year, sessions);
  return sessions;
}

export async function loadMetricYear(year) {
  if (state.metricYears.has(year)) return state.metricYears.get(year);
  const f = await getFile(metricPath(year));
  const readings = f ? f.json.readings || [] : [];
  state.metricYears.set(year, readings);
  return readings;
}

export async function loadYears(fromYear, toYear) {
  const years = [];
  for (let y = fromYear; y <= toYear; y++) years.push(y);
  await Promise.all(years.flatMap((y) => [loadLogYear(y), loadMetricYear(y)]));
  return {
    sessions: years.flatMap((y) => state.logYears.get(y) || []).sort((a, b) => a.date.localeCompare(b.date)),
    readings: years.flatMap((y) => state.metricYears.get(y) || []).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)),
  };
}

/** Years for which data files exist, oldest first. Used by the range presets. */
export async function knownYears() {
  const thisYear = new Date().getFullYear();
  const start = state.plan?.effective_from ? Number(state.plan.effective_from.slice(0, 4)) : thisYear;
  const years = [];
  for (let y = Math.min(start, thisYear); y <= thisYear; y++) years.push(y);
  return years;
}

export function invalidate() {
  state.logYears.clear();
  state.metricYears.clear();
}

/* --- training sessions -------------------------------------------------- */

// New shards are created at the current version for their kind — see the
// version history in the data repo README.
const EMPTY_LOG = { schema_version: 3, sessions: [] };
const EMPTY_METRICS = { schema_version: 1, readings: [] };

const insertSorted = (arr, item, keyOf) => {
  const key = keyOf(item);
  let i = arr.length;
  while (i > 0 && keyOf(arr[i - 1]) > key) i--;
  arr.splice(i, 0, item);
  return arr;
};

export async function saveSession(session) {
  const record = orderSession(session);
  const year = Number(record.date.slice(0, 4));
  const res = await updateJson(
    logPath(year),
    (file) => {
      insertSorted(file.sessions, record, (s) => s.date);
      return file;
    },
    `log: ${record.date} day ${record.day}`,
    { fallback: EMPTY_LOG },
  );
  if (res.content) state.logYears.set(year, res.content.sessions);
  return res;
}

/** Replaces the session identified by (date, day, occurrence). */
export async function replaceSession(original, updated) {
  const record = orderSession(updated);
  const oldYear = Number(original.date.slice(0, 4));
  const newYear = Number(record.date.slice(0, 4));

  if (oldYear !== newYear) {
    await deleteSession(original);
    return saveSession(record);
  }
  const res = await updateJson(
    logPath(oldYear),
    (file) => {
      const i = findSessionIndex(file.sessions, original);
      if (i < 0) throw new Error('That session is no longer in the log — it may have been changed elsewhere.');
      file.sessions.splice(i, 1);
      insertSorted(file.sessions, record, (s) => s.date);
      return file;
    },
    `log: edit ${record.date} day ${record.day}`,
    { fallback: EMPTY_LOG },
  );
  if (res.content) state.logYears.set(oldYear, res.content.sessions);
  return res;
}

export async function deleteSession(session) {
  const year = Number(session.date.slice(0, 4));
  const res = await updateJson(
    logPath(year),
    (file) => {
      const i = findSessionIndex(file.sessions, session);
      if (i < 0) return null;
      file.sessions.splice(i, 1);
      return file;
    },
    `log: remove ${session.date} day ${session.day}`,
    { fallback: EMPTY_LOG },
  );
  if (res.content) state.logYears.set(year, res.content.sessions);
  return res;
}

/**
 * Sessions have no IDs by design (see the data repo README), so they are
 * matched on their full content. Any concurrent edit therefore fails loudly
 * instead of overwriting the wrong record.
 */
function findSessionIndex(sessions, target) {
  const key = JSON.stringify(orderSession(target));
  return sessions.findIndex((s) => JSON.stringify(orderSession(s)) === key);
}

/* --- metric readings ---------------------------------------------------- */

const readingLabel = (r) => {
  const t = state.types.get(r.type);
  if (!t) return r.type;
  if (t.shape === 'number') return `${r.type} ${r.value}`;
  const parts = (t.primary_series || Object.keys(t.shape)).map((k) => r.value[k]);
  return `${r.type} ${parts.join('/')}`;
};

export async function saveReading(reading) {
  const record = orderReading(reading);
  const year = Number(record.ts.slice(0, 4));
  const res = await updateJson(
    metricPath(year),
    (file) => {
      insertSorted(file.readings, record, (r) => r.ts);
      return file;
    },
    `metric: ${readingLabel(record)}`,
    { fallback: EMPTY_METRICS },
  );
  if (res.content) state.metricYears.set(year, res.content.readings);
  return res;
}

/** The manually entered reading of a type on a calendar day, or null. */
export function dailyReadingFor(typeId, date) {
  const hits = allReadings().filter((r) => r.type === typeId && r.src === 'manual' && r.ts.slice(0, 10) === date);
  return hits.length ? hits[hits.length - 1] : null;
}

/**
 * Daily-cadence metrics hold one value per calendar day, so tapping the
 * stepper again replaces today's reading rather than appending a second one —
 * it is a correction, not a new data point, and it is one commit either way.
 */
export async function saveDailyCount(typeId, value) {
  const ts = isoWithOffset();
  const date = ts.slice(0, 10);
  const year = Number(date.slice(0, 4));
  const record = orderReading({ ts, type: typeId, value, src: 'manual' });
  const res = await updateJson(
    metricPath(year),
    (file) => {
      file.readings = file.readings.filter((r) => !(r.type === typeId && r.src === 'manual' && r.ts.slice(0, 10) === date));
      insertSorted(file.readings, record, (r) => r.ts);
      return file;
    },
    `metric: ${typeId} ${value}`,
    { fallback: EMPTY_METRICS },
  );
  if (res.content) state.metricYears.set(year, res.content.readings);
  return res;
}

export async function deleteReading(reading) {
  const year = Number(reading.ts.slice(0, 4));
  const key = JSON.stringify(orderReading(reading));
  const res = await updateJson(
    metricPath(year),
    (file) => {
      const i = file.readings.findIndex((r) => JSON.stringify(orderReading(r)) === key);
      if (i < 0) return null;
      file.readings.splice(i, 1);
      return file;
    },
    `metric: remove ${readingLabel(reading)}`,
    { fallback: EMPTY_METRICS },
  );
  if (res.content) state.metricYears.set(year, res.content.readings);
  return res;
}

/* --- derived helpers ---------------------------------------------------- */

/** Previously used tags, most frequent first — keeps the vocabulary from drifting. */
export function knownTags() {
  const counts = new Map();
  for (const readings of state.metricYears.values()) {
    for (const r of readings) for (const t of r.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  for (const t of ['morning', 'evening', 'fasted', 'rested', 'post-workout']) {
    if (!counts.has(t)) counts.set(t, 0);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

export function allSessions() {
  return [...state.logYears.values()].flat().sort((a, b) => a.date.localeCompare(b.date));
}

export function allReadings() {
  return [...state.metricYears.values()].flat().sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/** The most recent session that included a given exercise, regardless of day. */
export function lastSessionWith(exId) {
  const all = allSessions();
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].exercises.some((e) => e.ex === exId)) return all[i];
  }
  return null;
}

/**
 * The most recent session attributable to a plan slot — exercise id + rotation
 * day + rep scheme. Back Squat 3×5 (day A) and 3×8 (day C) are independent
 * progressions, so five-rep history must never seed an eight-rep suggestion.
 *
 * Attribution: the session's day label is authoritative — a day-C session is
 * day-C history whatever the reps say. A session labeled with another slot's
 * day belongs to that slot and is skipped. An unlabeled session (day "X", or a
 * letter that is not a slot for this exercise) is attributed by rep scheme,
 * and only when it fits exactly one slot; where that is ambiguous the session
 * is skipped — no suggestion beats a wrong one.
 */
function lastSlotSession(exId, day, reps) {
  const planSlots = [];
  for (const [letter, d] of Object.entries(state.plan?.days || {})) {
    const entry = (d.exercises || []).find((e) => e.ex === exId);
    if (entry) planSlots.push({ day: letter, reps: entry.reps });
  }
  const slotDays = new Set(planSlots.map((s) => s.day));
  const competing = slotDays.has(day) ? planSlots : [...planSlots, { day, reps }];

  // A slot fits when at least half the sets landed inside its rep range.
  const fits = (sets, [min, max]) => {
    const r = sets.map((s) => s.reps).filter((x) => typeof x === 'number');
    return r.length > 0 && r.filter((x) => x >= min && x <= max).length * 2 >= r.length;
  };

  const all = allSessions();
  for (let i = all.length - 1; i >= 0; i--) {
    const s = all[i];
    const entry = s.exercises.find((e) => e.ex === exId);
    if (!entry) continue;
    if (s.day === day) return s;
    if (slotDays.has(s.day)) continue;
    const fitting = competing.filter((c) => fits(entry.sets, c.reps));
    if (fitting.length === 1 && fitting[0].day === day) return s;
  }
  return null;
}

/**
 * Current-targets status for a date (data contract: README section 8 in the
 * data repo). Done-detection is by day label: the Nth queued spec labeled L is
 * done once more than N-1 manual sessions labeled L exist within the validity
 * window. Expiry is hard — past valid_until the caller must fall back to the
 * plan and say so, never render the stale numbers as current.
 */
export function targetsStatus(onDate = todayISO()) {
  const t = state.targets;
  if (!t || !Array.isArray(t.sessions) || !t.sessions.length) return { status: 'none' };
  if (onDate > t.valid_until) {
    const days = Math.round((Date.parse(onDate) - Date.parse(t.valid_until)) / 86400000);
    return { status: 'expired', targets: t, expiredDays: days };
  }
  const counts = new Map();
  for (const s of allSessions()) {
    if (s.src === undefined && s.date >= t.written && s.date <= t.valid_until) counts.set(s.day, (counts.get(s.day) || 0) + 1);
  }
  const seen = new Map();
  const queue = t.sessions.map((spec) => {
    const before = seen.get(spec.day) || 0;
    seen.set(spec.day, before + 1);
    return { spec, done: (counts.get(spec.day) || 0) > before };
  });
  const next = queue.find((q) => !q.done) || null;
  if (!next) return { status: 'completed', targets: t, queue };
  return { status: 'active', targets: t, queue, next: next.spec };
}

/**
 * Which rotation letter comes next: the one after the most recently logged
 * day, cycling through the plan's day keys. Falls back to the first day.
 */
export function nextRotationDay() {
  const letters = state.plan ? Object.keys(state.plan.days) : [];
  if (!letters.length) return null;
  // Only plan-day sessions advance the rotation — an off-plan walk (or an
  // imported activity, always day "X") must not reset the cycle to day A.
  const all = allSessions();
  for (let i = all.length - 1; i >= 0; i--) {
    const j = letters.indexOf(all[i].day);
    if (j >= 0) return letters[(j + 1) % letters.length];
  }
  return letters[0];
}

/**
 * Suggested load for the next time an exercise comes up: repeat last session's
 * top-set weight, or add the plan increment if every set reached the top of
 * the prescribed rep range. Progression is a suggestion — the owner confirms
 * or overrides it at the gym.
 */
export function suggestSets(planEntry, day) {
  const { ex, sets: setCount, reps, increment_kg } = planEntry;
  const prev = lastSlotSession(ex, day, reps);
  const prevSets = prev?.exercises.find((e) => e.ex === ex)?.sets || [];
  const target = reps[1];

  if (!prevSets.length) {
    return { sets: Array.from({ length: setCount }, () => ({ reps: reps[0] })), basis: 'no previous session', prevDate: null };
  }

  const weights = prevSets.map((s) => s.kg).filter((k) => typeof k === 'number');
  const topWeight = weights.length ? Math.max(...weights) : undefined;
  const allHitTop = prevSets.every((s) => (s.reps ?? 0) >= target);
  const progressed = allHitTop && increment_kg && topWeight !== undefined;
  const kg = progressed ? topWeight + increment_kg : topWeight;

  const suggestion = Array.from({ length: setCount }, () => ({
    ...(kg !== undefined ? { kg } : {}),
    reps: allHitTop ? reps[0] : Math.max(reps[0], Math.min(...prevSets.map((s) => s.reps ?? reps[0]))),
  }));

  return {
    sets: suggestion,
    basis: progressed ? `+${increment_kg} kg — all sets hit ${target}` : allHitTop ? 'repeat last load' : 'repeat last load, rep range not yet met',
    prevDate: prev.date,
    prevSets,
  };
}
