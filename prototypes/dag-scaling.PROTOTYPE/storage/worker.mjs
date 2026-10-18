// PROTOTYPE: one fixture load, then grouped PostgreSQL reads on that same data.
import assert from 'node:assert/strict';
import { makeMeasurementFixture, measurementRequests } from '../measurement-fixture.mjs';
import { readNavigation } from './navigation.mjs';
import { openStore } from './source.mjs';
import { hash, inventoryOf, QUERY_NAMES, validateJob } from './protocol.mjs';
const memory = () => process.memoryUsage();
const send = message => new Promise((resolve, reject) => process.send(message, e => e ? reject(e) : resolve()));
const phase = name => send({ type: 'phase', name, memory: memory() });

async function measured(store, space, request, expected) {
  const methods = {}, cpuStart = process.cpuUsage(), start = performance.now();
  const answer = await store.withSnapshot(space, async source => {
    const observed = { revision: source.revision };
    for (const key of ['collection','related','count','extraTags','page']) observed[key] = async (...args) => {
      const began = performance.now(), result = await source[key](...args);
      methods[key] = performance.now() - began; return result;
    };
    return readNavigation(observed, request);
  });
  const readMs = performance.now() - start, cpuUs = process.cpuUsage(cpuStart);
  assert.equal(answer.status, 'ok');
  const answerSHA256 = hash(answer);
  assert.equal(answerSHA256, expected, 'complete PostgreSQL answer differs from the frozen independent oracle');
  const { sourceFacts, ...view } = answer.value;
  const serializeStart = performance.now();
  const viewBytes = Buffer.byteLength(JSON.stringify({ status: answer.status, revision: answer.revision, value: view }));
  return { readMs, cpuUs, methodRoundTripMs: methods,
    otherMs: readMs - Object.values(methods).reduce((a,b)=>a+b,0),
    serializationMs: performance.now() - serializeStart, viewBytes, answerSHA256,
    total: view.total, transitions: view.transitions.length, parents: view.parents.length,
    countBatch: sourceFacts.counts.length, pageItems: view.page.items.length, memory: memory() };
}

async function run(job) {
  validateJob(job);
  let store;
  try {
    await phase('connect');
    const start = performance.now(); store = await openStore();
    const connectMs = performance.now() - start;
    await send({ type: 'completed', value: { type: 'session', ...store.session } });
    const before = await store.facts();
    assert.equal(before.otherLabSessions, 0, 'unexpected concurrent lab client');
    if (job.kind === 'prepare') {
      await phase('generation');
      const generationStart = performance.now();
      const fixture = makeMeasurementFixture({ count: job.profile.count, seed: job.profile.seed });
      const generationMs = performance.now() - generationStart;
      await phase('fingerprint');
      const fixtureSHA256 = hash(fixture);
      assert.equal(fixtureSHA256, job.fixtureSHA256, 'fixture no longer matches the previously verified data');
      const inventory = inventoryOf(fixture);
      await phase('atomic-load');
      const loadStart = performance.now(); let batches = 0;
      await store.load(job.space, fixture, { onBatch: async info => {
        batches++;
        if (info.table === 'items' && info.loaded % 10000 === 0)
          await send({ type: 'completed', value: { type: 'load-progress', ...info, memory: memory() } });
      } });
      const loadMs = performance.now() - loadStart;
      await phase('analyze');
      const analyzeStart = performance.now(); await store.analyze();
      const analyzeMs = performance.now() - analyzeStart;
      await phase('corpus-verification');
      assert.deepEqual(await store.inventory(job.space), inventory);
      return { fixtureSHA256, inventory, generationMs, loadMs, analyzeMs, batches, connectMs,
        before, after: await store.facts(), memory: memory(), session: store.session };
    }
    await phase('corpus-verification');
    assert.deepEqual(await store.inventory(job.space), job.inventory, 'prepared corpus changed');
    const available = new Map(measurementRequests().map(q => [q.name, q]));
    const queries = [];
    for (const name of QUERY_NAMES) {
      const { request } = available.get(name);
      await phase('first/' + name);
      const first = await measured(store, job.space, request, job.expected[name]);
      await phase('warmup/' + name);
      const warmup = await measured(store, job.space, request, job.expected[name]);
      const samples = [];
      for (let i = 0; i < job.samples; i++) {
        await phase(`sample-${i}/${name}`);
        samples.push(await measured(store, job.space, request, job.expected[name]));
      }
      const value = { name, request, first, warmup, samples,
        firstContext: queries.length ? 'after-prior-queries-and-groups' : 'first-of-connection; shared DB caches retained' };
      queries.push(value); await send({ type: 'completed', value: { type: 'query', ...value } });
    }
    await phase('end-verification');
    assert.deepEqual(await store.inventory(job.space), job.inventory);
    return { space: job.space, preparationId: job.preparationId, connectMs, queries, before,
      after: await store.facts(), memory: memory(), session: store.session };
  } finally {
    if (store) { await phase('confirmed-close'); await store.close(); }
  }
}
process.once('message', async job => {
  try { await send({ type: 'result', value: await run(job) }); }
  catch (error) { process.exitCode = 1; await send({ type: 'failure', value: { name: error.name, message: error.message } }); }
  finally { process.disconnect(); }
});
