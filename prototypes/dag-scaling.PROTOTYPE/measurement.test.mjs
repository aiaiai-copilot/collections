import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMeasurementFixture, measurementRequests } from './measurement-fixture.mjs';
import { runMeasuredJob } from './measurement-runner.mjs';

test('pilot profile has exact cardinalities, reproducible data and controlled selectivities', () => {
  const fixture = makeMeasurementFixture({ count: 10000, seed: 23 });
  assert.deepEqual(fixture, makeMeasurementFixture({ count: 10000, seed: 23 }));
  assert.notDeepEqual(fixture.items, makeMeasurementFixture({ count: 10000, seed: 24 }).items);
  assert.equal(fixture.items.length, 10000);
  assert.equal(fixture.nodes.length, 100);
  assert.equal(new Set(fixture.nodes.map(n => JSON.stringify([...n.tags].sort()))).size, 100);
  assert.ok(fixture.items.every(item => new Set(item.tags).size === 10));
  assert.equal(new Set(fixture.items.flatMap(item => item.tags)).size, 1000);
  const totals = measurementRequests().filter(q => q.request.mode === 'nodes').map(q =>
    fixture.items.filter(item => q.request.tags.every(tag => item.tags.includes(tag))).length);
  assert.deepEqual(totals, [10000, 1000, 100, 1, 0]);
  for (const count of [0, 99, 10001, 1.5, NaN]) {
    assert.throws(() => makeMeasurementFixture({ count, seed: 23 }), RangeError);
  }
  assert.throws(() => makeMeasurementFixture({ count: 100, seed: -1 }), RangeError);
});

test('isolated job verifies complete answers then records full reads, source stages and payloads', async () => {
  const config = { count: 100, seed: 23, samples: 1 };
  const verified = await runMeasuredJob({ ...config, candidate: 'verify' });
  assert.equal(verified.status, 'ok');
  assert.deepEqual(verified.result.fixture.tagFrequency, { min: 1, median: 1, max: 10 });
  assert.equal(Object.keys(verified.result.answers).length, 10);
  for (const candidate of ['scan', 'index']) {
    const run = await runMeasuredJob({ ...config, candidate, expected: verified.result.answers });
    assert.equal(run.status, 'ok');
    assert.equal(run.result.fixture.sha256, verified.result.fixture.sha256);
    assert.equal(run.result.queries.length, 10);
    const all = run.result.queries.find(q => q.name === 'free/all');
    assert.equal(all.samples.length, 1);
    assert.equal(all.first.total, 100);
    assert.equal(all.first.pageItems, 20);
    assert.ok(all.first.transitions > 20);
    assert.equal(all.first.countBatch, all.first.transitions + 1);
    assert.deepEqual(Object.keys(all.first.sourceMs).sort(), ['count', 'extraTags', 'page', 'related']);
    assert.ok(all.first.sourceResponseBytes.related > 0);
    assert.ok(all.first.viewBytes > 0);
    assert.ok(all.first.readMs >= 0);
    assert.equal(all.first.answerSHA256, verified.result.answers['free/all']);
    assert.ok(run.result.memory.afterBuild.rss > 0);
  }
});

test('watchdog stops an owned child even while its event loop is synchronously blocked', async () => {
  const outcome = await runMeasuredJob({ candidate: 'verify', count: 100, seed: 23, samples: 1 }, {
    workerURL: new URL('./measurement-blocked.TEST.mjs', import.meta.url),
    limits: { stepMs: 500, wallMs: 5000 },
  });
  assert.equal(outcome.status, 'step-timeout');
  assert.equal(outcome.phase, 'blocked');
  assert.equal(outcome.signal, 'SIGKILL');
  assert.ok(outcome.elapsedMs < 5000);
});

test('resource budgets fail closed and are reported, never silently discarded', async () => {
  const job = { candidate: 'verify', count: 100, seed: 23, samples: 1 };
  const workerURL = new URL('./measurement-blocked.TEST.mjs', import.meta.url);
  const wall = await runMeasuredJob(job, { workerURL, limits: { wallMs: 100, stepMs: 500 } });
  assert.equal(wall.status, 'wall-timeout');
  const rss = await runMeasuredJob(job, { workerURL, readRss: async () => 1000000, limits: { rssBytes: 1 } });
  assert.equal(rss.status, 'rss-limit');
  const output = await runMeasuredJob(job, { workerURL, limits: { outputBytes: 1 } });
  assert.equal(output.status, 'output-limit');
  await assert.rejects(runMeasuredJob(job, { readRss: async () => { throw new Error('unavailable'); } }), /unavailable/);
  await assert.rejects(runMeasuredJob({ ...job, count: 10001 }), /invalid pilot job/);
  await assert.rejects(runMeasuredJob(job, { limits: { wallMs: 120001 } }), /invalid wallMs/);
  await assert.rejects(runMeasuredJob({ ...job, candidate: 'index' }), /verified full-answer/);
});

test('incorrect complete-answer digest stops measurement with an explicit error', async () => {
  const outcome = await runMeasuredJob({ candidate: 'index', count: 100, seed: 23, samples: 1,
    expected: Object.fromEntries(measurementRequests().map(query => [query.name, 'wrong'])) });
  assert.equal(outcome.status, 'worker-failed');
  assert.match(outcome.failure.message, /full answer differs/);
  assert.deepEqual(outcome.completed, []);
});
