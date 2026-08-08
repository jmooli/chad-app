/**
 * Plan — renders the active program as workout cards, and gives access to
 * archived programs so old logs stay explicable. Meal plans render below the
 * training plan: same idea, food instead of iron.
 */

import { state, exerciseName, todayISO, targetsStatus, loadYears } from '../store.js';
import { getFile, listDir } from '../github.js';
import { esc } from '../ui.js';
import { fmtDate, fmtNum } from '../stats.js';

export default async function renderPlan(root, { handleError }) {
  const archive = await listDir('plan/archive').catch(() => []);
  const archived = archive.filter((f) => f.name.endsWith('.json'));
  // Done-detection for the targets queue needs the log in memory.
  const year = new Date().getFullYear();
  await loadYears(year - 1, year);

  root.innerHTML = `
    <section class="plan">
      <h1>Plan</h1>
      ${targetsHTML(targetsStatus())}
      <div id="plan-body">${state.plan ? planHTML(state.plan, true) : '<p class="notice">No plan file found in the data repo.</p>'}</div>

      ${state.mealPlans.length ? `<h2 class="section-head">Meal plan</h2>${state.mealPlans.map(mealPlanHTML).join('')}` : ''}

      ${archived.length
        ? `<h2 class="section-head">Earlier programs</h2>
           <ul class="archive-list">
             ${archived
               .sort((a, b) => b.name.localeCompare(a.name))
               .map((f) => `<li><button class="link" data-archive="${esc(f.path)}">${esc(f.name.replace(/\.json$/, ''))}</button></li>`)
               .join('')}
           </ul>
           <div id="archive-body"></div>`
        : ''}
    </section>`;

  root.querySelectorAll('[data-archive]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const body = root.querySelector('#archive-body');
      body.innerHTML = '<div class="loading">Loading…</div>';
      try {
        const f = await getFile(btn.dataset.archive);
        body.innerHTML = f ? planHTML(f.json, false) : '<p class="notice">Could not read that plan.</p>';
        body.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        body.innerHTML = '';
        handleError(e);
      }
    });
  });
}

/* --- current targets ------------------------------------------------------ *
 * The reviewed queue of upcoming sessions with decided weights, written only
 * by Claude (set_targets) during review conversations. Expiry is hard: past
 * valid_until the numbers are not shown at all — the plan below is
 * authoritative and the expiry is stated. Never confidently stale.
 */

function targetsHTML(ts) {
  if (ts.status === 'none') return '';
  const t = ts.targets;

  if (ts.status === 'expired') {
    return `
      <div class="plan-doc targets-doc">
        <div class="plan-head">
          <h2>Current targets <span class="badge badge-muted">expired</span></h2>
        </div>
        <p class="notice">Targets expired ${ts.expiredDays} day${ts.expiredDays === 1 ? '' : 's'} ago (were valid until ${esc(fmtDate(t.valid_until))}).
        The plan below and its increment rules are authoritative until the next review with Claude.</p>
      </div>`;
  }

  const specHTML = ({ spec, done }, i) => `
    <article class="day-card${done ? ' target-done' : ''}">
      <h3>${i + 1}. Day ${esc(spec.day)} ${done ? '<span class="badge badge-muted">done</span>' : i === ts.queue.findIndex((q) => !q.done) ? '<span class="badge">next</span>' : '<span class="badge badge-muted">queued</span>'}</h3>
      <table class="plan-table">
        <tbody>
          ${spec.exercises.map((e) => `<tr>
            <td class="ex">${esc(exerciseName(e.ex))}</td>
            <td class="sets">${esc(e.sets)} × ${esc(e.reps)}</td>
            <td class="inc">${e.kg !== undefined ? `${esc(e.kg)} kg` : ''}</td>
          </tr>
          ${e.note ? `<tr class="warmup-row"><td colspan="3">${esc(e.note)}</td></tr>` : ''}`).join('')}
        </tbody>
      </table>
      ${spec.note ? `<p class="tl-note">${esc(spec.note)}</p>` : ''}
    </article>`;

  return `
    <div class="plan-doc targets-doc">
      <div class="plan-head">
        <h2>Current targets <span class="badge">reviewed</span></h2>
        <p class="meta"><span>written ${esc(fmtDate(t.written))} · valid until ${esc(fmtDate(t.valid_until))}</span></p>
      </div>
      ${t.note ? `<p class="rules-note">${esc(t.note)}</p>` : ''}
      ${ts.status === 'completed' ? '<p class="notice notice-muted">All queued sessions are done — plan fallback below until the next review.</p>' : ''}
      <div class="days">${ts.queue.map(specHTML).join('')}</div>
    </div>`;
}

function planHTML(plan, isCurrent) {
  const range = plan.effective_to
    ? `${fmtDate(plan.effective_from)} – ${fmtDate(plan.effective_to)}`
    : `from ${fmtDate(plan.effective_from)}`;

  return `
    <div class="plan-doc">
      <div class="plan-head">
        <h2>${esc(plan.name)}</h2>
        <p class="meta">
          <span>${esc(range)}</span>
          ${isCurrent ? '<span class="badge">active</span>' : '<span class="badge badge-muted">archived</span>'}
        </p>
        <p class="meta">
          ${esc(plan.schedule?.days_per_week ?? '?')}× per week
          ${plan.schedule?.target_days?.length ? ` · ${esc(plan.schedule.target_days.join(', '))}` : ''}
          ${plan.session_length_min ? ` · ${esc(plan.session_length_min.join('–'))} min` : ''}
        </p>
      </div>

      ${plan.rules?.length ? `<ul class="rules">${plan.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}

      <div class="days">
        ${Object.entries(plan.days || {}).map(([letter, day]) => dayHTML(letter, day)).join('')}
      </div>
    </div>`;
}

/* --- meal plans ----------------------------------------------------------- *
 * Read-only: recipe, protocol and guardrails come from the registry in the
 * data repo, never from strings in this file. Editing happens in the JSON.
 */

const DAY_MS = 86400000;
const daysBetween = (fromISO, toISO) => Math.round((Date.parse(toISO + 'T12:00:00') - Date.parse(fromISO + 'T12:00:00')) / DAY_MS);

function mealPlanHTML(p) {
  const today = todayISO();
  const elapsed = daysBetween(p.started, today);
  const ended = p.status === 'ended';

  const dateLine = (label, date) => {
    if (!date) return '';
    const left = daysBetween(today, date);
    const when = left > 0 ? `in ${left} day${left === 1 ? '' : 's'}` : left === 0 ? 'today' : `${-left} day${left === -1 ? '' : 's'} overdue`;
    return `<span>${esc(label)} ${esc(fmtDate(date))}${ended ? '' : ` (${esc(when)})`}</span>`;
  };

  // The plan is a phase, not a setting: if it is still open-ended two weeks
  // in, nudge — but never set the dates. That is the owner's call (in JSON).
  const datesMissing = !ended && (!p.review_date || !p.planned_end) && elapsed >= 14;

  return `
    <div class="plan-doc meal-plan">
      <div class="plan-head">
        <h2>${esc(p.name)}</h2>
        <p class="meta">
          <span>started ${esc(fmtDate(p.started))}${ended ? '' : ` · day ${elapsed + 1}`}</span>
          ${ended ? '<span class="badge badge-muted">ended</span>' : '<span class="badge">active</span>'}
        </p>
        <p class="meta">
          ${dateLine('review', p.review_date)}
          ${dateLine('planned end', p.planned_end)}
        </p>
      </div>

      ${datesMissing ? `<p class="notice small">This plan is time-boxed, but ${!p.review_date && !p.planned_end ? 'its review date and planned end are' : !p.review_date ? 'its review date is' : 'its planned end is'} still unset ${elapsed} days in. Set ${!p.review_date && !p.planned_end ? 'them' : 'it'} in <code>registry/meal-plans.json</code> — review ~month 3 (next lipid panel), end ~month 6.</p>` : ''}

      ${recipeHTML(p.recipe)}
      ${stepsHTML('Daily protocol', p.protocol, true)}
      ${stepsHTML('Guardrails', p.guardrails, false)}

      ${p.notes ? `<p class="tl-note">${esc(p.notes)}</p>` : ''}
    </div>`;
}

function recipeHTML(r) {
  if (!r) return '';
  const pb = r.per_bowl || {};
  const totals = r.day_totals_4_bowls;
  const target = r.target_strict_day_kcal;
  const maint = r.maintenance_kcal;

  return `
    <article class="day-card">
      <h3>The Standard Full Bowl <span class="unit">~${esc(fmtNum(pb.kcal, 0))} kcal · ~${esc(fmtNum(pb.protein_g, 0))} g protein</span></h3>
      <table class="plan-table">
        <tbody>
          ${(pb.ingredients || []).map((i) => `<tr>
            <td class="ex">${esc(i.name)}</td>
            <td class="sets">${esc(i.amount)}</td>
            <td class="inc">${esc(fmtNum(i.kcal, 0))} kcal</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${(r.bowl_1_additions || []).length ? `<p class="meal-add"><strong>Bowl 1 only:</strong> ${esc(r.bowl_1_additions.join(' · '))}</p>` : ''}
      ${(r.bowls_2_4_additions || []).length ? `<p class="meal-add"><strong>Bowls 2–4:</strong> ${esc(r.bowls_2_4_additions.join(' · '))}</p>` : ''}
      ${totals ? `<p class="meal-add">Four bowls ≈ ${esc(fmtNum(totals.kcal, 0))} kcal · ~${esc(fmtNum(totals.protein_g, 0))} g protein · ~${esc(fmtNum(totals.fibre_g, 0))} g fibre · ~${esc(fmtNum(totals.potassium_mg, 0))} mg potassium${target ? ` — strict-day target ${esc(target.join('–'))} kcal` : ''}${maint ? ` (maintenance ${esc(maint.join('–'))})` : ''}.</p>` : ''}
    </article>`;
}

function stepsHTML(heading, steps, numbered) {
  if (!steps?.length) return '';
  const tag = numbered ? 'ol' : 'ul';
  return `
    <article class="day-card">
      <h3>${esc(heading)}</h3>
      <${tag} class="meal-steps">
        ${steps.map((s) => `<li><strong>${esc(s.title)}:</strong> ${esc(s.text)}</li>`).join('')}
      </${tag}>
    </article>`;
}

function dayHTML(letter, day) {
  const list = day.exercises || [];
  return `
    <article class="day-card">
      <h3>Day ${esc(letter)}</h3>
      ${day._TODO ? `<p class="notice small">${esc(day._TODO)}</p>` : ''}
      ${list.length
        ? `<table class="plan-table">
             <tbody>
               ${list
                 .map(
                   (e) => `<tr>
                     <td class="ex">${esc(exerciseName(e.ex))}</td>
                     <td class="sets">${esc(e.sets)} × ${esc(e.reps[0] === e.reps[1] ? e.reps[0] : `${e.reps[0]}–${e.reps[1]}`)}</td>
                     <td class="inc">${e.increment_kg ? `+${esc(e.increment_kg)} kg` : ''}</td>
                   </tr>
                   ${e.note ? `<tr class="warmup-row"><td colspan="3">${esc(e.note)}</td></tr>` : ''}
                   ${e.warmup ? `<tr class="warmup-row"><td colspan="3">Warm-up: ${esc(e.warmup)}</td></tr>` : ''}`,
                 )
                 .join('')}
             </tbody>
           </table>`
        : '<p class="muted">No exercises yet.</p>'}
    </article>`;
}
