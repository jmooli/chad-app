/**
 * Node harness for the app's pure logic. The views need a DOM, but everything
 * that can silently corrupt data — the serializer, base64, validation,
 * progression, aggregation — is testable here.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The byte-for-byte check needs a checkout of the private data repo beside
// this one. CI cannot see it, so that section is skipped there — but it is the
// check that matters most locally, since a drift between format.js and the
// data repo's validate.mjs breaks every write the app makes.
const DATA = process.env.CHAD_DATA || join(APP, '..', 'chad-data');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

// Minimal browser shims so the modules import cleanly.
globalThis.localStorage = { store: new Map(), getItem(k) { return this.store.get(k) ?? null; }, setItem(k, v) { this.store.set(k, v); }, removeItem(k) { this.store.delete(k); } };

const { formatDataFile, orderSession, orderReading } = await import(`file://${APP}/js/format.js`);
const { encodeBase64, decodeBase64 } = await import(`file://${APP}/js/github.js`);
const { validateSession, validateReading, warnReading } = await import(`file://${APP}/js/schema.js`);
const { aggregate, aggregationFor, summarize, partOfDay, estimated1RM, rollingBest, topSetKg, volume, distance, duration, pace, fmtPace } = await import(`file://${APP}/js/stats.js`);
const { chartSVG } = await import(`file://${APP}/js/chart.js`);

console.log('\n1. Serializer matches the data repo byte-for-byte');
if (existsSync(join(DATA, 'README.md'))) {
  const dataFiles = [
    'registry/exercises.json', 'registry/metric-types.json', 'registry/sources.json',
    'registry/meal-plans.json', 'plan/current.json', 'plan/targets.json', 'logs/logs-2026.json', 'metrics/metrics-2026.json',
  ];
  for (const rel of dataFiles) {
    if (!existsSync(join(DATA, rel))) continue;
    const raw = readFileSync(join(DATA, rel), 'utf8');
    ok(`format.js reproduces ${rel}`, formatDataFile(JSON.parse(raw)) === raw);
  }
} else {
  console.log(`  skip  data repo not found at ${DATA} (set CHAD_DATA to override)`);
}

console.log('\n2. Serializer keeps one record per line');
const withRecords = {
  schema_version: 1,
  sessions: [
    { date: '2026-08-01', day: 'A', exercises: [{ ex: 'squat', sets: [{ kg: 40, reps: 8 }, { kg: 40, reps: 8 }, { kg: 40, reps: 7, rpe: 9, to_failure: true }] }, { ex: 'bench', sets: [{ kg: 50, reps: 5 }] }], duration_min: 55, notes: 'long note '.repeat(12) },
    { date: '2026-08-03', day: 'B', exercises: [{ ex: 'pullup', sets: [{ reps: 6 }] }] },
  ],
};
const out = formatDataFile(withRecords);
const recordLines = out.split('\n').filter((l) => l.trim().startsWith('{"date"'));
eq('one line per session regardless of length', recordLines.length, 2);
ok('serializer output round-trips through JSON.parse', JSON.stringify(JSON.parse(out)) === JSON.stringify(withRecords));
ok('file ends with a newline', out.endsWith('\n'));

console.log('\n3. UTF-8 base64 (the silent-corruption risk)');
for (const s of ['ääkköset', 'Reisilihas – 62,5 kg', '日本語', 'plain ascii', '{"note":"tuntui hyvältä 💪"}']) {
  eq(`round-trips ${JSON.stringify(s)}`, decodeBase64(encodeBase64(s)), s);
}
ok('large payload round-trips', decodeBase64(encodeBase64('ä'.repeat(60000))).length === 60000);

console.log('\n4. Key ordering is canonical');
eq('session keys ordered', Object.keys(orderSession({ notes: 'x', exercises: [], day: 'A', date: '2026-01-01' })), ['date', 'day', 'exercises', 'notes']);
eq('set keys ordered', Object.keys(orderSession({ date: 'd', day: 'A', exercises: [{ sets: [{ reps: 5, kg: 20, to_failure: true }], ex: 'squat' }] }).exercises[0].sets[0]), ['kg', 'reps', 'to_failure']);
eq('reading keys ordered', Object.keys(orderReading({ src: 'manual', value: 1, ts: 't', type: 'weight' })), ['ts', 'type', 'value', 'src']);
ok('undefined fields are dropped', !('duration_min' in orderSession({ date: 'd', day: 'A', exercises: [], duration_min: undefined })));
eq('session provenance keys ordered last', Object.keys(orderSession({ ext_id: 'act:1', src: 'google-health', date: 'd', day: 'X', exercises: [] })), ['date', 'day', 'exercises', 'src', 'ext_id']);

console.log('\n5. Client-side validation');
const exerciseIds = new Set(['squat', 'pullup']);
eq('valid session passes', validateSession({ date: '2026-08-01', day: 'A', exercises: [{ ex: 'squat', sets: [{ kg: 40, reps: 8 }] }] }, { exerciseIds }).length, 0);
ok('unknown exercise rejected', validateSession({ date: '2026-08-01', day: 'A', exercises: [{ ex: 'nope', sets: [{ reps: 1 }] }] }, { exerciseIds }).length > 0);
ok('set without reps or secs rejected', validateSession({ date: '2026-08-01', day: 'A', exercises: [{ ex: 'squat', sets: [{ kg: 40 }] }] }, { exerciseIds }).length > 0);
ok('bad date rejected', validateSession({ date: '1.8.2026', day: 'A', exercises: [{ ex: 'squat', sets: [{ reps: 1 }] }] }, { exerciseIds }).length > 0);
ok('rpe out of range rejected', validateSession({ date: '2026-08-01', day: 'A', exercises: [{ ex: 'squat', sets: [{ reps: 5, rpe: 12 }] }] }, { exerciseIds }).length > 0);

// Session provenance (logs schema_version 3).
const sessionSrcIds = new Set(['manual', 'google-health']);
eq('imported session passes', validateSession({ date: '2026-08-01', day: 'X', exercises: [{ ex: 'squat', sets: [{ reps: 1 }] }], src: 'google-health', ext_id: 'act:1' }, { exerciseIds, sourceIds: sessionSrcIds }).length, 0);
ok('unknown session source rejected', validateSession({ date: '2026-08-01', day: 'X', exercises: [{ ex: 'squat', sets: [{ reps: 1 }] }], src: 'fitbit' }, { exerciseIds, sourceIds: sessionSrcIds }).length > 0);
ok('ext_id without src rejected', validateSession({ date: '2026-08-01', day: 'X', exercises: [{ ex: 'squat', sets: [{ reps: 1 }] }], ext_id: 'act:1' }, { exerciseIds, sourceIds: sessionSrcIds }).length > 0);
eq('src tolerated without a sourceIds context', validateSession({ date: '2026-08-01', day: 'X', exercises: [{ ex: 'squat', sets: [{ reps: 1 }] }], src: 'google-health' }, { exerciseIds }).length, 0);

const types = new Map([
  ['weight', { id: 'weight', name: 'Bodyweight', unit: 'kg', shape: 'number' }],
  ['bp', { id: 'bp', name: 'Blood pressure', unit: 'mmHg', shape: { sys: 'number', dia: 'number', pulse: 'number' }, primary_series: ['sys', 'dia'] }],
]);
const sourceIds = new Set(['manual', 'lab']);
eq('valid reading passes', validateReading({ ts: '2026-08-03T07:30:00+03:00', type: 'weight', value: 82.4, src: 'manual' }, { types, sourceIds }).length, 0);
eq('composite reading passes', validateReading({ ts: '2026-08-03T07:30:00+03:00', type: 'bp', value: { sys: 128, dia: 82 }, src: 'manual' }, { types, sourceIds }).length, 0);
ok('timestamp without offset rejected', validateReading({ ts: '2026-08-03T07:30:00', type: 'weight', value: 82, src: 'manual' }, { types, sourceIds }).length > 0);
ok('missing primary component rejected', validateReading({ ts: '2026-08-03T07:30:00+03:00', type: 'bp', value: { sys: 128 }, src: 'manual' }, { types, sourceIds }).length > 0);
ok('undeclared component rejected', validateReading({ ts: '2026-08-03T07:30:00+03:00', type: 'bp', value: { sys: 128, dia: 80, oops: 1 }, src: 'manual' }, { types, sourceIds }).length > 0);
ok('unknown source rejected', validateReading({ ts: '2026-08-03T07:30:00+03:00', type: 'weight', value: 82, src: 'fitbit' }, { types, sourceIds }).length > 0);
ok('untagged BP warns', warnReading({ ts: 't', type: 'bp', value: {}, src: 'manual' }).length === 1);

// Daily-count metrics (bowl-count): integer, bounded, soft ceiling.
types.set('bowl-count', { id: 'bowl-count', name: 'Quark bowls eaten', unit: 'bowls', shape: 'number', value_type: 'integer', cadence: 'daily', min: 0, max: 6, warn_above: 4 });
const bowlAt = (value) => ({ ts: '2026-08-04T20:00:00+03:00', type: 'bowl-count', value, src: 'manual' });
eq('integer count passes', validateReading(bowlAt(3), { types, sourceIds }).length, 0);
ok('fractional count rejected', validateReading(bowlAt(2.5), { types, sourceIds }).length > 0);
ok('count above max rejected', validateReading(bowlAt(7), { types, sourceIds }).length > 0);
ok('negative count rejected', validateReading(bowlAt(-1), { types, sourceIds }).length > 0);
eq('five bowls is valid but warns', [validateReading(bowlAt(5), { types, sourceIds }).length, warnReading(bowlAt(5), types).length], [0, 1]);
eq('four bowls does not warn', warnReading(bowlAt(4), types).length, 0);

console.log('\n6. Statistics and aggregation');
eq('raw under 3 months', aggregationFor(60 * 86400000), 'raw');
eq('weekly under ~2 years', aggregationFor(300 * 86400000), 'weekly');
eq('monthly beyond', aggregationFor(1500 * 86400000), 'monthly');
const day = (n) => Date.parse(`2026-01-${String(n).padStart(2, '0')}T12:00:00Z`);
const weekly = aggregate([{ x: day(5), y: 10 }, { x: day(6), y: 20 }, { x: day(15), y: 40 }], 'weekly');
eq('weekly buckets average', weekly.map((p) => p.y), [15, 40]);
eq('raw mode passes through', aggregate([{ x: 1, y: 2 }], 'raw').length, 1);
const s = summarize([1, 2, 3, 4]);
eq('mean', s.mean, 2.5);
eq('n/min/max', [s.n, s.min, s.max], [4, 1, 4]);
eq('summarize of empty is null', summarize([]), null);
eq('tag beats clock', partOfDay({ ts: '2026-08-03T20:00:00+03:00', tags: ['morning'] }), { period: 'morning', inferred: false });
eq('clock is a marked fallback', partOfDay({ ts: '2026-08-03T20:00:00+03:00' }), { period: 'evening', inferred: true });
eq('volume ignores bodyweight sets', volume({ sets: [{ kg: 40, reps: 8 }, { reps: 10 }] }), 320);
eq('volume ignores assistance', volume({ sets: [{ kg: -20, reps: 8 }] }), 0);
eq('top set', topSetKg({ sets: [{ kg: 40, reps: 8 }, { kg: 50, reps: 3 }] }), 50);
eq('top set of bodyweight is null', topSetKg({ sets: [{ reps: 8 }] }), null);
eq('epley 1RM', estimated1RM({ sets: [{ kg: 100, reps: 5 }] }), 116.7);
eq('high-rep sets do not feed epley', estimated1RM({ sets: [{ kg: 60, reps: 20 }, { kg: 100, reps: 5 }] }), 116.7);
eq('only high-rep sets means no estimate', estimated1RM({ sets: [{ kg: 60, reps: 15 }] }), null);
eq('ten reps still counts', estimated1RM({ sets: [{ kg: 80, reps: 10 }] }), 106.7);

// Rolling best: a hypertrophy day must not read as a strength loss while a
// heavier exposure is still inside the window.
const rolled = rollingBest([
  { x: day(1), y: 116.7 },  // strength day
  { x: day(8), y: 106.7 },  // hypertrophy day
  { x: day(15), y: 120 },   // new best
], 28);
eq('light day holds the windowed best', rolled.map((p) => p.y), [116.7, 116.7, 120]);
const expired = rollingBest([{ x: day(1), y: 120 }, { x: day(31) + 86400000, y: 100 }], 28);
eq('best expires with the window', expired[1].y, 100);
eq('rolling best of empty is empty', rollingBest([]), []);

console.log('\n7. Cardio');
const run5k = { ex: 'run', sets: [{ km: 5, secs: 1920 }] };
const intervals = { ex: 'run', sets: [{ km: 0.4, secs: 92 }, { km: 0.4, secs: 94 }, { km: 0.4, secs: 96 }] };
eq('distance of a steady run', distance(run5k), 5);
eq('distance sums across intervals', distance(intervals), 1.2);
eq('distance of a lift is null', distance({ ex: 'squat', sets: [{ kg: 40, reps: 8 }] }), null);
eq('duration in seconds', duration(run5k), 1920);
eq('pace in minutes per km', Math.round(pace(run5k) * 100) / 100, 6.4);
eq('pace formatted', fmtPace(pace(run5k)), '6:24 /km');
eq('pace is null without a time', pace({ sets: [{ km: 5 }] }), null);
eq('pace rounding does not produce :60', fmtPace(5.999), '6:00 /km');
eq('cardio contributes no tonnage', volume(run5k), 0);
eq('cardio has no top set', topSetKg(run5k), null);
eq('valid cardio set passes', validateSession({ date: '2026-08-04', day: 'X', exercises: [run5k] }, { exerciseIds: new Set(['run']) }).length, 0);
eq('distance alone is enough', validateSession({ date: '2026-08-04', day: 'X', exercises: [{ ex: 'run', sets: [{ km: 5 }] }] }, { exerciseIds: new Set(['run']) }).length, 0);
ok('zero distance rejected', validateSession({ date: '2026-08-04', day: 'X', exercises: [{ ex: 'run', sets: [{ km: 0 }] }] }, { exerciseIds: new Set(['run']) }).length > 0);
ok('empty cardio set still rejected', validateSession({ date: '2026-08-04', day: 'X', exercises: [{ ex: 'run', sets: [{ rpe: 5 }] }] }, { exerciseIds: new Set(['run']) }).length > 0);
eq('km is ordered next to kg', Object.keys(orderSession({ date: 'd', day: 'X', exercises: [{ ex: 'run', sets: [{ secs: 1920, km: 5 }] }] }).exercises[0].sets[0]), ['km', 'secs']);
eq('hr summary is ordered after time', Object.keys(orderSession({ date: 'd', day: 'X', exercises: [{ ex: 'run', sets: [{ hr_max: 167, hr_avg: 142, secs: 1920, km: 5 }] }] }).exercises[0].sets[0]), ['km', 'secs', 'hr_avg', 'hr_max']);
eq('valid hr summary passes', validateSession({ date: '2026-08-04', day: 'X', exercises: [{ ex: 'run', sets: [{ km: 5, secs: 1800, hr_avg: 142, hr_max: 167 }] }] }, { exerciseIds: new Set(['run']) }).length, 0);
ok('fractional hr rejected', validateSession({ date: '2026-08-04', day: 'X', exercises: [{ ex: 'run', sets: [{ km: 5, secs: 1800, hr_avg: 142.6 }] }] }, { exerciseIds: new Set(['run']) }).length > 0);
ok('implausible hr rejected', validateSession({ date: '2026-08-04', day: 'X', exercises: [{ ex: 'run', sets: [{ km: 5, secs: 1800, hr_max: 260 }] }] }, { exerciseIds: new Set(['run']) }).length > 0);
ok('hr_avg above hr_max rejected', validateSession({ date: '2026-08-04', day: 'X', exercises: [{ ex: 'run', sets: [{ km: 5, secs: 1800, hr_avg: 180, hr_max: 150 }] }] }, { exerciseIds: new Set(['run']) }).length > 0);
ok('a cardio session serialises to one line', formatDataFile({ schema_version: 2, sessions: [{ date: '2026-08-04', day: 'X', exercises: [intervals] }] }).split('\n').filter((l) => l.includes('"km"')).length === 1);

console.log('\n8. Chart output');
const svg = chartSVG({ series: [{ name: 'a', color: '#000', points: [{ x: day(1), y: 1 }, { x: day(10), y: 5 }] }], unit: 'kg' });
ok('emits an svg element', svg.startsWith('<svg') && svg.endsWith('</svg>'));
ok('draws a path', svg.includes('<path class="series"'));
ok('no NaN in geometry', !/NaN/.test(svg));
ok('empty series is handled', chartSVG({ series: [] }).includes('No data'));
ok('single point does not divide by zero', !/NaN/.test(chartSVG({ series: [{ name: 'a', color: '#000', points: [{ x: day(1), y: 5 }] }] })));
ok('flat series does not divide by zero', !/NaN/.test(chartSVG({ series: [{ name: 'a', color: '#000', points: [{ x: day(1), y: 5 }, { x: day(2), y: 5 }] }] })));
ok('reference lines render', chartSVG({ series: [{ name: 'a', color: '#000', points: [{ x: day(1), y: 120 }] }], refLines: [{ y: 140, label: '140' }] }).includes('refline'));
const banded = chartSVG({
  series: [{ name: 'a', color: '#000', points: [{ x: day(1), y: 84 }, { x: day(10), y: 83 }] }],
  bands: { points: [{ x: day(2), y: 3 }, { x: day(3), y: 0 }, { x: day(4), y: 6 }], max: 6, name: 'bowls/day' },
});
ok('adherence bands render as rects', (banded.match(/class="band"/g) || []).length === 3);
ok('no NaN with bands', !/NaN/.test(banded));

// A selected date range pins the axis even where no data exists.
const domained = chartSVG({
  series: [{ name: 'a', color: '#000', points: [{ x: day(5), y: 1 }, { x: day(10), y: 5 }] }],
  xDomain: [day(1), Date.parse('2026-03-01T12:00:00Z')],
});
ok('x-axis starts at the domain, not the first point', domained.includes('>01.01.<'));
ok('no NaN with a clamped domain', !/NaN/.test(domained));

// clip mode (the full-screen viewer): domain taken exactly, marks clipped.
const clipped = chartSVG({
  series: [{ name: 'a', color: '#000', points: [{ x: day(1), y: 1 }, { x: day(5), y: 2 }, { x: day(20), y: 5 }] }],
  xDomain: [day(4), day(10)],
  clip: true,
});
ok('clip mode declares a clipPath', clipped.includes('<clipPath') && clipped.includes('clip-path="url(#'));
ok('clip mode pins the axis to the window, not the data', !clipped.includes('>01.01.<'));
ok('no NaN in clip mode', !/NaN/.test(clipped));

console.log('\n8. Service worker precache covers every module');
const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
const walk = (dir, out = []) => {
  for (const e of readdirSync(join(APP, dir), { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${dir}/${e.name}`, out);
    else if (e.name.endsWith('.js')) out.push(`${dir}/${e.name}`);
  }
  return out;
};
for (const f of walk('js')) ok(`precached: ${f}`, sw.includes(`'./${f}'`));

console.log(`\n${fail ? 'FAILED' : 'PASSED'} — ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
