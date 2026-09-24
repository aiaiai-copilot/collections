// PROTOTYPE: isolated manifest/oracle/index job; no product config or network.
import assert from 'node:assert/strict';
import { createManifest, createFullFixture, summarizeFixture, digest } from './million-fixture.mjs';
import { readOraclePart } from './million-oracle.mjs';
import { createIndexSource } from './index-source.mjs';
import { readNavigation } from './navigation.mjs';
import { measurementRequests } from './measurement-fixture.mjs';

const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
const phase = name => send({ type: 'phase', name, memory: process.memoryUsage() });

// Same measured path/fields as measurement-worker; hashing and JSON remain outside readMs.
function measure(source, request, expected) {
  const observations = {}, adapter = { revision: source.revision };
  for (const key of ['collection', 'related', 'count', 'extraTags', 'page']) {
    adapter[key] = (...args) => {
      const start = performance.now(), answer = source[key](...args);
      observations[key] = { ms: performance.now() - start, answer }; return answer;
    };
  }
  const cpuStart = process.cpuUsage(), start = performance.now();
  const answer = readNavigation(adapter, request), readMs = performance.now() - start, cpuUs = process.cpuUsage(cpuStart);
  assert.equal(answer.status, 'ok'); const answerSHA256 = digest(answer);
  assert.equal(answerSHA256, expected, 'full answer differs from partition oracle');
  const { sourceFacts, ...view } = answer.value;
  const serializeStart = performance.now();
  const sourceResponseBytes = Object.fromEntries(Object.entries(observations).map(([k, v]) => [k, Buffer.byteLength(JSON.stringify(v.answer))]));
  const viewBytes = Buffer.byteLength(JSON.stringify({ status: answer.status, revision: answer.revision, value: view }));
  const serializationMs = performance.now() - serializeStart;
  const sourceMs = Object.fromEntries(Object.entries(observations).map(([k, v]) => [k, v.ms]));
  return { readMs, cpuUs, sourceMs, assemblyMs: readMs - Object.values(sourceMs).reduce((a, b) => a + b, 0),
    serializationMs, sourceResponseBytes, viewBytes, answerSHA256, total: view.total,
    transitions: view.transitions.length, parents: view.parents.length, countBatch: sourceFacts.counts.length, pageItems: view.page.items.length,
    related: { wider: sourceFacts.related.wider.length, narrower: sourceFacts.related.narrower.length, equal: !!sourceFacts.related.equal }, memory: process.memoryUsage() };
}
async function run(job) {
  if (job.kind === 'manifest') { await phase('stream-manifest'); return createManifest(job.profile, job.chunkSize); }
  if (job.kind === 'oracle') { await phase(`oracle-${job.stage}`); return readOraclePart(job); }
  await phase('generation'); const baseline = process.memoryUsage(), generationStart = performance.now();
  const fixture = createFullFixture(job.manifest), generationMs = performance.now() - generationStart, afterGeneration = process.memoryUsage();
  await phase('build'); const buildStart = performance.now(), source = createIndexSource(fixture);
  const buildMs = performance.now() - buildStart, afterBuild = process.memoryUsage(), queries = [];
  const available = new Map(measurementRequests().map(q => [q.name, q]));
  for (const name of job.queryNames) {
    const query = available.get(name);
    await phase(`first/${name}`); const first = measure(source, query.request, job.expected[name]);
    await phase(`warmup/${name}`); measure(source, query.request, job.expected[name]);
    const samples = [];
    for (let i = 0; i < job.samples; i++) { await phase(`sample-${i}/${name}`); samples.push(measure(source, query.request, job.expected[name])); }
    queries.push({ ...query, first, samples });
  }
  await phase('metadata'); const info = summarizeFixture(fixture);
  assert.deepEqual(info, job.manifest.fixture, 'index fixture differs from oracle manifest');
  return { candidate: 'index', fixture: info, generationMs, buildMs, queries,
    memory: { baseline, afterGeneration, afterBuild, end: process.memoryUsage() } };
}
process.once('message', async job => {
  try { const result = await run(job); await phase('done'); await send({ type: 'result', value: result }); }
  catch (error) { process.exitCode = 1; await send({ type: 'failure', value: { name: error.name, message: error.message } }); }
  finally { process.disconnect(); }
});
