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
  const [ex, mt, src, plan] = await Promise.all([
    getFile('registry/exercises.json'),
    getFile('registry/metric-types.json'),
    getFile('registry/sources.json'),
    getFile('plan/current.json'),
  ]);
  if (!ex || !mt || !src) throw new Error('Registry files are missing from the data repo.');

  state.exercises = new Map(ex.json.exercises.map((e) => [e.id, e]));
  state.types = new Map(mt.json.types.map((t) => [t.id, t]));
  state.sources = new Map(src.json.sources.map((s) => [s.id, s]));
  state.plan = plan ? plan.json : null;
  state.loaded = true;
}

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

const EMPTY_LOG = { schema_version: 1, sessions: [] };
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

/** The most recent session, or null. */
export function lastSession() {
  const all = allSessions();
  return all.length ? all[all.length - 1] : null;
}

/**
 * The most recent session that included a given exercise.
 *
 * When a rotation day is given, sessions from that day win. The same lift can
 * appear on two days at different rep schemes — Back Squat is 3×5 on day A and
 * 3×8 on day C — and carrying the heavy five-rep load into the eight-rep day
 * would suggest a weight that was never intended.
 */
export function lastSessionWith(exId, day) {
  const all = allSessions();
  const search = (filterDay) => {
    for (let i = all.length - 1; i >= 0; i--) {
      if (filterDay && all[i].day !== filterDay) continue;
      if (all[i].exercises.some((e) => e.ex === exId)) return all[i];
    }
    return null;
  };
  return (day ? search(day) : null) || search(null);
}

/**
 * Which rotation letter comes next: the one after the most recently logged
 * day, cycling through the plan's day keys. Falls back to the first day.
 */
export function nextRotationDay() {
  const letters = state.plan ? Object.keys(state.plan.days) : [];
  if (!letters.length) return null;
  const last = lastSession();
  if (!last) return letters[0];
  const i = letters.indexOf(last.day);
  if (i < 0) return letters[0];
  return letters[(i + 1) % letters.length];
}

/**
 * Suggested load for the next time an exercise comes up: repeat last session's
 * top-set weight, or add the plan increment if every set reached the top of
 * the prescribed rep range. Progression is a suggestion — the owner confirms
 * or overrides it at the gym.
 */
export function suggestSets(planEntry, day) {
  const { ex, sets: setCount, reps, increment_kg } = planEntry;
  const prev = lastSessionWith(ex, day);
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
