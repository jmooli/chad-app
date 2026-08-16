/**
 * Progress — how things have moved, at two zoom levels.
 *
 * Short ranges show every reading; long ranges switch to weekly or monthly
 * means, so a decade of data stays a readable line rather than a smear.
 *
 * The range is a slider, not preset buttons: drag it and every chart follows
 * live. Each chart also opens full-screen (⤢) for pinch-zoom and panning.
 */

import { state, loadYears, knownYears, allSessions, allReadings, exerciseName, dailyCountTypes } from '../store.js';
import { chartSVG, legendHTML, SERIES_COLORS } from '../chart.js';
import { openChartView } from '../chartview.js';
import { aggregationFor, aggregate, summarize, estimated1RM, rollingBest, topSetKg, volume, distance, duration, pace, fmtPace, fmtNum, fmtDate } from '../stats.js';
import { esc } from '../ui.js';

/**
 * Slider stops. Discrete named spans rather than a continuous scale: "3 months"
 * is a statement you can reason about, "97 days" is not, and snapping keeps the
 * aggregation level stable while dragging.
 */
const STOPS = [
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 28, label: '4 weeks' },
  { days: 42, label: '6 weeks' },
  { days: 61, label: '2 months' },
  { days: 92, label: '3 months' },
  { days: 122, label: '4 months' },
  { days: 183, label: '6 months' },
  { days: 274, label: '9 months' },
  { days: 365, label: '1 year' },
  { days: 548, label: '18 months' },
  { days: 730, label: '2 years' },
  { days: 1095, label: '3 years' },
  { days: 1826, label: '5 years' },
  { days: null, label: 'All' },
];

const view = { rangeIdx: STOPS.findIndex((s) => s.days === 92), exercise: null, folded: new Set() };

const rangeLabel = () => {
  const s = STOPS[view.rangeIdx];
  return s.days ? `Last ${s.label.toLowerCase()}` : 'All data';
};

/** Specs for the full-screen viewer, rebuilt on every body paint. */
const chartSpecs = new Map();

/** A folded chart is not rendered at all — the bar alone is enough to glance past it. */
const foldHead = (key, label, summary) => {
  const folded = view.folded.has(key);
  return `<button type="button" class="fold" data-fold="${esc(key)}" aria-expanded="${!folded}">
    <span class="chev" aria-hidden="true">${folded ? '▸' : '▾'}</span>${label}
    ${folded && summary ? `<span class="fold-summary">${esc(summary)}</span>` : ''}
  </button>`;
};

/** Chart plus its expand-to-full-screen button. */
const chartFig = (key, svg) =>
  `<div class="chart-wrap">${svg}<button type="button" class="chart-zoom" data-zoom="${esc(key)}" aria-label="Open chart full screen">⤢</button></div>`;

export default async function renderProgress(root, ctx) {
  const years = await knownYears();
  await loadYears(years[0], years[years.length - 1]);
  paint(root, ctx);
}

function rangeStart() {
  const d = STOPS[view.rangeIdx].days;
  return d ? Date.now() - d * 86400000 : 0;
}

/**
 * Charts are pinned to the selected range, not the data extent — picking
 * "4 weeks" must zoom the x-axis to those four weeks even if the only data
 * sits in one of them. "All" keeps the data-driven axis.
 */
function xDomain() {
  return STOPS[view.rangeIdx].days ? [rangeStart(), Date.now()] : null;
}

/** Aggregation follows the axis: what the chart spans decides the bucketing. */
function spanOf(points) {
  const d = xDomain();
  return d ? d[1] - d[0] : points[points.length - 1].x - points[0].x;
}

function paint(root, ctx) {
  root.innerHTML = `
    <section class="progress">
      <div class="head-row">
        <h1>Progress</h1>
        <span class="range-label">${esc(rangeLabel())}</span>
      </div>
      <input type="range" class="range-slider" id="range-slider" min="0" max="${STOPS.length - 1}" step="1"
        value="${view.rangeIdx}" aria-label="Date range" aria-valuetext="${esc(rangeLabel())}">
      <div id="progress-body"></div>
    </section>`;

  paintBody(root, ctx);

  // Live scrub: the slider sits outside the repainted body, so dragging is
  // never interrupted by its own re-render.
  const slider = root.querySelector('#range-slider');
  let queued = false;
  slider.addEventListener('input', () => {
    view.rangeIdx = Number(slider.value);
    slider.setAttribute('aria-valuetext', rangeLabel());
    root.querySelector('.range-label').textContent = rangeLabel();
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; paintBody(root, ctx); });
  });
}

function paintBody(root, ctx) {
  const body = root.querySelector('#progress-body');
  const from = rangeStart();
  const sessions = allSessions().filter((s) => Date.parse(s.date + 'T12:00:00') >= from);
  const readings = allReadings().filter((r) => Date.parse(r.ts) >= from);

  const lifts = liftOptions();
  if (!view.exercise || !lifts.includes(view.exercise)) view.exercise = lifts[0] || null;
  const totalKm = sessions.reduce((a, s) => a + s.exercises.reduce((b, e) => b + (distance(e) || 0), 0), 0);

  chartSpecs.clear();

  body.innerHTML = `
      <div class="summary-row">
        <div class="stat"><span class="stat-n">${sessions.length}</span><span class="stat-l">sessions</span></div>
        <div class="stat"><span class="stat-n">${fmtNum(sessions.reduce((a, s) => a + s.exercises.reduce((b, e) => b + volume(e), 0), 0) / 1000, 1)}</span><span class="stat-l">tonnes lifted</span></div>
        ${totalKm > 0 ? `<div class="stat"><span class="stat-n">${fmtNum(totalKm, 1)}</span><span class="stat-l">km covered</span></div>` : ''}
        <div class="stat"><span class="stat-n">${readings.length}</span><span class="stat-l">readings</span></div>
      </div>

      <h2 class="section-head">${foldHead('lifts', 'Lifts', view.exercise ? exerciseName(view.exercise) : '')}</h2>
      ${view.folded.has('lifts') ? ''
        : lifts.length
          ? `<select id="lift-select" aria-label="Exercise">
               ${lifts.map((id) => `<option value="${esc(id)}" ${id === view.exercise ? 'selected' : ''}>${esc(exerciseName(id))}</option>`).join('')}
             </select>
             <div id="lift-chart">${liftChartHTML(sessions, view.exercise)}</div>`
          : '<p class="muted">No sessions logged in this range.</p>'}

      <h2 class="section-head">Health metrics</h2>
      ${metricSections(readings) || '<p class="muted">No readings in this range.</p>'}`;

  body.querySelectorAll('[data-fold]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.dataset.fold;
      if (!view.folded.delete(key)) view.folded.add(key);
      paintBody(root, ctx);
    }),
  );
  body.querySelector('#lift-select')?.addEventListener('change', (e) => {
    view.exercise = e.target.value;
    paintBody(root, ctx);
  });
  body.querySelectorAll('[data-zoom]').forEach((b) =>
    b.addEventListener('click', () => {
      const spec = chartSpecs.get(b.dataset.zoom);
      if (spec) openChartView(spec);
    }),
  );
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

  const mode = aggregationFor(spanOf(points));
  // Rolling best, so light hypertrophy days do not read as strength loss.
  const rolled = rollingBest(e1rm);
  const rawSeries = [
    { name: 'Top set (kg)', color: SERIES_COLORS[0], points },
    { name: 'Est. 1RM, 4-wk best (kg)', color: SERIES_COLORS[1], points: rolled, dashed: true },
  ].filter((s) => s.points.length);
  const series = rawSeries.map((s) => ({ ...s, points: aggregate(s.points, mode) }));

  chartSpecs.set('lift', { title: exerciseName(exId), unit: 'kg', series: rawSeries, xDomain: xDomain() });

  const stats = summarize(points.map((p) => p.y));
  const cur1rm = rolled.length ? rolled[rolled.length - 1].y : null;
  return `
    ${aggNote(mode, points.length)}
    ${chartFig('lift', chartSVG({ series, unit: 'kg', xDomain: xDomain() }))}
    ${legendHTML(series)}
    <p class="stat-line">${points.length} session(s) · ${fmtNum(stats.first)} → ${fmtNum(stats.last)} kg · best ${fmtNum(stats.max)} kg${cur1rm !== null ? ` · est. 1RM ${fmtNum(cur1rm)} kg` : ''}</p>`;
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

  const mode = aggregationFor(spanOf(points));
  const rawSeries = [{ name: 'Distance (km)', color: SERIES_COLORS[2], points }];
  const series = rawSeries.map((s) => ({ ...s, points: aggregate(s.points, mode) }));
  const best = paces.length ? Math.min(...paces) : null;
  const avg = paces.length ? paces.reduce((a, b) => a + b, 0) / paces.length : null;

  chartSpecs.set('lift', { title: exerciseName(exId), unit: 'km', series: rawSeries, yZero: true, xDomain: xDomain() });

  return `
    ${aggNote(mode, points.length)}
    ${chartFig('lift', chartSVG({ series, unit: 'km', yZero: true, xDomain: xDomain() }))}
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
  const mode = aggregationFor(spanOf(points));
  const rawSeries = [{ name: 'Total reps', color: SERIES_COLORS[2], points }];
  const series = rawSeries.map((s) => ({ ...s, points: aggregate(s.points, mode) }));
  chartSpecs.set('lift', { title: exerciseName(exId), unit: 'reps', series: rawSeries, yZero: true, xDomain: xDomain() });
  return `${aggNote(mode, points.length)}${chartFig('lift', chartSVG({ series, unit: 'reps', yZero: true, xDomain: xDomain() }))}`;
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
      const comps = t.shape === 'number' ? [null] : t.primary_series || Object.keys(t.shape);

      if (view.folded.has(typeId)) {
        const last = rs[rs.length - 1];
        const latest = comps.map((c) => fmtNum(c ? last.value[c] : last.value, t.decimals ?? 1)).join('/');
        return `
          <article class="metric-block">
            <h3>${foldHead(typeId, `${esc(t.name)} <span class="unit">${esc(t.unit)}</span>`, `latest ${latest}`)}</h3>
          </article>`;
      }

      const mode = aggregationFor(spanOf(rs.map((r) => ({ x: Date.parse(r.ts) }))));

      const rawSeries = comps.map((c, i) => ({
        name: c ? `${t.name} ${c}` : t.name,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        points: rs.map((r) => ({ x: Date.parse(r.ts), y: c ? r.value[c] : r.value })).filter((p) => Number.isFinite(p.y)),
      })).filter((s) => s.points.length);
      const series = rawSeries.map((s) => ({ ...s, points: aggregate(s.points, mode) }));

      if (!series.length) return '';
      const stats = summarize(series[0].points.map((p) => p.y));

      // Diet adherence as quiet background bars behind weight and BP — the
      // question these charts answer is what bowl adherence did to outcomes.
      let bands = null;
      let rawBands = null;
      if (typeId === 'weight' || typeId === 'bp') {
        for (const ct of dailyCountTypes()) {
          const crs = byType.get(ct.id);
          if (!crs?.length) continue;
          const rawPoints = crs.map((r) => ({ x: Date.parse(r.ts), y: r.value })).filter((p) => Number.isFinite(p.y));
          const points = aggregate(rawPoints, mode);
          if (points.length) {
            bands = { points, max: ct.max ?? 6, name: `${ct.unit}/day` };
            rawBands = { points: rawPoints, max: ct.max ?? 6, name: `${ct.unit}/day` };
          }
          break;
        }
      }

      chartSpecs.set(typeId, {
        title: t.name, unit: t.unit, series: rawSeries,
        refLines: refLinesFor(typeId), bands: rawBands, xDomain: xDomain(),
      });

      return `
        <article class="metric-block">
          <h3>${foldHead(typeId, `${esc(t.name)} <span class="unit">${esc(t.unit)}</span>`, '')}</h3>
          ${aggNote(mode, rs.length)}
          ${chartFig(typeId, chartSVG({ series, unit: t.unit, refLines: refLinesFor(typeId), bands, xDomain: xDomain() }))}
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
