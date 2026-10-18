import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { makeMeasurementFixture } from './measurement-fixture.mjs';
import { groupedAdmission, resumeSmoke } from './grouped-runner.mjs';

test('a continuation reuses only a complete matching smoke with unchanged measurement code', () => {
  const records = readFileSync(new URL('./results/density-S1-2026-09-27.jsonl', import.meta.url), 'utf8')
    .trim().split('\n').map(JSON.parse);
  const header = records[0];
  const expected = { profile: header.profile, codeSHA256: header.codeSHA256 };
  assert.equal(resumeSmoke(records, expected).length, 2);
  assert.throws(() => resumeSmoke(records.filter(r => r.type !== 'group-complete'), expected));
  assert.throws(() => resumeSmoke(records, { ...expected, profile: { ...header.profile, seed: 47 } }));
  assert.throws(() => resumeSmoke(records, { ...expected,
    codeSHA256: { ...header.codeSHA256, 'measurement-worker.mjs': 'changed' } }));
  assert.throws(() => resumeSmoke([...records, { type: 'measurement', count: 10000 }], expected));
});

test('group resource forecast keeps process startup fixed but scales data-dependent work', () => {
  // Minimal replay of the rejected 100 -> 10k smoke: 170ms startup,
  // no data-dependent phase above 32ms, 50 -> 64MiB RSS.
  const row = { status: 'ok', count: 100, elapsedMs: 208, rssMax: 0,
    phases: [{ name: 'startup', ms: 170 }, { name: 'generation', ms: 3 },
      { name: 'build', ms: 2 }, { name: 'verify/free/all', ms: 32 }],
    result: { memory: { baseline: { rss: 50 * 1024 ** 2 }, end: { rss: 64 * 1024 ** 2 } } } };
  assert.equal(groupedAdmission(row, 10000).allowed, true);
  const slowRead = { ...row, phases: [...row.phases, { name: 'verify/free/ten-percent', ms: 170 }] };
  assert.equal(groupedAdmission(slowRead, 10000).allowed, false);
  const slowStartup = { ...row, phases: [{ name: 'startup', ms: 17000 }, ...row.phases.slice(1)] };
  assert.equal(groupedAdmission(slowStartup, 10000).allowed, false);
  assert.equal(groupedAdmission({ ...row, elapsedMs: 1000 }, 10000).allowed, false);
  assert.equal(groupedAdmission({ ...row, rssMax: 100 * 1024 ** 2 }, 10000).allowed, false);
});

test('density profile adds tags without losing the measured control or its fixed selections', () => {
  const base = makeMeasurementFixture({ count: 100, seed: 23 });
  const dense = makeMeasurementFixture({ count: 100, seed: 23, tagsPerItem: 30 });
  assert.ok(dense.items.every(item => new Set(item.tags).size === 30));
  assert.deepEqual(dense.nodes, base.nodes);
  for (const [i, item] of dense.items.entries()) {
    assert.equal(item.id, base.items[i].id);
    assert.ok(base.items[i].tags.every(tag => item.tags.includes(tag)));
  }
  assert.deepEqual(['тег_0000', 'тег_0001', 'тег_0002'].map(tag =>
    dense.items.filter(item => item.tags.includes(tag)).length), [10, 1, 1]);
  assert.notEqual(dense.revision, base.revision);
  assert.deepEqual(dense, makeMeasurementFixture({ count: 100, seed: 23, tagsPerItem: 30 }));
  const old = makeMeasurementFixture({ count: 10000, seed: 23 });
  assert.equal(createHash('sha256').update(JSON.stringify(old)).digest('hex'),
    'b177382e70ca141d0a0423124f8e9e73a22a67d9f4263f4a376e9a3dd1ac116d');
  assert.throws(() => makeMeasurementFixture({ count: 100, tagsPerItem: 31 }), /density/);
});

test('group admission rejects unverified and expanded workloads before starting a worker', async () => {
  const { runGroupedJob } = await import('./grouped-runner.mjs');
  const job = { candidate: 'verify', count: 100, seed: 23, tagsPerItem: 30,
    samples: 1, queryNames: ['nodes/all'] };
  for (const overrides of [{ count: 100001 }, { tagsPerItem: 31 }, { samples: 6 },
    { vocabulary: 10000 }, { queryNames: [] }, { queryNames: ['nodes/all', 'nodes/all'] }]) {
    assert.throws(() => runGroupedJob({ ...job, ...overrides }));
  }
  assert.throws(() => runGroupedJob({ ...job, candidate: 'index' }), /fixture digest/);
  assert.throws(() => runGroupedJob({ ...job, candidate: 'index', expectedFixtureSHA256: '0'.repeat(64) }), /answer digests/);
  assert.equal((await runGroupedJob(job, { deadline: Date.now() - 1 })).status, 'deadline');
});

test('failure on a later grouped read retains the already completed measurements', async () => {
  const { runGroupedJob } = await import('./grouped-runner.mjs');
  const job = { count: 100, seed: 23, tagsPerItem: 30, samples: 1,
    queryNames: ['nodes/all', 'free/all'] };
  const verified = await runGroupedJob({ ...job, candidate: 'verify' });
  assert.equal(verified.status, 'ok');
  const outcome = await runGroupedJob({ ...job, candidate: 'index',
    expectedFixtureSHA256: verified.result.fixture.sha256,
    expected: { ...verified.result.answers, 'free/all': '0'.repeat(64) } });
  assert.equal(outcome.status, 'worker-failed');
  assert.match(outcome.failure.message, /full answer differs/);
  assert.deepEqual(outcome.completed.map(q => q.name), ['nodes/all']);
  assert.equal(outcome.completed[0].first.total, 100);
});

test('one prepared group serves both modes and slices, with honest first-read labels', async () => {
  const { runGroupedJob } = await import('./grouped-runner.mjs');
  const job = { count: 100, seed: 23, tagsPerItem: 30, samples: 1,
    queryNames: ['nodes/all', 'free/all', 'nodes/ten-percent', 'free/ten-percent'] };
  const verified = await runGroupedJob({ ...job, candidate: 'verify' });
  assert.equal(verified.status, 'ok');
  assert.equal(verified.result.fixture.assignments, 3000);
  const measured = await runGroupedJob({ ...job, candidate: 'index', expected: verified.result.answers,
    expectedFixtureSHA256: verified.result.fixture.sha256 });
  assert.equal(measured.status, 'ok');
  assert.equal(measured.phases.filter(p => p.name === 'generation').length, 1);
  assert.equal(measured.phases.filter(p => p.name === 'build').length, 1);
  assert.deepEqual(measured.result.queries.map(q => q.first.total), [100, 100, 10, 10]);
  assert.deepEqual(measured.result.queries.map(q => q.firstContext),
    ['first-in-group', 'after-prior-queries', 'after-prior-queries', 'after-prior-queries']);
  for (const q of measured.result.queries) {
    assert.equal(q.preparationId, measured.result.preparationId);
    assert.equal(q.first.answerSHA256, verified.result.answers[q.name]);
    assert.equal(q.samples.length, 1);
  }
});
