/**
 * Today — the gym screen.
 *
 * Works out which rotation day is next, pre-fills every set from the last time
 * that exercise came up plus the plan's progression increment, and asks for
 * confirmation rather than data entry. Standing at a rack, the fast path
 * should be: open, glance, tap save.
 */

import { state, loadYears, saveSession, replaceSession, suggestSets, exerciseName, nextRotationDay, todayISO, lastSessionWith, allSessions } from '../store.js';
import { validateSession } from '../schema.js';
import { esc, toast, setBusy, on, numOrUndef, intOrUndef, confirmAction } from '../ui.js';
import { fmtDate } from '../stats.js';

let draft = null;
let editing = null; // the original record, when editing an existing session

/** Called from the Log view: open an existing session for correction. */
export function loadForEdit(session) {
  editing = session;
  draft = draftFromSession(session);
}

export default async function renderToday(root, { navigate, handleError }) {
  const year = new Date().getFullYear();
  await loadYears(year - 1, year);

  if (!draft) draft = buildDraft(nextRotationDay());
  paint(root, { navigate, handleError });
}

/* --- draft construction ------------------------------------------------- */

function planEntriesFor(day) {
  return state.plan?.days?.[day]?.exercises || [];
}

/**
 * How a set is entered: distance and time for cardio, seconds for timed holds,
 * otherwise weight and reps. Cardio comes from the registry; timed holds are
 * inferred from history rather than hardcoded, so a new one needs no code.
 */
function modeFor(exId) {
  if (state.exercises.get(exId)?.equipment === 'cardio') return 'cardio';
  const prev = lastSessionWith(exId);
  const sets = prev?.exercises.find((e) => e.ex === exId)?.sets || [];
  return sets.length > 0 && sets.every((s) => s.secs !== undefined && s.km === undefined) ? 'secs' : 'reps';
}

export const repRange = ([min, max]) => (min === max ? `${min}` : `${min}–${max}`);

function cardFromPlan(entry, day) {
  const s = suggestSets(entry, day);
  const mode = modeFor(entry.ex);
  return {
    ex: entry.ex,
    target: `${entry.sets} × ${repRange(entry.reps)}`,
    increment: entry.increment_kg,
    warmup: entry.warmup,
    note: entry.note,
    basis: s.basis,
    prevDate: s.prevDate,
    prevSets: s.prevSets,
    mode,
    sets: s.sets.map((x) => (mode === 'reps' ? { kg: x.kg, reps: x.reps } : {})),
  };
}

function cardAdHoc(exId) {
  const prev = lastSessionWith(exId);
  const prevSets = prev?.exercises.find((e) => e.ex === exId)?.sets || [];
  const mode = modeFor(exId);

  // Cardio repeats the last bout as a starting point — one line, not three.
  if (mode === 'cardio') {
    const last = prevSets[prevSets.length - 1] || {};
    return {
      ex: exId, target: null, mode,
      basis: prev ? 'repeat last outing' : 'no previous outing',
      prevDate: prev?.date || null, prevSets,
      sets: [{ km: last.km, secs: last.secs }],
    };
  }

  const kg = prevSets.map((s) => s.kg).filter((k) => typeof k === 'number');
  return {
    ex: exId,
    target: null,
    basis: prev ? 'repeat last load' : 'no previous session',
    prevDate: prev?.date || null,
    prevSets,
    mode,
    sets: Array.from({ length: Math.max(1, prevSets.length || 3) }, () =>
      mode === 'secs' ? {} : { kg: kg.length ? Math.max(...kg) : undefined, reps: prevSets[0]?.reps }),
  };
}

function buildDraft(day) {
  return {
    date: todayISO(),
    day: day || 'X',
    duration_min: '',
    notes: '',
    cards: planEntriesFor(day).map((entry) => cardFromPlan(entry, day)),
  };
}

function draftFromSession(s) {
  return {
    date: s.date,
    day: s.day,
    duration_min: s.duration_min ?? '',
    notes: s.notes ?? '',
    cards: s.exercises.map((e) => ({
      ex: e.ex,
      target: null,
      basis: 'as logged',
      prevDate: null,
      prevSets: [],
      mode: e.sets.some((x) => x.km !== undefined) ? 'cardio'
        : e.sets.every((x) => x.secs !== undefined) ? 'secs' : 'reps',
      sets: e.sets.map((x) => ({ ...x })),
    })),
  };
}

/* --- rendering ---------------------------------------------------------- */

function paint(root, ctx) {
  const letters = state.plan ? Object.keys(state.plan.days) : [];
  const planned = planEntriesFor(draft.day);
  const existing = allSessions().filter((s) => s.date === draft.date);

  root.innerHTML = `
    <section class="today">
      <div class="head-row">
        <h1>${editing ? 'Edit session' : 'Today'}</h1>
        <div class="head-controls">
          <input type="date" id="date" value="${esc(draft.date)}" aria-label="Session date">
          <select id="day" aria-label="Rotation day">
            ${letters.map((l) => `<option value="${esc(l)}" ${l === draft.day ? 'selected' : ''}>Day ${esc(l)}</option>`).join('')}
            <option value="X" ${draft.day === 'X' ? 'selected' : ''}>Off-plan</option>
          </select>
        </div>
      </div>

      ${editing ? `<p class="notice">Correcting the session logged on ${esc(fmtDate(editing.date))}. Saving replaces it in one commit.</p>` : ''}
      ${!editing && existing.length ? `<p class="notice">A session is already logged for ${esc(fmtDate(draft.date))} (day ${esc(existing[0].day)}). Saving adds a second one.</p>` : ''}
      ${!planned.length && draft.day !== 'X' ? `<p class="notice">The plan has no exercises for day ${esc(draft.day)} yet. Add them below, or fill in <a href="#/plan">the plan</a>.</p>` : ''}

      <div id="cards">${draft.cards.map(cardHTML).join('')}</div>

      <div class="add-ex">
        <select id="add-ex-select" aria-label="Add an exercise">
          <option value="">Add an exercise…</option>
          ${[...state.exercises.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`)
            .join('')}
        </select>
      </div>

      <div class="grid-2 session-meta">
        <div>
          <label for="duration">Duration (min)</label>
          <input id="duration" inputmode="numeric" value="${esc(draft.duration_min)}" placeholder="55">
        </div>
        <div>
          <label for="notes">Notes</label>
          <input id="notes" value="${esc(draft.notes)}" placeholder="How it felt">
        </div>
      </div>

      <div class="actions">
        <button class="btn" id="reset">${editing ? 'Cancel edit' : 'Reset'}</button>
        <button class="btn btn-primary" id="save">${editing ? 'Save changes' : 'Save session'}</button>
      </div>
    </section>`;

  wire(root, ctx);
}

function cardHTML(card, i) {
  const ex = state.exercises.get(card.ex);
  const bodyweight = ex?.equipment === 'bodyweight';
  const prev = card.prevSets?.length
    ? `Last ${fmtDate(card.prevDate)}: ${card.prevSets.map(setSummary).join(', ')}`
    : 'No previous session logged';

  return `
    <article class="ex-card" data-card="${i}">
      <header>
        <h2>${esc(exerciseName(card.ex))}</h2>
        <button class="icon-btn" data-act="del-card" title="Remove exercise" aria-label="Remove ${esc(exerciseName(card.ex))}">×</button>
      </header>
      <p class="meta">
        ${card.target ? `<span class="target">${esc(card.target)}</span>` : ''}
        <span class="basis">${esc(card.basis)}</span>
        ${card.increment ? `<span class="inc">+${esc(card.increment)} kg steps</span>` : ''}
      </p>
      <p class="prev">${esc(prev)}</p>
      ${card.note ? `<p class="warmup">${esc(card.note)}</p>` : ''}
      ${card.warmup ? `<p class="warmup">Warm-up: ${esc(card.warmup)}</p>` : ''}
      <div class="sets">
        ${card.sets.map((s, j) => setHTML(s, j, card.mode, bodyweight)).join('')}
      </div>
      <div class="card-actions">
        <button class="btn btn-small" data-act="add-set">${card.mode === 'cardio' ? 'Add leg' : 'Add set'}</button>
        ${card.mode === 'cardio' ? '' : `<button class="btn btn-small" data-act="toggle-units">${card.mode === 'secs' ? 'Use reps' : 'Use seconds'}</button>`}
      </div>
    </article>`;
}

function setHTML(s, j, mode, bodyweight) {
  // Cardio is entered in minutes because that is how it is remembered; it is
  // stored in seconds, like every other duration in the format.
  if (mode === 'cardio') {
    return `
      <div class="set" data-set="${j}">
        <span class="set-n">${j + 1}</span>
        <input class="km" inputmode="decimal" placeholder="km" value="${s.km ?? ''}" aria-label="Distance in kilometres, leg ${j + 1}">
        <input class="min" inputmode="decimal" placeholder="min" value="${s.secs === undefined ? '' : Math.round((s.secs / 60) * 10) / 10}" aria-label="Minutes, leg ${j + 1}">
        <button class="icon-btn" data-act="more" aria-expanded="false" aria-label="More options, leg ${j + 1}">⋯</button>
        <div class="set-more" hidden>
          <label>RPE <input class="rpe" inputmode="decimal" value="${s.rpe ?? ''}" placeholder="1–10"></label>
          <button class="btn btn-small btn-danger" data-act="del-set">Remove</button>
        </div>
      </div>`;
  }
  return `
    <div class="set" data-set="${j}">
      <span class="set-n">${j + 1}</span>
      <input class="kg" inputmode="decimal" placeholder="${bodyweight ? '+kg' : 'kg'}" value="${s.kg ?? ''}" aria-label="Weight, set ${j + 1}">
      ${mode === 'secs'
        ? `<input class="secs" inputmode="numeric" placeholder="sec" value="${s.secs ?? ''}" aria-label="Seconds, set ${j + 1}">`
        : `<input class="reps" inputmode="numeric" placeholder="reps" value="${s.reps ?? ''}" aria-label="Reps, set ${j + 1}">`}
      <button class="icon-btn" data-act="more" aria-expanded="false" aria-label="More options, set ${j + 1}">⋯</button>
      <div class="set-more" hidden>
        <label>RPE <input class="rpe" inputmode="decimal" value="${s.rpe ?? ''}" placeholder="1–10"></label>
        <label class="check"><input type="checkbox" class="fail" ${s.to_failure ? 'checked' : ''}> to failure</label>
        <button class="btn btn-small btn-danger" data-act="del-set">Remove set</button>
      </div>
    </div>`;
}

const setSummary = (s) => {
  if (s.km !== undefined) return `${s.km} km${s.secs ? ` in ${Math.round(s.secs / 60)} min` : ''}`;
  const load = typeof s.kg === 'number' ? `${s.kg}kg × ` : '';
  const amount = s.secs !== undefined ? `${s.secs}s` : `${s.reps}`;
  return `${load}${amount}${s.to_failure ? '!' : ''}`;
};

/* --- interaction -------------------------------------------------------- */

function readForm(root) {
  draft.date = root.querySelector('#date').value || draft.date;
  draft.day = root.querySelector('#day').value;
  draft.duration_min = root.querySelector('#duration').value;
  draft.notes = root.querySelector('#notes').value;

  root.querySelectorAll('.ex-card').forEach((cardEl) => {
    const card = draft.cards[Number(cardEl.dataset.card)];
    card.sets = [...cardEl.querySelectorAll('.set')].map((setEl) => {
      const minutes = numOrUndef(setEl.querySelector('.min')?.value);
      return {
        kg: numOrUndef(setEl.querySelector('.kg')?.value),
        km: numOrUndef(setEl.querySelector('.km')?.value),
        reps: intOrUndef(setEl.querySelector('.reps')?.value),
        secs: minutes !== undefined ? Math.round(minutes * 60) : numOrUndef(setEl.querySelector('.secs')?.value),
        rpe: numOrUndef(setEl.querySelector('.rpe')?.value),
        to_failure: setEl.querySelector('.fail')?.checked || undefined,
      };
    });
  });
}

function wire(root, ctx) {
  const repaint = () => paint(root, ctx);

  // Anything the owner types marks the draft dirty. Pre-filled suggestions do
  // not count — otherwise switching day would never reload the plan's exercises.
  root.querySelector('#cards').addEventListener('input', () => {
    draft.dirty = true;
  });

  root.querySelector('#day').addEventListener('change', async (e) => {
    const previous = draft.day;
    const day = e.target.value;
    readForm(root);
    if (draft.dirty && !(await confirmAction(`Switch to day ${day}? The sets you have entered will be replaced.`, { okLabel: 'Switch' }))) {
      draft.day = previous;
      e.target.value = previous;
      return;
    }
    const date = draft.date;
    draft = buildDraft(day);
    draft.date = date;
    repaint();
  });

  root.querySelector('#date').addEventListener('change', () => {
    readForm(root);
    repaint();
  });

  root.querySelector('#add-ex-select').addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;
    readForm(root);
    draft.cards.push(cardAdHoc(id));
    repaint();
  });

  on(root, 'click', '[data-act]', async (e, btn) => {
    const act = btn.dataset.act;
    const cardEl = btn.closest('.ex-card');
    const card = cardEl ? draft.cards[Number(cardEl.dataset.card)] : null;

    if (act === 'more') {
      const more = btn.closest('.set').querySelector('.set-more');
      const open = more.hidden;
      more.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      return;
    }
    readForm(root);
    if (act === 'add-set') {
      const last = card.sets[card.sets.length - 1] || {};
      card.sets.push(
        card.mode === 'cardio' ? { km: last.km, secs: last.secs }
          : card.mode === 'secs' ? { secs: last.secs }
            : { kg: last.kg, reps: last.reps },
      );
      repaint();
    } else if (act === 'del-set') {
      const j = Number(btn.closest('.set').dataset.set);
      card.sets.splice(j, 1);
      if (!card.sets.length) card.sets.push({});
      repaint();
    } else if (act === 'del-card') {
      draft.cards.splice(Number(cardEl.dataset.card), 1);
      repaint();
    } else if (act === 'toggle-units') {
      card.mode = card.mode === 'secs' ? 'reps' : 'secs';
      card.sets = card.sets.map(() => ({}));
      repaint();
    }
  });

  root.querySelector('#reset').addEventListener('click', async () => {
    const msg = editing ? 'Discard these changes?' : 'Discard this session draft?';
    if (!(await confirmAction(msg, { danger: true, okLabel: 'Discard' }))) return;
    editing = null;
    draft = buildDraft(nextRotationDay());
    repaint();
  });

  root.querySelector('#save').addEventListener('click', async () => {
    readForm(root);
    const session = toSession(draft);
    const errors = validateSession(session, { exerciseIds: new Set(state.exercises.keys()) });
    if (errors.length) {
      toast(errors[0], 'error', 5000);
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await replaceSession(editing, session);
        toast(`Updated — ${fmtDate(session.date)} day ${session.day}.`);
        editing = null;
      } else {
        await saveSession(session);
        toast(`Saved — ${fmtDate(session.date)} day ${session.day}.`);
      }
      draft = null;
      ctx.navigate('log');
    } catch (err) {
      ctx.handleError(err);
    } finally {
      setBusy(false);
    }
  });
}

/** Empty sets are dropped: a set with neither reps nor seconds never happened. */
function toSession(d) {
  const exercises = d.cards
    .map((card) => ({
      ex: card.ex,
      sets: card.sets
        .filter((s) => s.reps !== undefined || s.secs !== undefined || s.km !== undefined)
        .map((s) => {
          const out = {};
          if (s.kg !== undefined) out.kg = s.kg;
          if (s.km !== undefined) out.km = s.km;
          if (s.reps !== undefined) out.reps = s.reps;
          if (s.secs !== undefined) out.secs = s.secs;
          if (s.rpe !== undefined) out.rpe = s.rpe;
          if (s.to_failure) out.to_failure = true;
          return out;
        }),
    }))
    .filter((e) => e.sets.length);

  const session = { date: d.date, day: d.day, exercises };
  const dur = intOrUndef(d.duration_min);
  if (dur !== undefined) session.duration_min = dur;
  if (d.notes.trim()) session.notes = d.notes.trim();
  return session;
}
