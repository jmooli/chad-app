/**
 * Full-screen chart viewer: the same chartSVG sized to the viewport, with
 * direct manipulation of the time axis — drag to pan, pinch or mouse-wheel to
 * zoom, double-tap (or double-click) to reset. There is no separate chart
 * engine here: every gesture just re-renders the SVG with a narrower x-domain,
 * so the inline charts, the printed report and this viewer stay one code path.
 *
 * Aggregation follows the visible span, exactly as on the Progress page:
 * zoom into a monthly-averaged year and the weekly means, then the raw
 * readings, come back.
 */

import { chartSVG, legendHTML, PAD } from './chart.js';
import { aggregationFor, aggregate } from './stats.js';
import { esc } from './ui.js';

const DAY = 86400000;
const MIN_SPAN = 2 * DAY;

const fmtDay = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

/**
 * spec: { title, unit, series, refLines?, bands?, yZero?, xDomain? }
 * series carry RAW (un-aggregated) points — the viewer re-buckets per zoom
 * level. xDomain is the window to open at; double-tap returns to the full
 * data extent, not to it.
 */
export function openChartView(spec) {
  const raw = spec.series.map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.x - b.x) })).filter((s) => s.points.length);
  if (!raw.length) return;

  const xsAll = raw.flatMap((s) => s.points.map((p) => p.x));
  const full = [
    Math.min(...xsAll, ...(spec.xDomain ? [spec.xDomain[0]] : [])),
    Math.max(...xsAll, ...(spec.xDomain ? [spec.xDomain[1]] : [])),
  ];
  if (full[1] - full[0] < MIN_SPAN) {
    full[0] -= MIN_SPAN / 2;
    full[1] += MIN_SPAN / 2;
  }

  const clampWin = (lo, hi) => {
    const span = Math.min(Math.max(hi - lo, MIN_SPAN), full[1] - full[0]);
    lo = Math.min(Math.max(lo, full[0]), full[1] - span);
    return [lo, lo + span];
  };

  let win = spec.xDomain ? clampWin(spec.xDomain[0], spec.xDomain[1]) : [...full];

  /* Buckets are computed over the whole series once per aggregation mode, so
     panning never re-draws bucket boundaries. */
  const aggCache = new Map();
  const bucketed = (points, key, mode) => {
    const k = `${key}:${mode}`;
    if (!aggCache.has(k)) aggCache.set(k, aggregate(points, mode));
    return aggCache.get(k);
  };

  /* Points in the window, plus one neighbour past each edge so lines keep
     running under the clipped border instead of stopping at the last dot. */
  const windowed = (pts) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.x >= win[0] && p.x <= win[1]) out.push(p);
      else if (p.x < win[0] && pts[i + 1] && pts[i + 1].x >= win[0]) out.push(p);
      else if (p.x > win[1] && pts[i - 1] && pts[i - 1].x <= win[1]) out.push(p);
    }
    return out;
  };

  const back = document.createElement('div');
  back.className = 'chartview';
  back.innerHTML = `
    <header class="chartview-head">
      <h2>${esc(spec.title)}${spec.unit ? ` <span class="unit">${esc(spec.unit)}</span>` : ''}</h2>
      <button type="button" class="chartview-close" aria-label="Close full-screen chart">✕</button>
    </header>
    <div class="chartview-stage"></div>
    <footer class="chartview-foot">
      <p class="chartview-range"></p>
      ${legendHTML(raw)}
      <p class="chartview-hint">drag to pan · pinch or scroll to zoom · double-tap for everything</p>
    </footer>`;

  const stage = back.querySelector('.chartview-stage');
  const rangeEl = back.querySelector('.chartview-range');

  const render = () => {
    const w = Math.max(stage.clientWidth, 320);
    const h = Math.max(stage.clientHeight, 220);
    const mode = aggregationFor(win[1] - win[0]);
    const series = raw
      .map((s, i) => ({ ...s, points: windowed(bucketed(s.points, i, mode)) }))
      .filter((s) => s.points.length);
    let bands = null;
    if (spec.bands?.points?.length) {
      const pts = windowed(bucketed([...spec.bands.points].sort((a, b) => a.x - b.x), 'bands', mode));
      if (pts.length) bands = { ...spec.bands, points: pts };
    }
    stage.innerHTML = chartSVG({
      series, width: w, height: h, unit: spec.unit,
      refLines: spec.refLines || [], yZero: !!spec.yZero, bands,
      xDomain: win, clip: true,
    });
    rangeEl.textContent = `${fmtDay(win[0])} – ${fmtDay(win[1])}${mode === 'raw' ? '' : ` · ${mode} averages`}`;
  };

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  };

  const timePerPx = () => (win[1] - win[0]) / Math.max(stage.clientWidth - PAD.left - PAD.right, 1);
  const timeAt = (clientX) => win[0] + (clientX - stage.getBoundingClientRect().left - PAD.left) * timePerPx();

  const panBy = (dt) => {
    const span = win[1] - win[0];
    win = clampWin(win[0] + dt, win[0] + dt + span);
    schedule();
  };
  const zoomAt = (t, factor) => {
    const frac = Math.min(Math.max((t - win[0]) / (win[1] - win[0]), 0), 1);
    const span = (win[1] - win[0]) * factor;
    win = clampWin(t - span * frac, t + span * (1 - frac));
    schedule();
  };

  /* Pointer gestures. One pointer pans; two pinch-zoom around their midpoint. */
  const ptrs = new Map();
  let downX = 0, downT = 0, panned = false, lastTap = 0;

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture?.(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { downX = e.clientX; downT = Date.now(); panned = false; }
    e.preventDefault();
  });

  stage.addEventListener('pointermove', (e) => {
    const prev = ptrs.get(e.pointerId);
    if (!prev) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (Math.abs(e.clientX - downX) > 8) panned = true;
    if (ptrs.size === 1) {
      panBy((prev.x - e.clientX) * timePerPx());
    } else if (ptrs.size === 2) {
      let other = null;
      for (const [id, p] of ptrs) if (id !== e.pointerId) other = p;
      const d0 = Math.hypot(other.x - prev.x, other.y - prev.y);
      const d1 = Math.hypot(other.x - e.clientX, other.y - e.clientY);
      if (d0 > 4 && d1 > 4) zoomAt(timeAt((other.x + e.clientX) / 2), d0 / d1);
    }
  });

  const release = (e) => {
    if (!ptrs.delete(e.pointerId)) return;
    if (ptrs.size === 0 && !panned && Date.now() - downT < 300) {
      if (Date.now() - lastTap < 350) {
        win = [...full];
        schedule();
        lastTap = 0;
      } else {
        lastTap = Date.now();
      }
    }
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(timeAt(e.clientX), e.deltaY > 0 ? 1.25 : 0.8);
  }, { passive: false });

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const onResize = () => schedule();
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    document.body.classList.remove('chartview-open');
  };
  back.querySelector('.chartview-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);

  document.body.classList.add('chartview-open');
  document.body.appendChild(back);
  render();
}
