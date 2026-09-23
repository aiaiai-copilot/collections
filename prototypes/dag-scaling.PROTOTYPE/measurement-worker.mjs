// PROTOTYPE: static synthetic job, only launched by the bounded supervisor.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createScanSource } from './scan-source.mjs';
import { createIndexSource } from './index-source.mjs';
import { readNavigation } from './navigation.mjs';
import { makeMeasurementFixture, measurementRequests } from './measurement-fixture.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
const phase = name => send({ type: 'phase', name });
const memory = () => process.memoryUsage();

function fixtureInfo(fixture) {
  const frequencies = new Map();
  for (const item of fixture.items) for (const tag of item.tags) frequencies.set(tag, (frequencies.get(tag) ?? 0) + 1);
  const sorted = [...frequencies.values()].sort((a, b) => a - b);
  return {
    sha256: hash(fixture), jsonBytes: Buffer.byteLength(JSON.stringify(fixture)),
    items: fixture.items.length, nodes: fixture.nodes.length, vocabulary: frequencies.size,
    assignments: sorted.reduce((sum, n) => sum + n, 0),
    tagFrequency: { min: sorted[0], median: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2, max: sorted.at(-1) },
  };
}

function observedSource(source) {
  const observations = {};
  const adapter = { revision: source.revision };
  for (const key of ['collection', 'related', 'count', 'extraTags', 'page']) {
    adapter[key] = (...args) => {
      const start = performance.now();
      const answer = source[key](...args);
      observations[key] = { ms: performance.now() - start, answer };
      return answer;
    };
  }
  return { adapter, observations };
}

function measure(source, request, expected) {
  const { adapter, observations } = observedSource(source);
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  const answer = readNavigation(adapter, request);
  const readMs = performance.now() - start;
  const cpuUs = process.cpuUsage(cpuStart);
  assert.equal(answer.status, 'ok');
  const answerSHA256 = hash(answer); // Verification / hashing is outside the timed read.
  assert.equal(answerSHA256, expected, 'full answer differs from independent verification');
  const { sourceFacts, ...view } = answer.value;
  const serializeStart = performance.now();
  const sourceResponseBytes = Object.fromEntries(Object.entries(observations).map(([key, value]) =>
    [key, Buffer.byteLength(JSON.stringify(value.answer))]));
  const viewBytes = Buffer.byteLength(JSON.stringify({ status: answer.status, revision: answer.revision, value: view }));
  const serializationMs = performance.now() - serializeStart;
  const sourceMs = Object.fromEntries(Object.entries(observations).map(([key, value]) => [key, value.ms]));
  return {
    readMs, cpuUs, sourceMs, assemblyMs: readMs - Object.values(sourceMs).reduce((a, b) => a + b, 0),
    serializationMs, sourceResponseBytes, viewBytes, answerSHA256,
    total: view.total, transitions: view.transitions.length, parents: view.parents.length,
    countBatch: sourceFacts.counts.length, pageItems: view.page.items.length,
    related: { wider: sourceFacts.related.wider.length, narrower: sourceFacts.related.narrower.length, equal: !!sourceFacts.related.equal },
    memory: memory(),
  };
}

async function run(job) {
  await phase('generation');
  const baseline = memory();
  const generationStart = performance.now();
  const fixture = makeMeasurementFixture(job);
  const generationMs = performance.now() - generationStart;
  const afterGeneration = memory();
  await phase('build');
  const buildStart = performance.now();
  const source = (job.candidate === 'index' ? createIndexSource : createScanSource)(fixture);
  const second = job.candidate === 'verify' ? createIndexSource(fixture) : null;
  const buildMs = performance.now() - buildStart;
  const afterBuild = memory();
  const answers = {}, queries = [];
  for (const query of measurementRequests()) {
    if (job.candidate === 'verify') {
      await phase(`verify/${query.name}`);
      const expected = readNavigation(source, query.request);
      assert.equal(expected.status, 'ok');
      assert.deepEqual(readNavigation(second, query.request), expected);
      answers[query.name] = hash(expected);
    } else {
      await phase(`first/${query.name}`);
      const first = measure(source, query.request, job.expected[query.name]);
      await phase(`warmup/${query.name}`);
      measure(source, query.request, job.expected[query.name]);
      const samples = [];
      for (let i = 0; i < job.samples; i++) {
        await phase(`sample-${i}/${query.name}`);
        samples.push(measure(source, query.request, job.expected[query.name]));
      }
      const value = { ...query, first, samples };
      queries.push(value);
      await send({ type: 'completed', value });
    }
  }
  await phase('metadata');
  // Input remains alive through the experiment. RSS includes input + source snapshot,
  // indexes, returned answers and normal GC; it is NOT the isolated index size.
  return {
    candidate: job.candidate, node: process.version, execArgv: process.execArgv,
    fixture: fixtureInfo(fixture), generationMs, buildMs,
    memory: { baseline, afterGeneration, afterBuild, end: memory() },
    ...(job.candidate === 'verify' ? { answers } : { queries }),
  };
}

process.once('message', async job => {
  try { await send({ type: 'result', value: await run(job) }); }
  catch (error) { process.exitCode = 1; await send({ type: 'failure', value: { name: error.name, message: error.message } }); }
  finally { process.disconnect(); }
});
