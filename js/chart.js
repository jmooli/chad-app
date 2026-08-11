/**
 * Minimal SVG line chart. No dependencies, no CDN.
 *
 * A charting library would be one more thing that can break, churn or vanish
 * over the decades this data is meant to outlive. Plain SVG also prints at
 * full resolution, which canvas-based libraries do not — and printing is a
 * first-class feature here (the clinical report).
 */

const PAD = { top: 14, right: 14, bottom: 28, left: 46 };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const p = Math.abs(min) * 0.1 || 1;
    min -= p;
    max += p;
  }
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

const DAY = 86400000;

function timeTicks(minMs, maxMs, count = 5) {
  const span = maxMs - minMs;
  const out = [];
  const push = (d) => out.push(d.getTime());

  if (span <= 14 * DAY) {
    const step = Math.max(1, Math.round(span / DAY / count)) * DAY;
    for (let t = minMs; t <= maxMs; t += step) out.push(t);
  } else if (span <= 120 * DAY) {
    const step = Math.max(7, Math.round(span / DAY / count / 7) * 7) * DAY;
    for (let t = minMs; t <= maxMs; t += step) out.push(t);
  } else if (span <= 900 * DAY) {
    const d = new Date(minMs);
    d.setDate(1);
    const stepM = Math.max(1, Math.round(span / DAY / 30 / count));
    while (d.getTime() <= maxMs) {
      if (d.getTime() >= minMs) push(new Date(d));
      d.setMonth(d.getMonth() + stepM);
    }
  } else {
    const d = new Date(minMs);
    d.setMonth(0, 1);
    while (d.getTime() <= maxMs) {
      if (d.getTime() >= minMs) push(new Date(d));
      d.setFullYear(d.getFullYear() + 1);
    }
  }
  return out.length ? out : [minMs, maxMs];
}

function fmtTime(ms, span) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  if (span <= 120 * DAY) return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
  if (span <= 900 * DAY) return `${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
  return String(d.getFullYear());
}

/**
 * series: [{ name, color, points: [{x: epochMs, y: number}], dashed?: bool }]
 * refLines: [{ y, label, color }]
 * bands: { points: [{x, y}], max, name } — a subordinate secondary series
 * drawn as translucent bars along the bottom (≤30% of plot height), so e.g.
 * diet adherence can be read against weight without competing with it.
 * xDomain: [minMs, maxMs] — pin the x-axis to a selected date range instead of
 * the data extent, so the chart answers "what happened in the period I chose",
 * empty stretches included. Data outside the domain still widens it (never clip).
 */
export function chartSVG({ series, width = 640, height = 240, unit = '', refLines = [], yZero = false, showPoints = true, bands = null, xDomain = null }) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) {
    return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="No data">
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">No data in this range</text></svg>`;
  }

  const xs = pts.map((p) => p.x);
  const ysAll = pts.map((p) => p.y).concat(refLines.map((r) => r.y));
  let yMin = Math.min(...ysAll);
  let yMax = Math.max(...ysAll);
  if (yZero) yMin = Math.min(0, yMin);
  const yTicks = niceTicks(yMin, yMax, 5);
  const yLo = Math.min(yTicks[0], yMin);
  const yHi = Math.max(yTicks[yTicks.length - 1], yMax);

  const xMin = Math.min(...xs, ...(xDomain ? [xDomain[0]] : []));
  const xMax = Math.max(...xs, ...(xDomain ? [xDomain[1]] : []));
  const span = Math.max(xMax - xMin, DAY);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const sx = (x) => PAD.left + (xMax === xMin ? plotW / 2 : ((x - xMin) / (xMax - xMin)) * plotW);
  const sy = (y) => PAD.top + plotH - ((y - yLo) / (yHi - yLo || 1)) * plotH;

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" class="chart" role="img">`);

  for (const t of yTicks) {
    const y = sy(t).toFixed(1);
    parts.push(`<line class="grid" x1="${PAD.left}" y1="${y}" x2="${width - PAD.right}" y2="${y}"/>`);
    parts.push(`<text class="tick" x="${PAD.left - 6}" y="${y}" text-anchor="end" dominant-baseline="middle">${esc(t)}</text>`);
  }

  for (const t of timeTicks(xMin, xMax, 5)) {
    const x = sx(t).toFixed(1);
    parts.push(`<text class="tick" x="${x}" y="${height - 8}" text-anchor="middle">${esc(fmtTime(t, span))}</text>`);
  }

  if (bands?.points?.length) {
    const bMax = bands.max || Math.max(...bands.points.map((p) => p.y), 1);
    const bw = Math.min(14, Math.max(3, (plotW / Math.max(bands.points.length, 1)) * 0.55));
    for (const p of bands.points) {
      if (!Number.isFinite(p.y) || p.y < 0) continue;
      const h = (Math.min(p.y, bMax) / bMax) * plotH * 0.3;
      const bx = sx(p.x) - bw / 2;
      parts.push(`<rect class="band" x="${bx.toFixed(1)}" y="${(PAD.top + plotH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"><title>${esc(fmtTime(p.x, span))} — ${esc(Math.round(p.y * 10) / 10)} ${esc(bands.name || '')}</title></rect>`);
    }
  }

  for (const r of refLines) {
    const y = sy(r.y).toFixed(1);
    parts.push(`<line class="refline" style="stroke:${esc(r.color || '#c0392b')}" x1="${PAD.left}" y1="${y}" x2="${width - PAD.right}" y2="${y}"/>`);
    if (r.label) parts.push(`<text class="reflabel" style="fill:${esc(r.color || '#c0392b')}" x="${width - PAD.right}" y="${y - 4}" text-anchor="end">${esc(r.label)}</text>`);
  }

  series.forEach((s) => {
    const ordered = [...s.points].sort((a, b) => a.x - b.x);
    if (!ordered.length) return;
    const d = ordered.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    parts.push(`<path class="series" style="stroke:${esc(s.color)}${s.dashed ? ';stroke-dasharray:4 3' : ''}" d="${d}"/>`);
    if (showPoints && ordered.length <= 120) {
      for (const p of ordered) {
        parts.push(`<circle class="dot" style="fill:${esc(s.color)}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="2.6"><title>${esc(fmtTime(p.x, span))} — ${esc(p.y)}${unit ? ' ' + esc(unit) : ''}</title></circle>`);
      }
    }
  });

  parts.push(`<line class="axis" x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${height - PAD.bottom}"/>`);
  parts.push(`<line class="axis" x1="${PAD.left}" y1="${height - PAD.bottom}" x2="${width - PAD.right}" y2="${height - PAD.bottom}"/>`);
  parts.push('</svg>');
  return parts.join('');
}

export function legendHTML(series) {
  if (series.length < 2) return '';
  return `<div class="legend">${series
    .map((s) => `<span class="legend-item"><i style="background:${esc(s.color)}"></i>${esc(s.name)}</span>`)
    .join('')}</div>`;
}

export const SERIES_COLORS = ['#3b7dd8', '#d8663b', '#3ba55d', '#9b59b6', '#d8b53b', '#2c8c99'];
