/**
 * Plan — renders the active program as workout cards, and gives access to
 * archived programs so old logs stay explicable.
 */

import { state, exerciseName } from '../store.js';
import { getFile, listDir } from '../github.js';
import { esc } from '../ui.js';
import { fmtDate } from '../stats.js';

export default async function renderPlan(root, { handleError }) {
  const archive = await listDir('plan/archive').catch(() => []);
  const archived = archive.filter((f) => f.name.endsWith('.json'));

  root.innerHTML = `
    <section class="plan">
      <h1>Plan</h1>
      <div id="plan-body">${state.plan ? planHTML(state.plan, true) : '<p class="notice">No plan file found in the data repo.</p>'}</div>

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
                   ${e.warmup ? `<tr class="warmup-row"><td colspan="3">Warm-up: ${esc(e.warmup)}</td></tr>` : ''}`,
                 )
                 .join('')}
             </tbody>
           </table>`
        : '<p class="muted">No exercises yet.</p>'}
    </article>`;
}
