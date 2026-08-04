/**
 * Clinical report — the view handed across a desk to a doctor.
 *
 * Large type, no gym content, no app chrome, prints to a clean PDF. The
 * presentation lock pins it in place so the phone can be handed over without
 * the recipient landing anywhere else.
 */

import { state, loadYears, knownYears, allReadings, todayISO, dailyCountTypes, mealPlanById } from '../store.js';
import { chartSVG, legendHTML, SERIES_COLORS } from '../chart.js';
import { summarize, partOfDay, fmtNum, fmtDate, fmtDateTime } from '../stats.js';
import { esc, download, csvCell, toast } from '../ui.js';

const view = { types: null, from: null, to: null };

export default async function renderClinical(root, ctx) {
  const years = await knownYears();
  await loadYears(years[0], years[years.length - 1]);

  const today = new Date();
  const yearAgo = new Date(today);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  view.to ??= iso(today);
  view.from ??= iso(yearAgo);

  const present = presentTypes();
  if (!view.types) {
    view.types = new Set(present.filter((t) => t === 'bp' || t === 'weight'));
    if (!view.types.size && present.length) view.types = new Set([present[0]]);
  }

  paint(root, ctx);
}

// Local calendar date — toISOString() would roll back a day before 03:00 in Helsinki.
const iso = (d) => todayISO(d);

function presentTypes() {
  const seen = new Set(allReadings().map((r) => r.type));
  return [...state.types.keys()].filter((id) => seen.has(id));
}

function selectedReadings() {
  const from = Date.parse(view.from + 'T00:00:00');
  const to = Date.parse(view.to + 'T23:59:59');
  return allReadings().filter((r) => view.types.has(r.type) && Date.parse(r.ts) >= from && Date.parse(r.ts) <= to);
}

function paint(root, ctx) {
  const present = presentTypes();
  const readings = selectedReadings();

  root.innerHTML = `
    <section class="clinical">
      <div class="clinical-controls no-print">
        <h1>Clinical report</h1>
        <div class="ctl-types">
          ${present.length
            ? present
                .map((id) => {
                  const t = state.types.get(id);
                  return `<label class="check"><input type="checkbox" data-type="${esc(id)}" ${view.types.has(id) ? 'checked' : ''}> ${esc(t.name)}</label>`;
                })
                .join('')
            : '<p class="muted">No readings recorded yet.</p>'}
        </div>
        <div class="grid-2">
          <div><label for="c-from">From</label><input type="date" id="c-from" value="${esc(view.from)}"></div>
          <div><label for="c-to">To</label><input type="date" id="c-to" value="${esc(view.to)}"></div>
        </div>
        <div class="actions">
          <button class="btn" id="c-csv">Export CSV</button>
          <button class="btn" id="c-lock" title="Hide the controls until a long press on the title">Presentation lock</button>
          <button class="btn btn-primary" id="c-print">Print / PDF</button>
        </div>
      </div>

      <article class="report">
        <header class="report-head" id="report-head">
          <h2>Health readings</h2>
          <p>${esc(fmtDate(view.from))} – ${esc(fmtDate(view.to))}</p>
          ${mealSummaryLines()}
          <p class="unlock-hint no-print" hidden>Press and hold this heading to unlock</p>
        </header>
        ${view.types.size
          ? [...view.types].map((id) => blockHTML(id, readings.filter((r) => r.type === id))).join('')
          : '<p class="muted">Select at least one measurement.</p>'}
        <footer class="report-foot">Self-recorded measurements. Generated ${esc(fmtDate(iso(new Date())))}.</footer>
      </article>
    </section>`;

  wire(root, ctx);
}

/**
 * One line per meal plan that overlaps the reporting period: what the diet
 * phase was, and how consistently it was followed — so the doctor can read
 * lipids and BP against it without a food diary.
 */
function mealSummaryLines() {
  const lines = [];
  for (const t of dailyCountTypes()) {
    const p = mealPlanById(t.plan_ref);
    if (!p) continue;
    const from = view.from > p.started ? view.from : p.started;
    const to = p.status === 'ended' && p.planned_end && p.planned_end < view.to ? p.planned_end : view.to;
    if (from > to) continue;

    const days = Math.round((Date.parse(to + 'T12:00:00') - Date.parse(from + 'T12:00:00')) / 86400000) + 1;
    const byDay = new Map();
    for (const r of allReadings()) {
      if (r.type !== t.id) continue;
      const d = r.ts.slice(0, 10);
      if (d >= from && d <= to) byDay.set(d, r.value);
    }
    const logged = byDay.size;
    const mean = logged ? [...byDay.values()].reduce((a, b) => a + b, 0) / logged : null;
    const pct = days ? Math.round((logged / days) * 100) : 0;

    lines.push(`<p class="report-plan">${esc(p.name)} — ${esc(p.status)} ${esc(fmtDate(from))} – ${esc(fmtDate(to))} · ${
      mean === null ? 'no days logged' : `mean ${esc(fmtNum(mean, 1))} ${esc(t.unit)}/day`
    } · ${esc(pct)}% of days logged (${esc(logged)}/${esc(days)})</p>`);
  }
  return lines.join('');
}

function blockHTML(typeId, readings) {
  const t = state.types.get(typeId);
  if (!t) return '';
  if (!readings.length) return `<div class="report-block"><h3>${esc(t.name)}</h3><p class="muted">No readings in this period.</p></div>`;

  const comps = t.shape === 'number' ? [null] : t.primary_series || Object.keys(t.shape);
  const series = comps.map((c, i) => ({
    name: c || t.name,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    points: readings.map((r) => ({ x: Date.parse(r.ts), y: c ? r.value[c] : r.value })).filter((p) => Number.isFinite(p.y)),
  }));

  return `
    <div class="report-block">
      <h3>${esc(t.name)} <span class="unit">(${esc(t.unit)})</span></h3>
      ${chartSVG({ series, unit: t.unit, height: 260, refLines: typeId === 'bp' ? [{ y: 140, label: '140' }, { y: 90, label: '90' }] : [] })}
      ${legendHTML(series)}
      ${summaryHTML(typeId, t, readings, comps)}
      ${tableHTML(t, readings, comps)}
    </div>`;
}

function summaryHTML(typeId, t, readings, comps) {
  const dec = t.decimals ?? 1;
  const rows = [];

  const statFor = (subset, label) => {
    if (!subset.length) return;
    const cells = comps.map((c) => {
      const s = summarize(subset.map((r) => (c ? r.value[c] : r.value)));
      return s ? `${fmtNum(s.mean, dec)}` : '–';
    });
    const range = comps.map((c) => {
      const s = summarize(subset.map((r) => (c ? r.value[c] : r.value)));
      return s ? `${fmtNum(s.min, dec)}–${fmtNum(s.max, dec)}` : '–';
    });
    rows.push(`<tr><th>${esc(label)}</th><td>${subset.length}</td><td class="num">${esc(cells.join(' / '))}</td><td class="num">${esc(range.join(' / '))}</td></tr>`);
  };

  statFor(readings, 'All readings');

  // Blood pressure is not interpretable without separating time of day.
  if (typeId === 'bp') {
    const morning = readings.filter((r) => partOfDay(r).period === 'morning');
    const evening = readings.filter((r) => partOfDay(r).period === 'evening');
    statFor(morning, 'Morning');
    statFor(evening, 'Evening');
    const inferred = readings.filter((r) => partOfDay(r).inferred).length;
    if (inferred) {
      rows.push(`<tr class="footnote"><td colspan="4">${inferred} reading(s) had no morning/evening tag; time of day inferred from the clock.</td></tr>`);
    }
  }

  const half = Math.floor(readings.length / 2);
  if (readings.length >= 6) {
    statFor(readings.slice(0, half), 'First half of period');
    statFor(readings.slice(half), 'Second half of period');
  }

  return `
    <table class="summary-table">
      <thead><tr><th>Period</th><th>n</th><th class="num">Mean${comps[0] ? ` (${esc(comps.join('/'))})` : ''}</th><th class="num">Range</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function tableHTML(t, readings, comps) {
  const dec = t.decimals ?? 1;
  return `
    <table class="reading-table">
      <thead><tr><th>Date</th><th class="num">${comps.map((c) => esc(c || 'Value')).join(' / ')}</th><th>Notes</th></tr></thead>
      <tbody>
        ${[...readings]
          .reverse()
          .map((r) => {
            const vals = comps.map((c) => fmtNum(c ? r.value[c] : r.value, dec)).join(' / ');
            const extras = [...(r.tags || []), r.note].filter(Boolean).join(', ');
            return `<tr><td>${esc(fmtDateTime(r.ts))}</td><td class="num">${esc(vals)}</td><td>${esc(extras)}</td></tr>`;
          })
          .join('')}
      </tbody>
    </table>`;
}

/* --- interaction -------------------------------------------------------- */

function wire(root, ctx) {
  root.querySelectorAll('[data-type]').forEach((cb) =>
    cb.addEventListener('change', () => {
      if (cb.checked) view.types.add(cb.dataset.type);
      else view.types.delete(cb.dataset.type);
      paint(root, ctx);
    }),
  );

  root.querySelector('#c-from')?.addEventListener('change', (e) => {
    view.from = e.target.value;
    paint(root, ctx);
  });
  root.querySelector('#c-to')?.addEventListener('change', (e) => {
    view.to = e.target.value;
    paint(root, ctx);
  });

  root.querySelector('#c-print')?.addEventListener('click', () => window.print());

  root.querySelector('#c-csv')?.addEventListener('click', () => {
    const readings = selectedReadings();
    if (!readings.length) {
      toast('Nothing to export in this range.', 'warn');
      return;
    }
    download(`health-${view.from}_${view.to}.csv`, toCSV(readings));
  });

  root.querySelector('#c-lock')?.addEventListener('click', () => {
    document.body.classList.add('locked');
    root.querySelector('.unlock-hint').hidden = false;
    toast('Locked. Press and hold the heading to unlock.', 'ok', 5000);
  });

  // Long-press to unlock: deliberately awkward, so a handed-over phone stays put.
  const head = root.querySelector('#report-head');
  let timer = null;
  const start = () => {
    if (!document.body.classList.contains('locked')) return;
    timer = setTimeout(() => {
      document.body.classList.remove('locked');
      root.querySelector('.unlock-hint').hidden = true;
      toast('Unlocked.');
    }, 1500);
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  ['pointerdown'].forEach((ev) => head.addEventListener(ev, start));
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => head.addEventListener(ev, cancel));
}

function toCSV(readings) {
  const header = ['timestamp', 'metric', 'component', 'value', 'unit', 'source', 'tags', 'note'];
  const rows = [header.join(',')];
  for (const r of readings) {
    const t = state.types.get(r.type);
    const unit = t?.unit || '';
    const tags = (r.tags || []).join(' ');
    if (t && t.shape !== 'number' && r.value && typeof r.value === 'object') {
      for (const [k, v] of Object.entries(r.value)) {
        rows.push([r.ts, r.type, k, v, unit, r.src, tags, r.note || ''].map(csvCell).join(','));
      }
    } else {
      rows.push([r.ts, r.type, '', r.value, unit, r.src, tags, r.note || ''].map(csvCell).join(','));
    }
  }
  return rows.join('\r\n');
}
