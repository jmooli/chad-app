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
const { aggregate, aggregationFor, summarize, partOfDay, estimated1RM, topSetKg, volume } = await import(`file://${APP}/js/stats.js`);
const { chartSVG } = await import(`file://${APP}/js/chart.js`);

console.log('\n1. Serializer matches the data repo byte-for-byte');
if (existsSync(join(DATA, 'README.md'))) {
  const dataFiles = [
    'registry/exercises.json', 'registry/metric-types.json', 'registry/sources.json',
    'plan/current.json', 'logs/logs-2026.json', 'metrics/metrics-2026.json',
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

console.log('\n5. Client-side validation');
const exerciseIds = new Set(['squat', 'pullup']);
eq('valid session passes', validateSession({ date: '2026-08-01', day: 'A', exercises: [{ ex: 'squat', sets: [{ kg: 40, reps: 8 }] }] }, { exerciseIds }).length, 0);
ok('unknown exercise rejected', validateSession({ date: '2026-08-01', day: 'A', exercises: [{ ex: 'nope', sets: [{ reps: 1 }] }] }, { exerciseIds }).length > 0);
ok('set without reps or secs rejected', validateSession({ date: '2026-08-01', day: 'A', exercises: [{ ex: 'squat', sets: [{ kg: 40 }] }] }, { exerciseIds }).length > 0);
ok('bad date rejected', validateSession({ date: '1.8.2026', day: 'A', exercises: [{ ex: 'squat', sets: [{ reps: 1 }] }] }, { exerciseIds }).length > 0);
ok('rpe out of range rejected', validateSession({ date: '2026-08-01', day: 'A', exercises: [{ ex: 'squat', sets: [{ reps: 5, rpe: 12 }] }] }, { exerciseIds }).length > 0);

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

console.log('\n7. Chart output');
const svg = chartSVG({ series: [{ name: 'a', color: '#000', points: [{ x: day(1), y: 1 }, { x: day(10), y: 5 }] }], unit: 'kg' });
ok('emits an svg element', svg.startsWith('<svg') && svg.endsWith('</svg>'));
ok('draws a path', svg.includes('<path class="series"'));
ok('no NaN in geometry', !/NaN/.test(svg));
ok('empty series is handled', chartSVG({ series: [] }).includes('No data'));
ok('single point does not divide by zero', !/NaN/.test(chartSVG({ series: [{ name: 'a', color: '#000', points: [{ x: day(1), y: 5 }] }] })));
ok('flat series does not divide by zero', !/NaN/.test(chartSVG({ series: [{ name: 'a', color: '#000', points: [{ x: day(1), y: 5 }, { x: day(2), y: 5 }] }] })));
ok('reference lines render', chartSVG({ series: [{ name: 'a', color: '#000', points: [{ x: day(1), y: 120 }] }], refLines: [{ y: 140, label: '140' }] }).includes('refline'));

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
