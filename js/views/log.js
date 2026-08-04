/**
 * Log — the history, plus the form for adding health readings.
 *
 * Sessions and readings share one reverse-chronological timeline, because that
 * is how they are actually recalled ("what was I doing the week my BP spiked?").
 */

import {
  state, loadYears, knownYears, allSessions, allReadings, saveReading, deleteReading,
  deleteSession, knownTags, exerciseName, isoWithOffset, todayISO,
  dailyCountTypes, dailyReadingFor, saveDailyCount, mealPlanById,
} from '../store.js';
import { validateReading, warnReading } from '../schema.js';
import { esc, toast, setBusy, on, numOrUndef, confirmAction } from '../ui.js';
import { fmtDate, fmtDateTime, fmtNum } from '../stats.js';
import { loadForEdit } from './today.js';

const form = { type: 'weight', tags: new Set(), when: null };

export default async function renderLog(root, ctx) {
  const years = await knownYears();
  await loadYears(years[0], years[years.length - 1]);
  paint(root, ctx);
}

function paint(root, ctx) {
  const items = timeline();

  root.innerHTML = `
    <section class="log">
      <h1>Log</h1>

      ${countersHTML()}

      <details class="add-reading" ${items.length ? '' : 'open'}>
        <summary>Add a health reading</summary>
        <div id="reading-form"></div>
      </details>

      <h2 class="section-head">History</h2>
      ${items.length ? `<ul class="timeline">${items.map(itemHTML).join('')}</ul>` : '<p class="muted">Nothing logged yet.</p>'}
    </section>`;

  paintReadingForm(root, ctx);
  wireCounters(root, ctx);
  wireTimeline(root, ctx);
}

/* --- daily counters (bowl-count) ----------------------------------------- *
 * One tap logs the day's count — this is the adherence signal for the whole
 * meal plan, so it has to be as low-friction as a weight entry. The plan
 * ceiling (0–warn_above) is prominent; values above it stay one tap away but
 * are styled as the exception they are.
 */

function countersHTML() {
  const counters = dailyCountTypes().filter((t) => (mealPlanById(t.plan_ref)?.status ?? 'active') === 'active');
  if (!counters.length) return '';
  return counters.map((t) => {
    const current = dailyReadingFor(t.id, todayISO())?.value;
    const max = t.max ?? 6;
    const ceiling = t.warn_above ?? max;
    const buttons = [];
    for (let v = t.min ?? 0; v <= max; v++) {
      buttons.push(`<button class="counter-btn ${v === current ? 'on' : ''} ${v > ceiling ? 'over' : ''}" data-count-type="${esc(t.id)}" data-v="${v}">${v}</button>`);
    }
    return `
      <div class="counter-card">
        <div class="counter-head">
          <strong>${esc(t.name)}</strong>
          <span class="muted">today${current !== undefined ? ` · ${esc(current)} logged` : ''}</span>
        </div>
        <div class="counter-row" role="group" aria-label="${esc(t.name)} today">${buttons.join('')}</div>
      </div>`;
  }).join('');
}

function wireCounters(root, ctx) {
  on(root, 'click', '.counter-btn', async (e, btn) => {
    const typeId = btn.dataset.countType;
    const value = Number(btn.dataset.v);
    const type = state.types.get(typeId);
    if (dailyReadingFor(typeId, todayISO())?.value === value) return;
    for (const w of warnReading({ type: typeId, value }, state.types)) toast(w, 'warn', 5000);
    setBusy(true);
    try {
      await saveDailyCount(typeId, value);
      toast(`${type?.name || typeId}: ${value} logged for today.`);
      paint(root, ctx);
    } catch (err) {
      ctx.handleError(err);
    } finally {
      setBusy(false);
    }
  });
}

/* --- timeline ----------------------------------------------------------- */

function timeline() {
  const sessions = allSessions().map((s) => ({ kind: 'session', when: s.date + 'T23:59', data: s }));
  const readings = allReadings().map((r) => ({ kind: 'reading', when: r.ts, data: r }));
  return [...sessions, ...readings].sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
}

function itemHTML(item, i) {
  if (item.kind === 'session') {
    const s = item.data;
    return `
      <li class="tl tl-session" data-i="${i}">
        <div class="tl-when">${esc(fmtDate(s.date))}</div>
        <div class="tl-body">
          <div class="tl-head">
            <strong>Day ${esc(s.day)}</strong>
            ${s.duration_min ? `<span class="muted">${esc(s.duration_min)} min</span>` : ''}
            <span class="tl-actions">
              <button class="link" data-act="edit-session" data-i="${i}">Edit</button>
              <button class="link danger" data-act="del-session" data-i="${i}">Delete</button>
            </span>
          </div>
          <ul class="tl-ex">
            ${s.exercises.map((e) => `<li><span class="ex">${esc(exerciseName(e.ex))}</span> <span class="sets">${esc(e.sets.map(setSummary).join(', '))}</span></li>`).join('')}
          </ul>
          ${s.notes ? `<p class="tl-note">${esc(s.notes)}</p>` : ''}
        </div>
      </li>`;
  }

  const r = item.data;
  const t = state.types.get(r.type);
  return `
    <li class="tl tl-reading" data-i="${i}">
      <div class="tl-when">${esc(fmtDateTime(r.ts))}</div>
      <div class="tl-body">
        <div class="tl-head">
          <strong>${esc(t?.name || r.type)}</strong>
          <span class="value">${esc(valueText(r, t))}</span>
          <span class="tl-actions">
            ${r.src !== 'manual' ? `<span class="badge badge-muted">${esc(r.src)}</span>` : ''}
            <button class="link danger" data-act="del-reading" data-i="${i}">Delete</button>
          </span>
        </div>
        ${(r.tags || []).length ? `<p class="tl-tags">${r.tags.map((x) => `<span class="chip chip-static">${esc(x)}</span>`).join('')}</p>` : ''}
        ${r.note ? `<p class="tl-note">${esc(r.note)}</p>` : ''}
      </div>
    </li>`;
}

const setSummary = (s) => {
  if (s.km !== undefined) {
    const time = s.secs ? ` in ${Math.round(s.secs / 60)} min` : '';
    return `${s.km} km${time}${s.rpe ? ` @${s.rpe}` : ''}`;
  }
  const load = typeof s.kg === 'number' ? `${s.kg}kg × ` : '';
  const amount = s.secs !== undefined ? `${s.secs}s` : `${s.reps}`;
  return `${load}${amount}${s.to_failure ? '!' : ''}${s.rpe ? ` @${s.rpe}` : ''}`;
};

export function valueText(r, t) {
  const type = t || state.types.get(r.type);
  if (!type) return JSON.stringify(r.value);
  if (type.shape === 'number') return `${fmtNum(r.value, type.decimals ?? 1)} ${type.unit}`;
  const keys = type.primary_series || Object.keys(type.shape);
  const main = keys.map((k) => fmtNum(r.value[k], type.decimals ?? 0)).join('/');
  const extra = Object.keys(type.shape)
    .filter((k) => !keys.includes(k) && r.value[k] !== undefined)
    .map((k) => `${k} ${fmtNum(r.value[k], 0)}`);
  return `${main} ${type.unit}${extra.length ? ` · ${extra.join(', ')}` : ''}`;
}

function wireTimeline(root, ctx) {
  const items = timeline();

  on(root, 'click', '[data-act]', async (e, btn) => {
    const item = items[Number(btn.dataset.i)];
    if (!item) return;

    if (btn.dataset.act === 'edit-session') {
      loadForEdit(item.data);
      ctx.navigate('today');
      return;
    }
    if (btn.dataset.act === 'del-session') {
      const s = item.data;
      if (!(await confirmAction(`Delete the session on ${fmtDate(s.date)} (day ${s.day})? It stays in git history.`, { danger: true, okLabel: 'Delete' }))) return;
      setBusy(true);
      try {
        await deleteSession(s);
        toast('Session deleted.');
        paint(root, ctx);
      } catch (err) {
        ctx.handleError(err);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (btn.dataset.act === 'del-reading') {
      const r = item.data;
      if (!(await confirmAction(`Delete this ${state.types.get(r.type)?.name || r.type} reading? It stays in git history.`, { danger: true, okLabel: 'Delete' }))) return;
      setBusy(true);
      try {
        await deleteReading(r);
        toast('Reading deleted.');
        paint(root, ctx);
      } catch (err) {
        ctx.handleError(err);
      } finally {
        setBusy(false);
      }
    }
  });
}

/* --- reading form ------------------------------------------------------- */

const localDateTimeValue = (d = new Date()) => isoWithOffset(d).slice(0, 16);

function paintReadingForm(root, ctx) {
  const host = root.querySelector('#reading-form');
  const type = state.types.get(form.type) || [...state.types.values()][0];
  form.type = type.id;
  const components = type.shape === 'number' ? [null] : Object.keys(type.shape);
  const required = new Set(type.primary_series || (type.shape === 'number' ? [] : Object.keys(type.shape)));
  const srcDefault = type.id.startsWith('lab.') ? 'lab' : 'manual';

  host.innerHTML = `
    <div class="grid-2">
      <div>
        <label for="r-type">Metric</label>
        <select id="r-type">
          ${[...state.types.values()].map((t) => `<option value="${esc(t.id)}" ${t.id === type.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label for="r-when">When</label>
        <input type="datetime-local" id="r-when" value="${esc(form.when || localDateTimeValue())}">
      </div>
    </div>

    <div class="values ${components.length > 1 ? 'grid-3' : ''}">
      ${components
        .map((c) =>
          c === null
            ? `<div><label for="r-value">Value (${esc(type.unit)})</label><input id="r-value" inputmode="decimal" autocomplete="off"></div>`
            : `<div><label for="r-${esc(c)}">${esc(c)}${required.has(c) ? '' : ' (optional)'}</label><input id="r-${esc(c)}" data-comp="${esc(c)}" inputmode="decimal" autocomplete="off"></div>`,
        )
        .join('')}
    </div>

    <label>Tags</label>
    <div class="chips" id="r-tags">
      ${knownTags().map((t) => `<button type="button" class="chip ${form.tags.has(t) ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
      <input id="r-newtag" class="chip-input" placeholder="+ tag" aria-label="Add a tag">
    </div>

    <div class="grid-2">
      <div>
        <label for="r-note">Note</label>
        <input id="r-note" placeholder="optional">
      </div>
      <div>
        <label for="r-src">Source</label>
        <select id="r-src">
          ${[...state.sources.values()].map((s) => `<option value="${esc(s.id)}" ${s.id === srcDefault ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" id="r-save">Save reading</button>
    </div>`;

  host.querySelector('#r-type').addEventListener('change', (e) => {
    form.type = e.target.value;
    form.when = host.querySelector('#r-when').value;
    paintReadingForm(root, ctx);
  });

  on(host, 'click', '[data-tag]', (e, btn) => {
    const tag = btn.dataset.tag;
    if (form.tags.has(tag)) form.tags.delete(tag);
    else form.tags.add(tag);
    btn.classList.toggle('on');
  });

  host.querySelector('#r-newtag').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const tag = e.target.value.trim().toLowerCase();
    if (!tag) return;
    form.tags.add(tag);
    e.target.value = '';
    form.when = host.querySelector('#r-when').value;
    paintReadingForm(root, ctx);
  });

  host.querySelector('#r-save').addEventListener('click', async () => {
    const when = host.querySelector('#r-when').value;
    if (!when) {
      toast('Pick a date and time.', 'error');
      return;
    }
    // The When input has minute resolution, so back-to-back readings of the
    // same type can collide on the (ts, type, src) natural key the validator
    // enforces. On collision, borrow the wall clock's seconds to stay unique.
    const src = host.querySelector('#r-src').value;
    let ts = isoWithOffset(new Date(when));
    const clashes = (t) => allReadings().some((r) => r.ts === t && r.type === type.id && r.src === src);
    if (clashes(ts)) {
      const d = new Date(when);
      d.setSeconds(new Date().getSeconds() || 30);
      ts = isoWithOffset(d);
      if (clashes(ts)) {
        toast('A reading of this type already exists at that exact time — adjust the time.', 'error', 5000);
        return;
      }
    }
    const reading = {
      ts,
      type: type.id,
      value: type.shape === 'number'
        ? numOrUndef(host.querySelector('#r-value').value)
        : Object.fromEntries(
            [...host.querySelectorAll('[data-comp]')]
              .map((el) => [el.dataset.comp, numOrUndef(el.value)])
              .filter(([, v]) => v !== undefined),
          ),
      src,
    };
    if (form.tags.size) reading.tags = [...form.tags];
    const note = host.querySelector('#r-note').value.trim();
    if (note) reading.note = note;

    const errors = validateReading(reading, { types: state.types, sourceIds: new Set(state.sources.keys()) });
    if (errors.length) {
      toast(errors[0], 'error', 5000);
      return;
    }
    for (const w of warnReading(reading, state.types)) toast(w, 'warn', 5000);

    setBusy(true);
    try {
      await saveReading(reading);
      toast('Reading saved.');
      form.tags.clear();
      form.when = null;
      paint(root, ctx);
    } catch (err) {
      ctx.handleError(err);
    } finally {
      setBusy(false);
    }
  });
}
