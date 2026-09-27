import test from 'node:test';
import assert from 'node:assert/strict';
import { runSavedFilterJob } from './saved-filter-runner.mjs';
import { readRss } from './measurement-runner.mjs';

const profile = { variant: 'smoke', seed: 23, savedNodes: 100 };
test('bounded metadata job reports the whole saved-filter profile without a million manifest', async () => {
  const result = await runSavedFilterJob({ kind: 'metadata', profile });
  assert.equal(result.status, 'ok');
  const info = result.result.fixture;
  assert.equal(info.items, 100);
  assert.equal(info.nodes, 100);
  assert.equal(info.zeroNodes, 95);
  assert.equal(info.structure.roots, 100);
  assert.equal(info.structure.depth, 1);
  assert.equal(info.structure.edges, 0);
  assert.equal(info.structure.nodeVocabulary, 20);
  assert.deepEqual(info.structure.degree, { min: 10, max: 10 });
  for (const key of ['sha256', 'itemsSHA256', 'nodesSHA256']) assert.match(info[key], /^[a-f0-9]{64}$/);
  assert.ok(result.result.metadataCountMs >= 0);
});

test('unverified reads and out-of-profile workloads are rejected before allocation', () => {
  assert.throws(() => runSavedFilterJob({ kind: 'index', profile, query: 'nodes/all', samples: 1 }), /digest/);
  assert.throws(() => runSavedFilterJob({ kind: 'verify', profile, query: 'invalid' }), /query/);
  assert.throws(() => runSavedFilterJob({ kind: 'metadata', profile: { ...profile, savedNodes: 10000 } }), /profile/);
});

test('wrong full-answer digest is a worker failure, not a measurement', async () => {
  const row = await runSavedFilterJob({ kind: 'index', profile, query: 'nodes/all', samples: 1, expected: '0'.repeat(64) });
  assert.equal(row.status, 'worker-failed');
  assert.match(row.failure.message, /differs from scan/);
});

test('saved-filter supervision retains deadlines and live-child observation failures', async () => {
  const job = { kind: 'metadata', profile };
  assert.equal((await runSavedFilterJob(job, { deadline: Date.now() - 1 })).status, 'deadline');
  const workerURL = new URL('./million-lifecycle-worker.TEST.mjs', import.meta.url);
  const stopped = await runSavedFilterJob(job, { workerURL, limits: { stepMs: 100 } });
  assert.equal(stopped.status, 'step-timeout');
  assert.equal(stopped.signal, 'SIGKILL');
  const observation = await runSavedFilterJob(job, { workerURL, readRss: async pid => {
    if (pid === process.pid) return readRss(pid);
    throw new Error('live child observer unavailable');
  } });
  assert.equal(observation.status, 'rss-observation-failed');
  assert.equal(observation.observationIssues[0].process.terminal, false);
});

test('one full scan-verified query records source work and transition preparation separately', async () => {
  const verification = await runSavedFilterJob({ kind: 'verify', profile, query: 'nodes/all' });
  assert.equal(verification.status, 'ok');
  const expected = verification.result.readings[0].answerSHA256;
  assert.equal(verification.result.readings[1].answerSHA256, expected);
  const indexed = await runSavedFilterJob({ kind: 'index', profile, query: 'nodes/all', expected, samples: 1 });
  assert.equal(indexed.status, 'ok');
  assert.deepEqual(indexed.result.readings.map(r => r.stage), ['first', 'warmup', 'sample']);
  for (const reading of [...verification.result.readings, ...indexed.result.readings]) {
    assert.equal(reading.total, 100);
    assert.equal(reading.transitions, 100);
    assert.equal(reading.coverage, 100);
    assert.equal(reading.countBatch, 101);
    assert.ok(reading.transitionPreparationMs >= 0);
    assert.ok(reading.otherAssemblyMs >= 0);
    assert.ok(Math.abs(reading.readMs - reading.transitionPreparationMs - reading.otherAssemblyMs -
      Object.values(reading.sourceMs).reduce((a, b) => a + b, 0)) < 0.00001);
    assert.equal(reading.answerSHA256, expected);
    assert.ok(reading.postReadMs >= 0 && reading.viewBytes > 0);
  }
});
