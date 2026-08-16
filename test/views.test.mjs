/**
 * Smoke test for the view layer under jsdom: every view must render, wire its
 * handlers, and survive interaction without throwing. Data is stubbed, so this
 * makes no network calls.
 */
import { JSDOM } from 'jsdom';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = pathToFileURL(ROOT).href;

const dom = new JSDOM('<!doctype html><html><body><header id="header"><nav id="nav" hidden></nav></header><main id="view"></main><div id="toasts"></div></body></html>', { url: 'https://example.test/' });
const { window } = dom;
for (const k of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'CustomEvent', 'getComputedStyle', 'Blob', 'location', 'history', 'sessionStorage', 'localStorage']) {
  Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.scrollTo = () => {};
window.print = () => { globalThis.__printed = true; };
window.HTMLElement.prototype.scrollIntoView = () => {};

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.error(`  FAIL ${n}${d ? ' — ' + d : ''}`); } };
const attempt = async (n, fn) => { try { await fn(); ok(n, true); } catch (e) { fail++; console.error(`  FAIL ${n} — ${e.message}\n${e.stack.split('\n').slice(1, 3).join('\n')}`); } };

/* --- a fake GitHub, so store.js and github.js run for real --------------- */

const YEAR = new Date().getFullYear();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000));
const TODAY = iso(new Date());

const FILES = {
  'registry/exercises.json': { schema_version: 1, exercises: [
    { id: 'squat', name: 'Back Squat', equipment: 'barbell', muscles: ['quads'] },
    { id: 'pullup', name: 'Pull-up', equipment: 'bodyweight', muscles: ['lats'] },
    { id: 'plank', name: 'Plank', equipment: 'bodyweight', muscles: ['core'] },
    { id: 'run', name: 'Running', equipment: 'cardio', muscles: ['cardiovascular'] },
  ] },
  'registry/metric-types.json': { schema_version: 2, types: [
    { id: 'weight', name: 'Bodyweight', unit: 'kg', shape: 'number', decimals: 1 },
    { id: 'bp', name: 'Blood pressure', unit: 'mmHg', shape: { sys: 'number', dia: 'number', pulse: 'number' }, primary_series: ['sys', 'dia'], decimals: 0 },
    { id: 'bowl-count', name: 'Quark bowls eaten', unit: 'bowls', shape: 'number', decimals: 0, value_type: 'integer', cadence: 'daily', min: 0, max: 6, warn_above: 4, plan_ref: 'bowl-plan-v1' },
  ] },
  'registry/meal-plans.json': { schema_version: 1, plans: [{
    id: 'bowl-plan-v1', name: 'Quark Bowl Plan', status: 'active', started: daysAgo(20), review_date: null, planned_end: null,
    notes: 'Time-boxed test plan.',
    recipe: {
      per_bowl: { kcal: 575, protein_g: 30, ingredients: [
        { name: 'Rasvaton rahka (fat-free quark)', amount: '250 g', kcal: 160 },
        { name: 'Banana', amount: '1', kcal: 90 },
      ] },
      bowl_1_additions: ['Daily seed dose (chia + flax, pre-portioned)', 'Creatine'],
      bowls_2_4_additions: ['Psyllium 3 g per bowl (never in Bowl 1 — medication gap)'],
      day_totals_4_bowls: { kcal: 2300, protein_g: 125, fibre_g: 35, potassium_mg: 3500 },
      target_strict_day_kcal: [2200, 2300],
      maintenance_kcal: [2600, 2700],
    },
    protocol: [{ title: 'Wake, fasted', text: 'BP + statin medication with water.' }, { title: 'Gap', text: 'Nothing eaten for 2 hours after medication.' }],
    guardrails: [{ title: 'Seed ceiling', text: 'Chia and flax in Bowl 1 only.' }, { title: 'Meds gap', text: 'Medication on waking → nothing for 2 hours → Bowl 1.' }],
  }] },
  'registry/sources.json': { schema_version: 1, sources: [
    { id: 'manual', name: 'Manual entry', kind: 'human' },
    { id: 'lab', name: 'Clinical laboratory', kind: 'human' },
    { id: 'google-health', name: 'Google Health API', kind: 'import' },
  ] },
  'plan/current.json': {
    schema_version: 1, name: 'Comeback Full-Body A/B/C', effective_from: '2026-07-13', effective_to: null,
    schedule: { pattern: 'rotation', days_per_week: 3, target_days: ['Tue', 'Thu', 'Sat'] },
    session_length_min: [45, 60], rules: ['Linear progression'],
    days: {
      A: { exercises: [{ ex: 'squat', sets: 3, reps: [8, 8], increment_kg: 2.5, warmup: 'bar x10' }, { ex: 'pullup', sets: 3, reps: [5, 8] }] },
      B: { exercises: [{ ex: 'plank', sets: 3, reps: [1, 1] }] },
      C: { _TODO: 'not entered', exercises: [] },
    },
  },
  [`logs/logs-${YEAR}.json`]: { schema_version: 3, sessions: [
    { date: `${YEAR}-07-12`, day: 'A', exercises: [{ ex: 'squat', sets: [{ kg: 40, reps: 8 }, { kg: 40, reps: 8 }, { kg: 40, reps: 8 }] }, { ex: 'pullup', sets: [{ reps: 6 }, { reps: 5 }] }], duration_min: 55, notes: 'First session back' },
    { date: `${YEAR}-07-15`, day: 'B', exercises: [{ ex: 'plank', sets: [{ secs: 45 }, { secs: 40 }] }], duration_min: 40 },
  ] },
  [`metrics/metrics-${YEAR}.json`]: { schema_version: 1, readings: [
    { ts: `${YEAR}-07-12T07:30:00+03:00`, type: 'weight', value: 84.2, src: 'manual', tags: ['morning', 'fasted'] },
    { ts: `${YEAR}-07-20T07:31:00+03:00`, type: 'bp', value: { sys: 132, dia: 85, pulse: 62 }, src: 'manual', tags: ['morning'] },
    { ts: `${YEAR}-07-28T20:10:00+03:00`, type: 'bp', value: { sys: 128, dia: 80, pulse: 58 }, src: 'manual', tags: ['evening'] },
    { ts: `${YEAR}-08-01T07:30:00+03:00`, type: 'weight', value: 83.1, src: 'manual', tags: ['morning'] },
  ] },
};

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let putCount = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const m = u.pathname.match(/^\/repos\/[^/]+\/[^/]+(?:\/contents\/(.*))?$/);
  if (!m) return json({ message: 'Not Found' }, 404);
  const path = m[1] ? decodeURIComponent(m[1]) : null;

  if (!path) return json({ private: true, name: 'chad-data' });
  if (opts.method === 'PUT') {
    putCount++;
    FILES[path] = JSON.parse(Buffer.from(JSON.parse(opts.body).content, 'base64').toString('utf8'));
    return json({ commit: { sha: 'deadbeef' }, content: { sha: 'cafe' } });
  }
  if (path === 'plan/archive') return json([]);
  if (!(path in FILES)) return json({ message: 'Not Found' }, 404);
  return json({ content: b64(JSON.stringify(FILES[path])), sha: `sha-${path}`, path });
};

localStorage.setItem('chad.pat', 'github_pat_test');
localStorage.setItem('chad.owner', 'jmooli');
localStorage.setItem('chad.repo', 'chad-data');

const store = await import(`${APP}/js/store.js`);
const { state } = store;
await store.loadRegistries();

const view = document.getElementById('view');
const ctx = { navigate: (r) => { globalThis.__nav = r; }, handleError: (e) => { throw e; } };

/* --- the views ---------------------------------------------------------- */

console.log('\nViews render');

const setDay = (letter) => {
  const sel = view.querySelector('#day');
  sel.value = letter;
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
};

const today = await import(`${APP}/js/views/today.js`);
await attempt('today renders', async () => {
  await today.default(view, ctx);
  if (!view.querySelector('#day')) throw new Error('view did not render');
});
// Last logged session was day B, so the rotation must propose day C.
ok('proposes the next day in the rotation', view.querySelector('#day').value === 'C', `got ${view.querySelector('#day').value}`);
ok('a day with no planned exercises prompts instead of failing', /no exercises for day C/i.test(view.textContent));

await attempt('switching to a populated day renders its cards', async () => {
  setDay('A');
  if (view.querySelectorAll('.ex-card').length !== 2) throw new Error(`expected 2 cards, got ${view.querySelectorAll('.ex-card').length}`);
});
ok('prefills the progressed weight', view.querySelector('.ex-card .kg')?.value === '42.5', `got "${view.querySelector('.ex-card .kg')?.value}"`);
ok('explains why it progressed', /\+2\.5 kg/.test(view.textContent));
ok('shows what was done last time', /Last 12\.07/.test(view.textContent));
ok('bodyweight movement gets a +kg placeholder', [...view.querySelectorAll('.kg')].some((i) => i.placeholder === '+kg'));

await attempt('adding a set works', async () => {
  const before = view.querySelectorAll('.ex-card .set').length;
  view.querySelector('[data-act="add-set"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (view.querySelectorAll('.ex-card .set').length !== before + 1) throw new Error('set not added');
});
await attempt('the more-options row toggles', async () => {
  const btn = view.querySelector('[data-act="more"]');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  if (btn.closest('.set').querySelector('.set-more').hidden) throw new Error('did not open');
});
await attempt('a card folds to a bar and back without losing typed values', async () => {
  view.querySelector('.ex-card .kg').value = '55';
  view.querySelector('[data-act="toggle-card"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const card = view.querySelector('.ex-card');
  if (!card.classList.contains('collapsed')) throw new Error('card did not fold');
  if (card.querySelector('.fold').getAttribute('aria-expanded') !== 'false') throw new Error('aria-expanded not updated');
  if (!card.querySelector('.fold-summary')) throw new Error('folded bar has no summary');
  if (!card.querySelector('.kg')) throw new Error('folded card dropped its inputs from the DOM');
  view.querySelector('[data-act="toggle-card"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (view.querySelector('.ex-card').classList.contains('collapsed')) throw new Error('card did not unfold');
  if (view.querySelector('.ex-card .kg').value !== '55') throw new Error('typed weight lost across the fold');
});
await attempt('switching to seconds works', async () => {
  view.querySelector('[data-act="toggle-units"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!view.querySelector('.ex-card .secs')) throw new Error('no seconds input');
});
await attempt('a timed exercise defaults to seconds from history', async () => {
  setDay('B');
  if (!view.querySelector('.ex-card .secs')) throw new Error('plank did not default to seconds');
});
await attempt('saving a session writes one commit', async () => {
  setDay('A');
  view.querySelectorAll('.ex-card')[0].querySelectorAll('.set').forEach((s, i) => {
    s.querySelector('.kg').value = '42.5';
    s.querySelector('.reps').value = '8';
  });
  const before = putCount;
  view.querySelector('#save').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  if (putCount !== before + 1) throw new Error(`expected one PUT, got ${putCount - before}`);
  const saved = FILES[`logs/logs-${YEAR}.json`].sessions.at(-1);
  if (saved.day !== 'A' || saved.exercises[0].sets.length !== 3) throw new Error(`unexpected record ${JSON.stringify(saved)}`);
  if ('secs' in saved.exercises[0].sets[0]) throw new Error('empty fields were not dropped');
});
ok('navigated to the log after saving', globalThis.__nav === 'log');
await attempt('editing an existing session loads it', async () => {
  today.loadForEdit(state.logYears.get(YEAR)[0]);
  await today.default(view, ctx);
  if (!/Edit session/.test(view.textContent)) throw new Error('not in edit mode');
  if (view.querySelector('.kg').value !== '40') throw new Error('did not load logged weights');
});

console.log('\nOne running session per day');

/** Discards any draft or in-progress edit, confirming the modal. */
const resetToday = async () => {
  view.querySelector('#reset').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  document.querySelector('.modal-back [data-act="ok"]')?.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
};

await attempt("re-opening Today continues today's logged session", async () => {
  await resetToday(); // discards the explicit edit above; today already has a manual session
  if (!/Continuing the session logged for/.test(view.textContent)) throw new Error('did not auto-load the day');
  if (/Edit session/.test(view.textContent)) throw new Error('continuing must not read as an edit');
  if (view.querySelector('.kg').value !== '42.5') throw new Error('did not load the logged sets');
  if (view.querySelector('#day').value !== 'A') throw new Error('did not keep the logged day');
});

await attempt('day switch while continuing keeps the logged exercises', async () => {
  const before = view.querySelectorAll('.ex-card').length;
  setDay('X');
  await new Promise((r) => setTimeout(r, 10));
  if (view.querySelectorAll('.ex-card').length !== before) throw new Error('logged exercises were replaced');
  setDay('A');
  await new Promise((r) => setTimeout(r, 10));
});

await attempt('saving while continuing updates the day in place', async () => {
  view.querySelector('[data-act="add-set"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  const sets = view.querySelectorAll('.ex-card .set');
  sets[sets.length - 1].querySelector('.kg').value = '42.5';
  sets[sets.length - 1].querySelector('.reps').value = '8';
  const before = putCount;
  view.querySelector('#save').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  if (putCount !== before + 1) throw new Error(`expected one commit, got ${putCount - before}`);
  const todays = FILES[`logs/logs-${YEAR}.json`].sessions.filter((s) => s.date === TODAY);
  if (todays.length !== 1) throw new Error(`expected one session for today, got ${todays.length}`);
  if (todays[0].exercises[0].sets.length !== 4) throw new Error('the added set was not saved');
});

await attempt('an imported activity stays separate from the manual session', async () => {
  FILES[`logs/logs-${YEAR}.json`].sessions.push({
    date: TODAY, day: 'X', exercises: [{ ex: 'run', sets: [{ km: 5.2, secs: 3100 }] }], src: 'google-health', ext_id: 'act:123',
  });
  store.invalidate();
  await today.default(view, ctx);
  if (!/Continuing the session logged for/.test(view.textContent)) throw new Error('manual session not auto-loaded');
  if (!/1 imported activity \(google-health\)/.test(view.textContent)) throw new Error('imported-activity note missing');
  if ([...view.querySelectorAll('.ex-card h2')].some((h) => /Running/.test(h.textContent))) throw new Error('imported activity leaked into the manual draft');
  if (store.nextRotationDay() !== 'B') throw new Error(`imported day-X session derailed the rotation: got ${store.nextRotationDay()}`);
});

const log = await import(`${APP}/js/views/log.js`);
await attempt('the log badges the imported session', async () => {
  await log.default(view, ctx);
  if (![...view.querySelectorAll('.tl-session .badge')].some((b) => b.textContent === 'google-health')) throw new Error('no source badge on the imported session');
});

// Drop the imported fixture again so the later sections see the counts they expect.
FILES[`logs/logs-${YEAR}.json`].sessions = FILES[`logs/logs-${YEAR}.json`].sessions.filter((s) => s.src === undefined);
store.invalidate();

const plan = await import(`${APP}/js/views/plan.js`);


await attempt('plan renders', async () => {
  await plan.default(view, ctx);
  if (!/Comeback Full-Body/.test(view.textContent)) throw new Error('plan name missing');
  if (!/Back Squat/.test(view.textContent)) throw new Error('exercises missing');
  if (!/3 × 8/.test(view.textContent)) throw new Error('set scheme missing');
});

await attempt('log renders', async () => {
  await log.default(view, ctx);
  if (view.querySelectorAll('.tl').length !== 7) throw new Error(`expected 7 timeline items, got ${view.querySelectorAll('.tl').length}`);
});
ok('sessions and readings share one newest-first timeline', (() => {
  const items = [...view.querySelectorAll('.tl')];
  const kinds = new Set(items.map((el) => el.className));
  const hasBoth = kinds.size === 2;
  const newestIsToday = items[0].classList.contains('tl-session');
  const hasReading = /83\.1/.test(view.textContent);
  return hasBoth && newestIsToday && hasReading;
})());
ok('composite readings are formatted', /132\/85 mmHg/.test(view.textContent));
ok('bodyweight sets omit a weight', /6, 5/.test(view.textContent));
ok('timed sets show seconds', /45s/.test(view.textContent));
await attempt('switching metric type rebuilds the value inputs', async () => {
  const sel = view.querySelector('#r-type');
  sel.value = 'bp';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  if (view.querySelectorAll('[data-comp]').length !== 3) throw new Error('composite inputs missing');
});
ok('tag suggestions come from existing data', /fasted/.test(view.textContent));
await attempt('tag chips still toggle after the form repaints', async () => {
  // The type switch above repainted the form onto the same container; with
  // stacked delegated listeners a tap fired twice and the chip never selected.
  const chip = view.querySelector('[data-tag="morning"]');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!chip.classList.contains('on')) throw new Error('chip did not select');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));
  if (chip.classList.contains('on')) throw new Error('chip did not deselect');
});

const progress = await import(`${APP}/js/views/progress.js`);
await attempt('progress renders', async () => {
  await progress.default(view, ctx);
  if (!view.querySelector('svg')) throw new Error('no chart');
});
ok('renders a chart per metric type', view.querySelectorAll('.metric-block').length === 2);
ok('no NaN in any chart', !/NaN/.test(view.innerHTML));
await attempt('range slider re-renders live', async () => {
  const slider = view.querySelector('#range-slider');
  if (!slider) throw new Error('no range slider');
  slider.value = slider.max; // drag to "All"
  slider.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20)); // repaint is rAF-throttled (shimmed to setTimeout)
  if (!/All data/.test(view.querySelector('.range-label').textContent)) throw new Error('label not updated');
  if (!view.querySelector('#progress-body svg')) throw new Error('charts did not re-render');
});
await attempt('chart expands to a full-screen viewer and closes again', async () => {
  view.querySelector('[data-zoom]').dispatchEvent(new window.Event('click', { bubbles: true }));
  const overlay = window.document.querySelector('.chartview');
  if (!overlay) throw new Error('viewer did not open');
  if (!overlay.querySelector('svg')) throw new Error('viewer has no chart');
  if (!/–/.test(overlay.querySelector('.chartview-range').textContent)) throw new Error('no visible date range');
  overlay.querySelector('.chartview-close').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (window.document.querySelector('.chartview')) throw new Error('viewer did not close');
});
await attempt('a metric chart folds to a bar with the latest value', async () => {
  const btn = view.querySelector('.metric-block [data-fold]');
  const key = btn.dataset.fold;
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  const folded = view.querySelector(`[data-fold="${key}"]`);
  if (folded.getAttribute('aria-expanded') !== 'false') throw new Error('did not fold');
  if (!/latest/.test(folded.textContent)) throw new Error('no latest-value summary on the bar');
  if (folded.closest('.metric-block').querySelector('svg')) throw new Error('folded chart still rendered');
  folded.dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!view.querySelector(`[data-fold="${key}"]`).closest('.metric-block').querySelector('svg')) throw new Error('chart did not come back');
});
await attempt('the lifts section folds too', async () => {
  view.querySelector('[data-fold="lifts"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (view.querySelector('#lift-select')) throw new Error('lifts did not fold');
  view.querySelector('[data-fold="lifts"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!view.querySelector('#lift-select')) throw new Error('lifts did not unfold');
});
await attempt('switching the charted lift works', async () => {
  const sel = view.querySelector('#lift-select');
  sel.value = 'pullup';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  if (/NaN/.test(view.innerHTML)) throw new Error('NaN after switch');
});

const clinical = await import(`${APP}/js/views/clinical.js`);
await attempt('clinical renders', async () => {
  await clinical.default(view, ctx);
  if (!view.querySelector('.report')) throw new Error('no report');
});
ok('blood pressure is split morning vs evening', /Morning/.test(view.textContent) && /Evening/.test(view.textContent));
ok('the reading table is present', view.querySelectorAll('.reading-table').length >= 1);
ok('no gym content on the report', !/Back Squat|Pull-up/.test(view.querySelector('.report').textContent));
ok('reference lines drawn for BP', view.innerHTML.includes('refline'));
await attempt('a report block folds on screen but keeps its body for print', async () => {
  const btn = view.querySelector('.report-block [data-fold]');
  const key = btn.dataset.fold;
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  const block = view.querySelector(`[data-fold="${key}"]`).closest('.report-block');
  if (!block.classList.contains('collapsed')) throw new Error('block did not fold');
  if (!block.querySelector('.fold-body .reading-table')) throw new Error('folded body left the DOM — print would lose it');
  if (!/readings · mean/.test(block.textContent)) throw new Error('no summary line on the bar');
  view.querySelector(`[data-fold="${key}"]`).dispatchEvent(new window.Event('click', { bubbles: true }));
  if (view.querySelector(`[data-fold="${key}"]`).closest('.report-block').classList.contains('collapsed')) throw new Error('did not unfold');
});
await attempt('print button calls print', async () => {
  view.querySelector('#c-print').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!globalThis.__printed) throw new Error('print not called');
});
await attempt('presentation lock engages', async () => {
  view.querySelector('#c-lock').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!document.body.classList.contains('locked')) throw new Error('not locked');
  document.body.classList.remove('locked');
});
await attempt('deselecting all metrics does not crash', async () => {
  for (const cb of [...view.querySelectorAll('[data-type]')]) {
    cb.checked = false;
    cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  if (!/Select at least one/.test(view.textContent)) throw new Error('no empty-state message');
});

const setup = await import(`${APP}/js/views/setup.js`);
await attempt('setup renders a token field', async () => {
  setup.default(view, { onDone: () => { globalThis.__unlocked = true; } });
  if (!view.querySelector('#pat')) throw new Error('no token field');
});
ok('setup explains how to scope the token', /Contents: Read and write/.test(view.textContent));

await attempt('an empty submit does nothing at all', async () => {
  const before = putCount;
  globalThis.__unlocked = false;
  view.querySelector('#setup-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  if (globalThis.__unlocked) throw new Error('unlocked without a token');
  if (putCount !== before) throw new Error('wrote something');
});

await attempt('a valid token against a private repo unlocks', async () => {
  view.querySelector('#pat').value = 'github_pat_example';
  view.querySelector('#setup-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  if (!globalThis.__unlocked) throw new Error('did not unlock');
});

await attempt('a public repo is refused rather than filled with health data', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (/\/repos\/[^/]+\/[^/]+$/.test(new URL(url).pathname)) return json({ private: false, name: 'oops' });
    return real(url, opts);
  };
  globalThis.__unlocked = false;
  setup.default(view, { onDone: () => { globalThis.__unlocked = true; } });
  view.querySelector('#pat').value = 'github_pat_example';
  view.querySelector('#setup-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  globalThis.fetch = real;
  if (globalThis.__unlocked) throw new Error('accepted a public repository');
  if (!/must live in a private repository/.test(view.textContent)) throw new Error('no explanation shown');
  if (localStorage.getItem('chad.pat')) throw new Error('token was kept after a refused unlock');
});
localStorage.setItem('chad.pat', 'github_pat_test');

console.log('\nCardio, logged off-plan');

// Today continues the day's manual session instead of stacking a second one,
// so move the gym session saved above off today's date — the off-plan cardio
// flow below must start from a fresh draft.
{
  const shard = FILES[`logs/logs-${YEAR}.json`];
  shard.sessions.find((s) => s.date === TODAY).date = `${YEAR}-07-20`;
  shard.sessions.sort((a, b) => a.date.localeCompare(b.date));
  store.invalidate();
}

await attempt('the exercise picker opens, searches and dismisses', async () => {
  await today.default(view, ctx);
  await resetToday();
  if (/Edit session/.test(view.textContent)) throw new Error('reset did not leave edit mode');
  setDay('X');
  view.querySelector('#add-ex').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  const back = document.querySelector('.picker-back');
  if (!back) throw new Error('picker did not open');
  if (document.querySelectorAll('.picker-item').length !== 4) throw new Error('picker does not list every exercise');
  const search = back.querySelector('.picker-search');
  search.value = 'lat'; // matches Pull-up by muscle group, nothing else
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  const hits = [...document.querySelectorAll('.picker-item')];
  if (hits.length !== 1 || hits[0].dataset.id !== 'pullup') throw new Error(`muscle search failed: ${hits.map((h) => h.dataset.id).join(',')}`);
  search.value = 'xyzzy';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  if (!/Nothing matches/.test(back.textContent)) throw new Error('no empty state');
  back.dispatchEvent(new window.Event('click', { bubbles: true })); // tap outside dismisses
  await new Promise((r) => setTimeout(r, 10));
  if (document.querySelector('.picker-back')) throw new Error('picker did not close');
  if (view.querySelector('.ex-card')) throw new Error('dismissing must not add a card');
});

const addExercise = async (id) => {
  view.querySelector('#add-ex').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  document.querySelector(`.picker-item[data-id="${id}"]`).dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
};

await attempt('adding a cardio exercise switches the inputs to distance and time', async () => {
  await addExercise('run');
  const card = view.querySelector('.ex-card');
  if (!card) throw new Error('no card added');
  if (!card.querySelector('.km') || !card.querySelector('.min')) throw new Error('no distance/time inputs');
  if (card.querySelector('.reps')) throw new Error('reps input should not be offered for cardio');
});
ok('cardio starts as a single leg, not three sets', view.querySelectorAll('.ex-card .set').length === 1);
ok('the add button is worded for cardio', /Add leg/.test(view.textContent));
ok('no reps/seconds toggle on cardio', !/Use seconds/.test(view.querySelector('.ex-card').textContent));

await attempt('a run saves as distance plus seconds', async () => {
  const card = view.querySelector('.ex-card');
  card.querySelector('.km').value = '5';
  card.querySelector('.min').value = '32';
  const before = putCount;
  view.querySelector('#save').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  if (putCount !== before + 1) throw new Error('did not commit');
  const saved = FILES[`logs/logs-${YEAR}.json`].sessions.find((s) => s.exercises.some((e) => e.ex === 'run'));
  if (!saved) throw new Error('no session containing a run');
  const set = saved.exercises[0].sets[0];
  if (saved.day !== 'X') throw new Error(`expected off-plan day, got ${saved.day}`);
  if (set.km !== 5) throw new Error(`km wrong: ${JSON.stringify(set)}`);
  if (set.secs !== 1920) throw new Error(`minutes were not converted to seconds: ${JSON.stringify(set)}`);
  if ('reps' in set || 'kg' in set) throw new Error(`strength fields leaked in: ${JSON.stringify(set)}`);
});

await attempt('the log shows the run in human terms', async () => {
  await log.default(view, ctx);
  if (!/5 km in 32 min/.test(view.textContent)) throw new Error('run not summarised');
});

await attempt('progress charts cardio by distance and reports pace', async () => {
  await progress.default(view, ctx);
  const sel = view.querySelector('#lift-select');
  sel.value = 'run';
  sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  const el = view.querySelector('#lift-chart');
  const html = el.innerHTML;
  if (!el.querySelector('path.series')) throw new Error('no line drawn');
  if (!/5 km total/.test(el.textContent)) throw new Error(`distance total missing: ${el.textContent.trim()}`);
  if (!/6:24 \/km/.test(el.textContent)) throw new Error(`pace missing: ${el.textContent.trim()}`);
  if (/NaN/.test(html)) throw new Error('NaN in cardio chart');
  if (/kg/.test(el.textContent)) throw new Error('cardio reported in kilograms');
});
ok('kilometres appear in the summary row', /km covered/.test(view.textContent));

await attempt('editing a cardio session reopens it in cardio mode', async () => {
  const run = store.allSessions().find((s) => s.exercises.some((e) => e.ex === 'run'));
  today.loadForEdit(run);
  await today.default(view, ctx);
  const card = view.querySelector('.ex-card');
  if (!card.querySelector('.km')) throw new Error('did not reopen in cardio mode');
  if (card.querySelector('.min').value !== '32') throw new Error(`minutes not restored: ${card.querySelector('.min').value}`);
});

console.log('\nDay-aware progression');
// Back Squat appears on day A at 3x5 and day C at 3x8. The day C suggestion
// must come from the last day C session, not from the heavier day A one.
FILES[`logs/logs-${YEAR}.json`].sessions.push({
  date: `${YEAR}-07-13`, day: 'C',
  exercises: [{ ex: 'squat', sets: [{ kg: 25, reps: 8 }, { kg: 25, reps: 8 }, { kg: 25, reps: 8 }] }],
});
store.invalidate();
await store.loadLogYear(YEAR);
{
  const latestSquat = store.allSessions().filter((s) => s.exercises.some((e) => e.ex === 'squat')).at(-1);
  ok('the most recent squat session is a day A one', latestSquat.day === 'A', `got day ${latestSquat.day}`);
  const c = store.suggestSets({ ex: 'squat', sets: 3, reps: [8, 8], increment_kg: 2.5 }, 'C');
  ok('day C suggests from the day C session', c.sets[0].kg === 27.5, `got ${c.sets[0].kg}`);
  const a = store.suggestSets({ ex: 'squat', sets: 3, reps: [5, 5], increment_kg: 2.5 }, 'A');
  ok('day A suggests from the day A session', a.sets[0].kg === 45, `got ${a.sets[0].kg}`);
  // Slot attribution is conservative: day-A history belongs to the A slot and
  // the C session's 3×8 fits two competing 8-rep slots, so an unseen day gets
  // no suggestion at all rather than a possibly-wrong one.
  const z = store.suggestSets({ ex: 'squat', sets: 3, reps: [8, 8], increment_kg: 2.5 }, 'Z');
  ok('an unseen day with only ambiguous history suggests no weight', z.sets[0].kg === undefined, `got ${z.sets[0].kg}`);
  // An off-plan (day X) session attributes by rep scheme, and only when
  // exactly one slot fits. Day A is the plan's only squat slot (3×8) here, so
  // a day-X 3×8 feeds A — but not the ad-hoc C query, where two 8-rep slots
  // compete and the session stays ambiguous.
  FILES[`logs/logs-${YEAR}.json`].sessions.push({
    date: `${YEAR}-07-22`, day: 'X',
    exercises: [{ ex: 'squat', sets: [{ kg: 30, reps: 8 }, { kg: 30, reps: 8 }, { kg: 30, reps: 8 }] }],
  });
  store.invalidate();
  await store.loadLogYear(YEAR);
  const a2 = store.suggestSets({ ex: 'squat', sets: 3, reps: [8, 8], increment_kg: 2.5 }, 'A');
  ok('a day-X session attributes to the uniquely fitting slot', a2.prevDate === `${YEAR}-07-22` && a2.sets[0].kg === 32.5, `got ${a2.prevDate} @ ${a2.sets[0].kg}`);
  const c2 = store.suggestSets({ ex: 'squat', sets: 3, reps: [8, 8], increment_kg: 2.5 }, 'C');
  ok('the day-C slot skips the ambiguous day-X session', c2.prevDate === `${YEAR}-07-13` && c2.sets[0].kg === 27.5, `got ${c2.prevDate} @ ${c2.sets[0].kg}`);
  const none = store.suggestSets({ ex: 'deadlift', sets: 3, reps: [5, 5], increment_kg: 5 }, 'B');
  ok('an untrained lift suggests no weight rather than a wrong one', none.sets[0].kg === undefined && none.basis === 'no previous session');
}

console.log('\nEmpty-data edge cases');
store.invalidate(); FILES[`logs/logs-${YEAR}.json`] = { schema_version: 1, sessions: [] };
FILES[`metrics/metrics-${YEAR}.json`] = { schema_version: 1, readings: [] };
await attempt('today with no history at all', async () => {
  await today.default(view, ctx);
  if (!view.querySelector('#day')) throw new Error('view did not render');
  setDay('A');
  if (!/No previous session logged/.test(view.textContent)) throw new Error('missing no-history state');
});
await attempt('log with nothing logged', async () => {
  await log.default(view, ctx);
  if (!/Nothing logged yet/.test(view.textContent)) throw new Error('missing empty state');
});
await attempt('progress with nothing logged', async () => {
  await progress.default(view, ctx);
  if (!/No sessions logged/.test(view.textContent)) throw new Error('missing empty state');
});
await attempt('clinical with nothing recorded', async () => {
  await clinical.default(view, ctx);
  if (!/No readings recorded yet/.test(view.textContent)) throw new Error('missing empty state');
});

console.log('\nBowl plan');

const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const bowlToday = () => FILES[`metrics/metrics-${YEAR}.json`].readings.filter((r) => r.type === 'bowl-count' && r.ts.slice(0, 10) === TODAY);

store.invalidate();
FILES[`metrics/metrics-${YEAR}.json`] = { schema_version: 1, readings: [
  { ts: `${daysAgo(6)}T07:30:00+03:00`, type: 'weight', value: 84.0, src: 'manual', tags: ['morning'] },
  { ts: `${daysAgo(6)}T20:00:00+03:00`, type: 'bowl-count', value: 3, src: 'manual' },
  { ts: `${daysAgo(4)}T20:00:00+03:00`, type: 'bowl-count', value: 2, src: 'manual' },
  { ts: `${daysAgo(2)}T07:30:00+03:00`, type: 'weight', value: 83.6, src: 'manual', tags: ['morning'] },
  { ts: `${daysAgo(2)}T20:00:00+03:00`, type: 'bowl-count', value: 4, src: 'manual' },
] };

await attempt('the bowls stepper renders 0–6 with 5 and 6 subdued', async () => {
  await log.default(view, ctx);
  const btns = view.querySelectorAll('.counter-btn');
  if (btns.length !== 7) throw new Error(`expected 7 buttons, got ${btns.length}`);
  if (view.querySelectorAll('.counter-btn.over').length !== 2) throw new Error('5 and 6 should be styled as the exception');
});

await attempt('one tap logs today\'s bowls as a single commit', async () => {
  const before = putCount;
  click(view.querySelector('.counter-btn[data-v="3"]'));
  await new Promise((r) => setTimeout(r, 50));
  if (putCount !== before + 1) throw new Error(`expected one PUT, got ${putCount - before}`);
  const t = bowlToday();
  if (t.length !== 1 || t[0].value !== 3 || t[0].src !== 'manual') throw new Error(JSON.stringify(t));
});
ok('the tapped value is highlighted', view.querySelector('.counter-btn[data-v="3"]').classList.contains('on'));

await attempt('re-tapping replaces today\'s count instead of appending', async () => {
  click(view.querySelector('.counter-btn[data-v="2"]'));
  await new Promise((r) => setTimeout(r, 50));
  const t = bowlToday();
  if (t.length !== 1 || t[0].value !== 2) throw new Error(JSON.stringify(t));
});

await attempt('tapping the already-logged value makes no commit', async () => {
  const before = putCount;
  click(view.querySelector('.counter-btn[data-v="2"]'));
  await new Promise((r) => setTimeout(r, 30));
  if (putCount !== before) throw new Error('wrote a pointless commit');
});

await attempt('a five-bowl day saves, with a ceiling warning', async () => {
  click(view.querySelector('.counter-btn[data-v="5"]'));
  await new Promise((r) => setTimeout(r, 50));
  const t = bowlToday();
  if (t.length !== 1 || t[0].value !== 5) throw new Error(JSON.stringify(t));
  if (!/ceiling/.test(document.getElementById('toasts').textContent)) throw new Error('no warning toast');
});

await attempt('plan view renders the meal plan from registry data', async () => {
  await plan.default(view, ctx);
  for (const s of ['Quark Bowl Plan', 'Rasvaton rahka', 'Daily protocol', 'Guardrails', 'Seed ceiling', 'Bowl 1 only']) {
    if (!view.textContent.includes(s)) throw new Error(`missing "${s}"`);
  }
});
ok('shows days elapsed on an active plan', /day 21/.test(view.textContent), view.querySelector('.meal-plan .meta')?.textContent);
ok('unset review/end dates prompt after 14 days', /meal-plans\.json/.test(view.textContent));

await attempt('progress overlays bowls behind the weight chart', async () => {
  await progress.default(view, ctx);
  const block = [...view.querySelectorAll('.metric-block')].find((b) => /Bodyweight/.test(b.textContent));
  if (!block) throw new Error('no weight block');
  if (!block.querySelector('rect.band')) throw new Error('no adherence bars behind weight');
  if (!/Grey bars: bowls\/day/.test(block.textContent)) throw new Error('no caption');
  if (/NaN/.test(block.innerHTML)) throw new Error('NaN in banded chart');
});

await attempt('clinical report carries the adherence summary line', async () => {
  await clinical.default(view, ctx);
  const line = view.querySelector('.report-plan');
  if (!line) throw new Error('no plan summary line');
  if (!/Quark Bowl Plan/.test(line.textContent)) throw new Error(line.textContent);
  if (!/mean 3\.5 bowls\/day/.test(line.textContent)) throw new Error(`mean wrong: ${line.textContent}`);
  if (!/\(4\/21\)/.test(line.textContent)) throw new Error(`coverage wrong: ${line.textContent}`);
});

console.log('\nCurrent targets');

// A reviewed targets block: two queued sessions, valid for another 12 days.
// The manual B session predates `written`, so nothing is consumed yet.
FILES[`logs/logs-${YEAR}.json`] = { schema_version: 3, sessions: [
  { date: daysAgo(3), day: 'B', exercises: [{ ex: 'plank', sets: [{ secs: 45 }] }] },
] };
FILES['plan/targets.json'] = { schema_version: 1, written: daysAgo(2), valid_until: daysAgo(-12), note: 'Biweekly review', sessions: [
  { day: 'A', exercises: [
    { ex: 'squat', sets: 3, reps: 5, kg: 92.5, note: 'push — last top set RPE 7' },
    { ex: 'pullup', sets: 3, reps: 6 },
  ], note: 'Keep rests honest' },
  { day: 'B', exercises: [{ ex: 'plank', sets: 3, reps: 1 }] },
] };
store.invalidate();
await store.loadRegistries();

await attempt('today prefills from the reviewed target, visibly marked', async () => {
  await today.default(view, ctx);
  await resetToday();
  if (view.querySelector('#day').value !== 'A') throw new Error(`target day not chosen: ${view.querySelector('#day').value}`);
  if (!/Reviewed target/.test(view.textContent)) throw new Error('no reviewed-target banner');
  if (!view.querySelector('.ex-card.from-target')) throw new Error('cards not marked as targets');
  const kg = view.querySelector('.ex-card .kg');
  if (kg.value !== '92.5') throw new Error(`decided weight not prefilled: "${kg.value}"`);
  if (!/push — last top set RPE 7/.test(view.textContent)) throw new Error('per-exercise rationale not shown');
  if (!/Keep rests honest/.test(view.textContent)) throw new Error('per-session rationale not shown');
  if (!/3 × 5 @ 92\.5 kg/.test(view.textContent)) throw new Error('target scheme not shown');
});

await attempt('the plan view lists the target queue ahead of the plan', async () => {
  await plan.default(view, ctx);
  if (!/Current targets/.test(view.textContent)) throw new Error('no targets section');
  if (!/92\.5 kg/.test(view.textContent)) throw new Error('decided weight missing');
  const badges = [...view.querySelectorAll('.targets-doc .day-card .badge')].map((b) => b.textContent);
  if (JSON.stringify(badges) !== JSON.stringify(['next', 'queued'])) throw new Error(`badges wrong: ${badges}`);
  if (view.textContent.indexOf('Current targets') > view.textContent.indexOf('Comeback Full-Body')) throw new Error('targets not ahead of the plan');
});

await attempt('logging the target session consumes it from the queue', async () => {
  FILES[`logs/logs-${YEAR}.json`].sessions.push({
    date: TODAY, day: 'A',
    exercises: [{ ex: 'squat', sets: [{ kg: 50, reps: 8 }, { kg: 50, reps: 8 }, { kg: 50, reps: 8 }] }],
  });
  store.invalidate();
  await store.loadYears(YEAR, YEAR);
  const ts = store.targetsStatus();
  if (ts.status !== 'active') throw new Error(`status ${ts.status}`);
  if (!ts.queue[0].done) throw new Error('day-A spec not consumed');
  if (ts.next.day !== 'B') throw new Error(`next should be B, got ${ts.next.day}`);
});

await attempt('an imported session never consumes a target spec', async () => {
  FILES[`logs/logs-${YEAR}.json`].sessions.push({
    date: TODAY, day: 'B', exercises: [{ ex: 'run', sets: [{ km: 3, secs: 1200 }] }], src: 'google-health', ext_id: 'act:t1',
  });
  store.invalidate();
  await store.loadYears(YEAR, YEAR);
  const ts = store.targetsStatus();
  if (ts.queue[1].done) throw new Error('imported day-B session consumed the B spec');
});

console.log('\nExpired targets');

// The block ran out yesterday: the gym view must show the plan fallback and
// say when the targets expired — never the stale numbers as current.
FILES['plan/targets.json'].written = daysAgo(15);
FILES['plan/targets.json'].valid_until = daysAgo(1);
{
  const shard = FILES[`logs/logs-${YEAR}.json`];
  shard.sessions.find((s) => s.date === TODAY && s.src === undefined).date = daysAgo(2);
  shard.sessions.sort((a, b) => a.date.localeCompare(b.date));
}
store.invalidate();
await store.loadRegistries();

await attempt('expired targets fall back to the plan and say so', async () => {
  await today.default(view, ctx);
  await resetToday();
  if (!/Targets expired 1 day ago/.test(view.textContent)) throw new Error('no expiry banner');
  if (view.querySelector('.ex-card.from-target')) throw new Error('stale target cards rendered');
  if (/Reviewed target —/.test(view.textContent)) throw new Error('stale target banner rendered');
  // Plan fallback: day A squat progresses from the logged 3×8@50, not the stale 92.5.
  setDay('A');
  await new Promise((r) => setTimeout(r, 10));
  if (!/Targets expired 1 day ago/.test(view.textContent)) throw new Error('expiry banner lost on day switch');
  if (view.querySelector('.ex-card.from-target')) throw new Error('stale target cards rendered on day A');
  const kg = view.querySelector('.ex-card .kg');
  if (kg.value !== '52.5') throw new Error(`expected plan-fallback 52.5, got "${kg.value}"`);
});

await attempt('the plan view reports the expiry without stale numbers', async () => {
  await plan.default(view, ctx);
  if (!/expired 1 day ago/.test(view.textContent)) throw new Error('no expiry note');
  if (/92\.5/.test(view.textContent)) throw new Error('stale target numbers still shown');
});

console.log(`\n${fail ? 'FAILED' : 'PASSED'} — ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
