/**
 * Aggregation and summary statistics.
 *
 * Charts spanning years must not try to draw thousands of raw points, and a
 * doctor looking at blood pressure needs period averages, not a scatter.
 */

const DAY = 86400000;

/** Raw points up to ~3 months, then weekly, then monthly. */
export function aggregationFor(spanMs) {
  const days = spanMs / DAY;
  if (days <= 95) return 'raw';
  if (days <= 800) return 'weekly';
  return 'monthly';
}

const startOfWeek = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const wd = (x.getDay() + 6) % 7; // Monday-based
  x.setDate(x.getDate() - wd);
  return x.getTime();
};

const startOfMonth = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x.getTime();
};

/** points: [{x, y}] → bucket means. Bucket x is the bucket start. */
export function aggregate(points, mode) {
  if (mode === 'raw' || !points.length) return points;
  const bucketOf = mode === 'weekly' ? startOfWeek : startOfMonth;
  const buckets = new Map();
  for (const p of points) {
    const k = bucketOf(p.x);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p.y);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, ys]) => ({ x, y: ys.reduce((a, b) => a + b, 0) / ys.length, n: ys.length }));
}

export function summarize(values) {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { n: v.length, mean, sd, min: Math.min(...v), max: Math.max(...v), first: v[0], last: v[v.length - 1] };
}

/**
 * Morning or evening. The tag is authoritative — it records what the owner
 * actually did. Clock time is only a fallback for untagged readings, and is
 * marked as inferred so a clinical report never presents a guess as fact.
 */
export function partOfDay(reading) {
  const tags = reading.tags || [];
  if (tags.includes('morning')) return { period: 'morning', inferred: false };
  if (tags.includes('evening')) return { period: 'evening', inferred: false };
  const h = new Date(reading.ts).getHours();
  return { period: h < 12 ? 'morning' : 'evening', inferred: true };
}

/** Total distance covered in a logged cardio exercise, or null if it is not cardio. */
export function distance(exercise) {
  const km = (exercise.sets || []).reduce((sum, s) => sum + (typeof s.km === 'number' ? s.km : 0), 0);
  return km > 0 ? Math.round(km * 100) / 100 : null;
}

/** Seconds of work recorded against an exercise. */
export function duration(exercise) {
  return (exercise.sets || []).reduce((sum, s) => sum + (typeof s.secs === 'number' ? s.secs : 0), 0);
}

/** Average pace as minutes per kilometre, or null when it cannot be computed. */
export function pace(exercise) {
  const km = distance(exercise);
  const secs = duration(exercise);
  if (!km || !secs) return null;
  return secs / 60 / km;
}

export const fmtPace = (minPerKm) => {
  if (minPerKm === null || !Number.isFinite(minPerKm)) return '–';
  let m = Math.floor(minPerKm);
  let s = Math.round((minPerKm - m) * 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${String(s).padStart(2, '0')} /km`;
};

/** Volume load for a logged exercise: sum of kg x reps, bodyweight sets excluded. */
export function volume(exercise) {
  return (exercise.sets || []).reduce((sum, s) => sum + (typeof s.kg === 'number' && s.kg > 0 ? s.kg * (s.reps || 0) : 0), 0);
}

/** Heaviest set of an exercise in a session. */
export function topSetKg(exercise) {
  const w = (exercise.sets || []).map((s) => s.kg).filter((k) => typeof k === 'number');
  return w.length ? Math.max(...w) : null;
}

/**
 * Epley loses touch with reality past ~10 reps, so high-rep hypertrophy sets
 * are excluded rather than allowed to produce a confident-looking guess.
 */
export const EPLEY_MAX_REPS = 10;

/** Epley estimate — comparable across rep ranges, useful for long-run trend. */
export function estimated1RM(exercise) {
  let best = null;
  for (const s of exercise.sets || []) {
    if (typeof s.kg !== 'number' || s.kg <= 0 || !s.reps || s.reps > EPLEY_MAX_REPS) continue;
    const e = s.kg * (1 + s.reps / 30);
    if (best === null || e > best) best = e;
  }
  return best === null ? null : Math.round(best * 10) / 10;
}

/**
 * Best value in the trailing window, evaluated at each point's date.
 *
 * A lifter alternating hypertrophy and strength weights does not get weaker on
 * the light days, so the 1RM trend must not dip every time the program calls
 * for volume. The rolling best only declines when a heavy exposure ages out of
 * the window without being matched — which is the honest signal.
 */
export function rollingBest(points, windowDays = 28) {
  const win = windowDays * DAY;
  const sorted = [...points].sort((a, b) => a.x - b.x);
  return sorted.map((p, i) => {
    let best = p.y;
    for (let j = i - 1; j >= 0 && sorted[j].x > p.x - win; j--) if (sorted[j].y > best) best = sorted[j].y;
    return { x: p.x, y: best };
  });
}

export const fmtNum = (v, decimals = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(decimals).replace(/\.0+$/, '');

export const fmtDate = (iso) => {
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

export const fmtDateTime = (iso) => {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
