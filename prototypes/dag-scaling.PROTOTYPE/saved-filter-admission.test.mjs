import test from 'node:test';
import assert from 'node:assert/strict';
import { savedFilterRequests } from './saved-filter-fixture.mjs';
import { savedFilterAdmission } from './saved-filter-admission.mjs';

const profile = { variant: 'main', seed: 23, savedNodes: 100 };
const memory = { rss: 100 * 1024 ** 2 };
function completePoint() {
  const reading = { readMs: 6, sourceMs: { related: 1, extraTags: 1, count: 1, page: 1 },
    transitionPreparationMs: 1, otherAssemblyMs: 1, postReadMs: 1, itemTags: 1000,
    countBatch: 101, memory };
  const row = (kind, query, run, readings) => ({ status: 'ok', kind, query, run, profile,
    elapsedMs: 100, rssMax: 120 * 1024 ** 2, phases: [{ memory, ms: 1 }],
    result: { generationMs: 10, buildMs: 10, metadataMs: 10, metadataCountMs: 2,
      memory: { baseline: memory, end: memory }, readings } });
  return [row('metadata', undefined, undefined, []), ...savedFilterRequests(profile).flatMap(q => [
    row('verify', q.name, undefined, ['scan', 'index'].map(candidate => ({ ...reading, candidate, stage: 'verify' }))),
    ...[1, 2, 3].map(run => row('index', q.name, run,
      ['first', 'warmup', ...Array(5).fill('sample')].map(stage => ({ ...reading, candidate: 'index', stage })))),
  ])];
}
test('saved-filter admission uses quadratic preparation, batch growth and per-job memory baselines', () => {
  const result = savedFilterAdmission(completePoint(), 1000);
  assert.equal(result.allowed, true);
  const job = result.jobs.find(j => j.kind === 'index' && j.query === 'nodes/all');
  assert.equal(job.projectedRSS, 375 * 1024 ** 2);
  assert.equal(job.reads[0].terms.transitionPreparationMs, 100);
  assert.equal(job.reads[0].terms.count, 1001 / 101);
  assert.equal(job.reads[0].terms.extraTags, 1);
  assert.ok(Math.abs(job.projectedJobMs - 1.25 * (58 * 10 + 7 * (122 + 1001 / 101))) < 0.0001);
});

test('missing, failed or nonnumeric observations cannot admit the next saved-filter step', () => {
  const missing = completePoint().slice(1);
  assert.throws(() => savedFilterAdmission(missing, 1000));
  for (const alter of [rows => { rows[1].status = 'failed'; },
    rows => { rows[1].result.readings[0].transitionPreparationMs = NaN; },
    rows => { rows[1].result.readings[0].countBatch = 0; },
    rows => { rows[2].run = 2; }, rows => { rows[2].result.readings.pop(); },
    rows => { rows[1].profile = { ...profile, seed: 47 }; }]) {
    const rows = completePoint(); alter(rows);
    assert.throws(() => savedFilterAdmission(rows, 1000));
  }
});

test('the entire seven-read job can refuse a step even when each projected read fits', () => {
  const rows = completePoint(), row = rows.find(r => r.kind === 'index');
  for (const r of row.result.readings) { r.transitionPreparationMs = 140; r.readMs = 145; }
  row.elapsedMs = 1100;
  const gate = savedFilterAdmission(rows, 1000), job = gate.jobs.find(j => j.kind === 'index');
  assert.ok(job.reads.every(r => r.projectedReadMs < 20000));
  assert.ok(job.projectedJobMs > 100000);
  assert.equal(gate.allowed, false);
});

test('memory, metadata work and full scan time each independently refuse admission', () => {
  for (const alter of [rows => { rows[0].rssMax = 2 * 1024 ** 3; },
    rows => { rows[0].result.metadataCountMs = 3000; },
    rows => { const r = rows[1].result.readings[0]; r.transitionPreparationMs = 200; r.readMs = 205; rows[1].elapsedMs = 300; }]) {
    const rows = completePoint(); alter(rows);
    assert.equal(savedFilterAdmission(rows, 1000).allowed, false);
  }
});
