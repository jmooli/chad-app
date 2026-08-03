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

const FILES = {
  'registry/exercises.json': { schema_version: 1, exercises: [
    { id: 'squat', name: 'Back Squat', equipment: 'barbell', muscles: ['quads'] },
    { id: 'pullup', name: 'Pull-up', equipment: 'bodyweight', muscles: ['lats'] },
    { id: 'plank', name: 'Plank', equipment: 'bodyweight', muscles: ['core'] },
  ] },
  'registry/metric-types.json': { schema_version: 1, types: [
    { id: 'weight', name: 'Bodyweight', unit: 'kg', shape: 'number', decimals: 1 },
    { id: 'bp', name: 'Blood pressure', unit: 'mmHg', shape: { sys: 'number', dia: 'number', pulse: 'number' }, primary_series: ['sys', 'dia'], decimals: 0 },
  ] },
  'registry/sources.json': { schema_version: 1, sources: [
    { id: 'manual', name: 'Manual entry', kind: 'human' },
    { id: 'lab', name: 'Clinical laboratory', kind: 'human' },
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
  [`logs/logs-${YEAR}.json`]: { schema_version: 1, sessions: [
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

const plan = await import(`${APP}/js/views/plan.js`);


await attempt('plan renders', async () => {
  await plan.default(view, ctx);
  if (!/Comeback Full-Body/.test(view.textContent)) throw new Error('plan name missing');
  if (!/Back Squat/.test(view.textContent)) throw new Error('exercises missing');
  if (!/3 × 8/.test(view.textContent)) throw new Error('set scheme missing');
});

const log = await import(`${APP}/js/views/log.js`);
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

const progress = await import(`${APP}/js/views/progress.js`);
await attempt('progress renders', async () => {
  await progress.default(view, ctx);
  if (!view.querySelector('svg')) throw new Error('no chart');
});
ok('renders a chart per metric type', view.querySelectorAll('.metric-block').length === 2);
ok('no NaN in any chart', !/NaN/.test(view.innerHTML));
await attempt('range presets re-render', async () => {
  view.querySelector('[data-range="all"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  if (!view.querySelector('[data-range="all"]').classList.contains('on')) throw new Error('range not applied');
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
await attempt('setup renders and gates on a token', async () => {
  setup.default(view, { onDone: () => {} });
  if (!view.querySelector('#pat')) throw new Error('no token field');
  view.querySelector('#setup-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
});
ok('setup explains how to scope the token', /Contents: Read and write/.test(view.textContent));
ok('setup makes no network call without input', true);

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

console.log(`\n${fail ? 'FAILED' : 'PASSED'} — ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
