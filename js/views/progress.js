/**
 * Progress — how things have moved, at two zoom levels.
 *
 * Short ranges show every reading; long ranges switch to weekly or monthly
 * means, so a decade of data stays a readable line rather than a smear.
 */

import { state, loadYears, knownYears, allSessions, allReadings, exerciseName, dailyCountTypes } from '../store.js';
import { chartSVG, legendHTML, SERIES_COLORS } from '../chart.js';
import { aggregationFor, aggregate, summarize, estimated1RM, topSetKg, volume, distance, duration, pace, fmtPace, fmtNum, fmtDate } from '../stats.js';
import { esc } from '../ui.js';

const RANGES = [
  { key: '4w', label: '4 weeks', days: 28 },
  { key: '3m', label: '3 months', days: 92 },
  { key: '1y', label: '1 year', days: 365 },
  { key: 'all', label: 'All', days: null },
];

const view = { range: '3m', exercise: null };

export default async function renderProgress(root, ctx) {
  const years = await knownYears();
  await loadYears(years[0], years[years.length - 1]);
  paint(root, ctx);
}

function rangeStart() {
  const r = RANGES.find((x) => x.key === view.range);
  if (!r.days) return 0;
  return Date.now() - r.days * 86400000;
}

function paint(root, ctx) {
  const from = rangeStart();
  const sessions = allSessions().filter((s) => Date.parse(s.date + 'T12:00:00') >= from);
  const readings = allReadings().filter((r) => Date.parse(r.ts) >= from);

  const lifts = liftOptions();
  if (!view.exercise || !lifts.includes(view.exercise)) view.exercise = lifts[0] || null;
  const totalKm = sessions.reduce((a, s) => a + s.exercises.reduce((b, e) => b + (distance(e) || 0), 0), 0);

  root.innerHTML = `
    <section class="progress">
      <div class="head-row">
        <h1>Progress</h1>
        <div class="segmented" role="group" aria-label="Date range">
          ${RANGES.map((r) => `<button class="${r.key === view.range ? 'on' : ''}" data-range="${r.key}">${esc(r.label)}</button>`).join('')}
        </div>
      </div>

      <div class="summary-row">
        <div class="stat"><span class="stat-n">${sessions.length}</span><span class="stat-l">sessions</span></div>
        <div class="stat"><span class="stat-n">${fmtNum(sessions.reduce((a, s) => a + s.exercises.reduce((b, e) => b + volume(e), 0), 0) / 1000, 1)}</span><span class="stat-l">tonnes lifted</span></div>
        ${totalKm > 0 ? `<div class="stat"><span class="stat-n">${fmtNum(totalKm, 1)}</span><span class="stat-l">km covered</span></div>` : ''}
        <div class="stat"><span class="stat-n">${readings.length}</span><span class="stat-l">readings</span></div>
      </div>

      <h2 class="section-head">Lifts</h2>
      ${lifts.length
        ? `<select id="lift-select" aria-label="Exercise">
             ${lifts.map((id) => `<option value="${esc(id)}" ${id === view.exercise ? 'selected' : ''}>${esc(exerciseName(id))}</option>`).join('')}
           </select>
           <div id="lift-chart">${liftChartHTML(sessions, view.exercise)}</div>`
        : '<p class="muted">No sessions logged in this range.</p>'}

      <h2 class="section-head">Health metrics</h2>
      ${metricSections(readings) || '<p class="muted">No readings in this range.</p>'}
    </section>`;

  root.querySelectorAll('[data-range]').forEach((b) =>
    b.addEventListener('click', () => {
      view.range = b.dataset.range;
      paint(root, ctx);
    }),
  );
  root.querySelector('#lift-select')?.addEventListener('change', (e) => {
    view.exercise = e.target.value;
    root.querySelector('#lift-chart').innerHTML = liftChartHTML(
      allSessions().filter((s) => Date.parse(s.date + 'T12:00:00') >= rangeStart()),
      view.exercise,
    );
  });
}

/** Exercises with at least one loaded set, most recently trained first. */
function liftOptions() {
  const seen = new Map();
  for (const s of allSessions()) for (const e of s.exercises) seen.set(e.ex, s.date);
  return [...seen.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id);
}

function liftChartHTML(sessions, exId) {
  if (!exId) return '';
  if (state.exercises.get(exId)?.equipment === 'cardio') return cardioChartHTML(sessions, exId);
  const points = [];
  const e1rm = [];
  for (const s of sessions) {
    const e = s.exercises.find((x) => x.ex === exId);
    if (!e) continue;
    const x = Date.parse(s.date + 'T12:00:00');
    const top = topSetKg(e);
    if (top !== null) points.push({ x, y: top });
    const est = estimated1RM(e);
    if (est !== null) e1rm.push({ x, y: est });
  }

  if (!points.length) {
    const repsOnly = sessions.some((s) => s.exercises.some((x) => x.ex === exId));
    return repsOnly ? repChartHTML(sessions, exId) : '<p class="muted">No loaded sets for this exercise in range.</p>';
  }

  const span = points[points.length - 1].x - points[0].x;
  const mode = aggregationFor(span);
  const series = [
    { name: 'Top set (kg)', color: SERIES_COLORS[0], points: aggregate(points, mode) },
    { name: 'Est. 1RM (kg)', color: SERIES_COLORS[1], points: aggregate(e1rm, mode), dashed: true },
  ].filter((s) => s.points.length);

  const stats = summarize(points.map((p) => p.y));
  return `
    ${aggNote(mode, points.length)}
    ${chartSVG({ series, unit: 'kg' })}
    ${legendHTML(series)}
    <p class="stat-line">${points.length} session(s) · ${fmtNum(stats.first)} → ${fmtNum(stats.last)} kg · best ${fmtNum(stats.max)} kg</p>`;
}

/**
 * Cardio progresses by distance, not load. Pace is reported as a summary
 * rather than a second line, because minutes-per-kilometre and kilometres do
 * not belong on one axis.
 */
function cardioChartHTML(sessions, exId) {
  const points = [];
  const paces = [];
  let totalKm = 0;
  let totalSecs = 0;

  for (const s of sessions) {
    const e = s.exercises.find((x) => x.ex === exId);
    if (!e) continue;
    const km = distance(e);
    if (km === null) continue;
    points.push({ x: Date.parse(s.date + 'T12:00:00'), y: km });
    totalKm += km;
    totalSecs += duration(e);
    const p = pace(e);
    if (p !== null) paces.push(p);
  }

  if (!points.length) return '<p class="muted">No distances recorded for this activity in range.</p>';

  const mode = aggregationFor(points[points.length - 1].x - points[0].x);
  const series = [{ name: 'Distance (km)', color: SERIES_COLORS[2], points: aggregate(points, mode) }];
  const best = paces.length ? Math.min(...paces) : null;
  const avg = paces.length ? paces.reduce((a, b) => a + b, 0) / paces.length : null;

  return `
    ${aggNote(mode, points.length)}
    ${chartSVG({ series, unit: 'km', yZero: true })}
    <p class="stat-line">
      ${points.length} outing(s) · ${fmtNum(totalKm, 1)} km total
      ${totalSecs ? ` · ${Math.round(totalSecs / 60)} min` : ''}
      ${avg !== null ? ` · average ${fmtPace(avg)}, best ${fmtPace(best)}` : ''}
    </p>`;
}

/** Bodyweight movements progress by reps, not load. */
function repChartHTML(sessions, exId) {
  const points = [];
  for (const s of sessions) {
    const e = s.exercises.find((x) => x.ex === exId);
    if (!e) continue;
    const reps = e.sets.reduce((a, st) => a + (st.reps || 0), 0);
    if (reps) points.push({ x: Date.parse(s.date + 'T12:00:00'), y: reps });
  }
  if (!points.length) return '<p class="muted">No data for this exercise in range.</p>';
  const mode = aggregationFor(points[points.length - 1].x - points[0].x);
  const series = [{ name: 'Total reps', color: SERIES_COLORS[2], points: aggregate(points, mode) }];
  return `${aggNote(mode, points.length)}${chartSVG({ series, unit: 'reps', yZero: true })}`;
}

function metricSections(readings) {
  const byType = new Map();
  for (const r of readings) {
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type).push(r);
  }
  if (!byType.size) return '';

  return [...byType.entries()]
    .map(([typeId, rs]) => {
      const t = state.types.get(typeId);
      if (!t) return '';
      const span = Date.parse(rs[rs.length - 1].ts) - Date.parse(rs[0].ts);
      const mode = aggregationFor(span);
      const comps = t.shape === 'number' ? [null] : t.primary_series || Object.keys(t.shape);

      const series = comps.map((c, i) => ({
        name: c ? `${t.name} ${c}` : t.name,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        points: aggregate(
          rs.map((r) => ({ x: Date.parse(r.ts), y: c ? r.value[c] : r.value })).filter((p) => Number.isFinite(p.y)),
          mode,
        ),
      })).filter((s) => s.points.length);

      if (!series.length) return '';
      const stats = summarize(series[0].points.map((p) => p.y));

      // Diet adherence as quiet background bars behind weight and BP — the
      // question these charts answer is what bowl adherence did to outcomes.
      let bands = null;
      if (typeId === 'weight' || typeId === 'bp') {
        for (const ct of dailyCountTypes()) {
          const crs = byType.get(ct.id);
          if (!crs?.length) continue;
          const points = aggregate(crs.map((r) => ({ x: Date.parse(r.ts), y: r.value })).filter((p) => Number.isFinite(p.y)), mode);
          if (points.length) bands = { points, max: ct.max ?? 6, name: `${ct.unit}/day` };
          break;
        }
      }

      return `
        <article class="metric-block">
          <h3>${esc(t.name)} <span class="unit">${esc(t.unit)}</span></h3>
          ${aggNote(mode, rs.length)}
          ${chartSVG({ series, unit: t.unit, refLines: refLinesFor(typeId), bands })}
          ${legendHTML(series)}
          ${bands ? `<p class="agg-note">Grey bars: ${esc(bands.name)} (0–${esc(bands.max)})${mode === 'raw' ? '' : ', averaged like the line'}</p>` : ''}
          <p class="stat-line">${rs.length} reading(s) · latest ${esc(fmtNum(stats.last, t.decimals ?? 1))} ${esc(t.unit)} · mean ${esc(fmtNum(stats.mean, t.decimals ?? 1))}</p>
        </article>`;
    })
    .join('');
}

/**
 * Reference lines for metrics with a widely used threshold. These are general
 * population guidance for orientation only, not a personal target.
 */
function refLinesFor(typeId) {
  if (typeId === 'bp') return [{ y: 140, label: '140 systolic' }, { y: 90, label: '90 diastolic' }];
  return [];
}

const aggNote = (mode, n) =>
  mode === 'raw' ? '' : `<p class="agg-note">${n} points shown as ${mode === 'weekly' ? 'weekly' : 'monthly'} averages</p>`;
