import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeMeasurementFixture } from './measurement-fixture.mjs';
import { createManifest, readPartition, createFullFixture, digest } from './million-fixture.mjs';
import { prepareOracle, readOraclePart } from './million-oracle.mjs';
import { measurementRequests } from './measurement-fixture.mjs';
import { createScanSource } from './scan-source.mjs';
import { readNavigation } from './navigation.mjs';
import { runMillionJob, admission } from './million-runner.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('owned workers build a manifest, verify a partition and measure an index against a complete digest', async () => {
  const made = await runMillionJob({ kind: 'manifest', profile: { count: 100, seed: 23 }, chunkSize: 37 });
  assert.equal(made.status, 'ok');
  const manifest = made.result;
  const { request, name } = measurementRequests().find(q => q.name === 'free/all');
  const expected = await prepareOracle(manifest, request, async (job, deadline) => {
    const result = await runMillionJob({ kind: 'oracle', ...job }, { deadline });
    assert.equal(result.status, 'ok'); return result.result;
  });
  const measured = await runMillionJob({ kind: 'index', manifest, queryNames: [name], expected: { [name]: expected.answerSHA256 }, samples: 1 });
  assert.equal(measured.status, 'ok');
  assert.equal(measured.result.queries[0].samples[0].answerSHA256, expected.answerSHA256);
  assert.equal(measured.result.queries[0].samples[0].total, 100);
  assert.deepEqual(measured.result.fixture, manifest.fixture);
  assert.ok(measured.phases.length > 0);
});

test('two-pass oracle returns all ten complete answers and a globally offset page from partial partitions', async () => {
  const manifest = createManifest({ count: 113, seed: 47 }, 37);
  const scan = createScanSource(makeMeasurementFixture(manifest.profile));
  for (const { request } of measurementRequests()) {
    const query = { ...request, offset: 2, limit: 5 };
    const result = await prepareOracle(manifest, query, job => readOraclePart(job));
    assert.deepEqual(result.answer, readNavigation(scan, query));
    assert.equal(result.answerSHA256, hash(result.answer));
  }
});

test('oracle fails closed on missing/replayed/corrupt answers, worker failure, or a total deadline', async () => {
  const manifest = createManifest({ count: 113, seed: 23 }, 37);
  const request = { tags: [], mode: 'free', offset: 0, limit: 20 };
  for (const mutate of [
    value => ({ ...value, index: value.index + 1 }),
    value => ({ ...value, revision: 'other' }),
    value => ({ ...value, value: [] }),
  ]) await assert.rejects(prepareOracle(manifest, request, job => mutate(readOraclePart(job))));
  await assert.rejects(prepareOracle(manifest, request, () => undefined));
  await assert.rejects(prepareOracle(manifest, request, () => { throw new Error('worker failed'); }), /worker failed/);
  await assert.rejects(prepareOracle(manifest, request, async job => {
    await new Promise(resolve => setTimeout(resolve, 15)); return readOraclePart(job);
  }, { timeoutMs: 5 }), /oracle deadline/);
});

test('a missing, repeated, overlapping or corrupted partition cannot be read as a valid snapshot', () => {
  const manifest = createManifest({ count: 113, seed: 23 }, 37);
  const resign = value => { const { id, ...body } = value; return { ...body, id: digest(body) }; };
  const mutations = [
    m => m.parts.pop(), m => m.parts.splice(1, 0, m.parts[0]),
    m => m.parts[1].start--, m => m.parts[1].before++,
    m => m.revision = 'wrong-revision', m => m.profile.count = 1000001,
    m => m.nodes[0].name = 'wrong-nodes', m => m.parts[0].sha256 = '0'.repeat(64),
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(manifest); mutate(invalid);
    assert.throws(() => readPartition(resign(invalid), 0));
  }
  const invalid = structuredClone(manifest); invalid.fixture.sha256 = '0'.repeat(64);
  assert.throws(() => createFullFixture(invalid));
});

test('supervisor enforces total and step deadlines plus coordinator/worker budgets without raising ceilings', async () => {
  const job = { kind: 'manifest', profile: { count: 100, seed: 23 } };
  const blocked = new URL('./measurement-blocked.TEST.mjs', import.meta.url);
  assert.equal((await runMillionJob(job, { deadline: Date.now() - 1 })).status, 'deadline');
  assert.equal((await runMillionJob(job, { workerURL: blocked, deadline: Date.now() + 150 })).status, 'deadline');
  assert.equal((await runMillionJob(job, { workerURL: blocked, limits: { stepMs: 150 } })).status, 'step-timeout');
  assert.equal((await runMillionJob(job, { workerURL: blocked, limits: { rssBytes: 1 } })).status, 'rss-limit');
  assert.equal((await runMillionJob(job, { limits: { ownerBytes: 1 } })).status, 'coordinator-rss-limit');
  await assert.rejects(runMillionJob(job, { readRss: async () => { throw new Error('no observer'); } }), /no observer/);
  await assert.rejects(runMillionJob(job, { limits: { wallMs: 120001 } }), /invalid wallMs/);
  const failed = await runMillionJob({ kind: 'oracle', manifest: createManifest({ count: 100, seed: 23 }), index: 999, request: { tags: [], offset: 0, limit: 20 }, stage: 'tags' });
  assert.equal(failed.status, 'worker-failed');
});

test('next scale is refused before allocation when memory or a whole-step estimate lacks reserve', () => {
  const memory = { baseline: { rss: 50 * 1024 ** 2 }, afterBuild: { rss: 500 * 1024 ** 2 } };
  const previous = { count: 100000, status: 'ok', result: { memory }, rssMax: 600 * 1024 ** 2, phases: [{ ms: 1000, memory: memory.afterBuild }] };
  assert.equal(admission(previous, 250000).allowed, true);
  assert.equal(admission(previous, 1000000).allowed, false);
  assert.equal(admission({ ...previous, phases: [{ ms: 10000 }] }, 250000).allowed, false);
  assert.throws(() => admission({ ...previous, status: 'deadline' }, 250000));
});
