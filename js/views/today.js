/**
 * Today — the gym screen.
 *
 * Works out which rotation day is next, pre-fills every set from the last time
 * that exercise came up plus the plan's progression increment, and asks for
 * confirmation rather than data entry. Standing at a rack, the fast path
 * should be: open, glance, tap save.
 */

import { state, loadYears, saveSession, replaceSession, suggestSets, exerciseName, nextRotationDay, todayISO, lastSessionWith, allSessions, targetsStatus } from '../store.js';
import { validateSession } from '../schema.js';
import { esc, toast, setBusy, on, numOrUndef, intOrUndef, confirmAction, pickExercise } from '../ui.js';
import { fmtDate } from '../stats.js';

let draft = null;
let editing = null; // the original record, when editing an existing session
let autoLoaded = false; // editing because Today picked up the day's session itself

/** Called from the Log view: open an existing session for correction. */
export function loadForEdit(session) {
  editing = session;
  autoLoaded = false;
  draft = draftFromSession(session);
}

export default async function renderToday(root, { navigate, handleError }) {
  const year = new Date().getFullYear();
  await loadYears(year - 1, year);

  if (!draft) initDraftForDate(todayISO());
  paint(root, { navigate, handleError });
}

/* --- one manual session per day ----------------------------------------- */

// Absent src means manual. Imported sessions (src: "google-health", …) are
// never folded into the day's manual session — they live as their own records.
const manualSessionsFor = (date) => allSessions().filter((s) => s.date === date && s.src === undefined);
const importedSessionsFor = (date) => allSessions().filter((s) => s.date === date && s.src !== undefined);

/**
 * The day is one running submission: if a manual session is already logged for
 * the date, continue it (saving updates in place); otherwise start a fresh
 * draft from the plan.
 */
function initDraftForDate(date) {
  const logged = manualSessionsFor(date);
  if (logged.length) {
    editing = logged[logged.length - 1];
    autoLoaded = true;
    draft = draftFromSession(editing);
  } else {
    editing = null;
    autoLoaded = false;
    // A valid reviewed target decides the day; otherwise the plan rotation does.
    const ts = targetsStatus(date);
    draft = buildDraft(ts.status === 'active' ? ts.next.day : nextRotationDay(), date);
  }
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

/**
 * A reviewed, unexpired target spec for this day beats the plan-derived
 * suggestion — it is the decision made in the last review conversation.
 * Expired or absent targets fall back to the plan and its increment rules;
 * stale target numbers are never rendered as current.
 */
function targetSpecFor(day, date) {
  const ts = targetsStatus(date);
  if (ts.status !== 'active') return null;
  return ts.queue.find((q) => !q.done && q.spec.day === day)?.spec || null;
}

function buildDraft(day, date = todayISO()) {
  const spec = targetSpecFor(day, date);
  return {
    date,
    day: day || 'X',
    duration_min: '',
    notes: '',
    fromTarget: !!spec,
    targetNote: spec?.note,
    cards: spec
      ? spec.exercises.map(cardFromTarget)
      : planEntriesFor(day).map((entry) => cardFromPlan(entry, day)),
  };
}

function cardFromTarget(te) {
  const prev = lastSessionWith(te.ex);
  const prevSets = prev?.exercises.find((e) => e.ex === te.ex)?.sets || [];
  const mode = modeFor(te.ex);
  return {
    ex: te.ex,
    fromTarget: true,
    target: `${te.sets} × ${te.reps}${te.kg !== undefined ? ` @ ${te.kg} kg` : ''}`,
    note: te.note,
    basis: 'reviewed target',
    prevDate: prev?.date || null,
    prevSets,
    mode,
    sets: Array.from({ length: te.sets }, () =>
      mode === 'reps' ? { ...(te.kg !== undefined ? { kg: te.kg } : {}), reps: te.reps } : {}),
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

/**
 * The targets banner: never silent about which regime the numbers on screen
 * come from. A reviewed target announces itself; an expired or exhausted
 * targets block announces the fallback to the plan.
 */
function targetsBannerHTML() {
  if (editing) return '';
  const ts = targetsStatus(draft.date);
  const t = ts.targets;
  if (draft.fromTarget && ts.status === 'active') {
    const left = ts.queue.filter((q) => !q.done).length;
    return `<p class="notice notice-target"><strong>Reviewed target</strong> — written ${esc(fmtDate(t.written))}, valid until ${esc(fmtDate(t.valid_until))}.
      ${draft.targetNote ? `${esc(draft.targetNote)} ` : ''}${left > 1 ? `${left - 1} more queued after this one — see <a href="#/plan">the plan</a>.` : 'Last queued session.'}</p>`;
  }
  if (ts.status === 'expired') {
    const d = ts.expiredDays;
    return `<p class="notice"><strong>Targets expired ${d} day${d === 1 ? '' : 's'} ago</strong> (were valid until ${esc(fmtDate(t.valid_until))}) — showing the plan fallback. Review with Claude to set new targets.</p>`;
  }
  if (ts.status === 'completed') {
    return `<p class="notice notice-muted">All reviewed target sessions are done — plan fallback until the next review.</p>`;
  }
  if (ts.status === 'active' && !draft.fromTarget) {
    return `<p class="notice notice-muted">No reviewed target for day ${esc(draft.day)} — this is the plan fallback. Queued targets: ${ts.queue.filter((q) => !q.done).map((q) => esc(q.spec.day)).join(', ')}.</p>`;
  }
  return '';
}

function paint(root, ctx) {
  const letters = state.plan ? Object.keys(state.plan.days) : [];
  const planned = planEntriesFor(draft.day);
  const imported = importedSessionsFor(draft.date);

  root.innerHTML = `
    <section class="today">
      <div class="head-row">
        <h1>${editing && !autoLoaded ? 'Edit session' : 'Today'}</h1>
        <div class="head-controls">
          <input type="date" id="date" value="${esc(draft.date)}" aria-label="Session date">
          <select id="day" aria-label="Rotation day">
            ${letters.map((l) => `<option value="${esc(l)}" ${l === draft.day ? 'selected' : ''}>Day ${esc(l)}</option>`).join('')}
            <option value="X" ${draft.day === 'X' ? 'selected' : ''}>Off-plan</option>
          </select>
        </div>
      </div>

      ${targetsBannerHTML()}
      ${editing && !autoLoaded ? `<p class="notice">Correcting the session logged on ${esc(fmtDate(editing.date))}. Saving replaces it in one commit.</p>` : ''}
      ${autoLoaded ? `<p class="notice">Continuing the session logged for ${esc(fmtDate(draft.date))} (day ${esc(editing.day)}). Add to it freely — saving updates it in one commit.</p>` : ''}
      ${imported.length ? `<p class="notice notice-muted">${imported.length} imported ${imported.length === 1 ? 'activity' : 'activities'} (${esc(imported[0].src)}) ${imported.length === 1 ? 'is' : 'are'} also logged for this day — see <a href="#/log">the log</a>.</p>` : ''}
      ${!planned.length && !draft.fromTarget && draft.day !== 'X' ? `<p class="notice">The plan has no exercises for day ${esc(draft.day)} yet. Add them below, or fill in <a href="#/plan">the plan</a>.</p>` : ''}

      <div id="cards">${draft.cards.map(cardHTML).join('')}</div>

      <div class="add-ex">
        <button type="button" class="btn" id="add-ex">＋ Add exercise</button>
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
        <button class="btn" id="reset">${autoLoaded ? 'Reload' : editing ? 'Cancel edit' : 'Reset'}</button>
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
    <article class="ex-card${card.fromTarget ? ' from-target' : ''}" data-card="${i}">
      <header>
        <h2>${esc(exerciseName(card.ex))}${card.fromTarget ? ' <span class="badge">target</span>' : ''}</h2>
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
    // While continuing or correcting a logged session, relabelling the day
    // must not touch the exercises — only a fresh draft reloads from the plan.
    if (editing) {
      draft.day = day;
      repaint();
      return;
    }
    if (draft.dirty && !(await confirmAction(`Switch to day ${day}? The sets you have entered will be replaced.`, { okLabel: 'Switch' }))) {
      draft.day = previous;
      e.target.value = previous;
      return;
    }
    draft = buildDraft(day, draft.date);
    repaint();
  });

  root.querySelector('#date').addEventListener('change', async (e) => {
    // In an explicit edit the date field re-dates the session being corrected.
    // Otherwise it selects which day to work on: load that day's session, or
    // start a fresh draft for it.
    if (editing && !autoLoaded) {
      readForm(root);
      repaint();
      return;
    }
    const previous = draft.date;
    const date = e.target.value;
    if (!date || date === previous) return;
    readForm(root);
    if (draft.dirty && !(await confirmAction(`Open ${fmtDate(date)}? The unsaved changes here will be discarded.`, { okLabel: 'Open' }))) {
      draft.date = previous;
      e.target.value = previous;
      return;
    }
    try {
      const y = Number(date.slice(0, 4));
      await loadYears(y, y);
    } catch (err) {
      ctx.handleError(err);
      return;
    }
    initDraftForDate(date);
    repaint();
  });

  root.querySelector('#add-ex').addEventListener('click', async () => {
    const id = await pickExercise(state.exercises.values());
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
    autoLoaded = false;
    initDraftForDate(todayISO());
    repaint();
  });

  root.querySelector('#save').addEventListener('click', async () => {
    readForm(root);
    const session = toSession(draft);
    const errors = validateSession(session, { exerciseIds: new Set(state.exercises.keys()), sourceIds: new Set(state.sources.keys()) });
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
        autoLoaded = false;
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
  // Correcting an imported session keeps its provenance — a hand edit does not
  // turn machine data into manual data. Manual sessions never gain a src.
  if (editing?.src !== undefined) {
    session.src = editing.src;
    if (editing.ext_id !== undefined) session.ext_id = editing.ext_id;
  }
  return session;
}
