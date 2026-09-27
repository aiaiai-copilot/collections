// PROTOTYPE: synthetic fixed-N saved-filter experiment; no external I/O.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeSavedFilterFixture, savedFilterProfile, savedFilterRequests } from './saved-filter-fixture.mjs';
import { createIndexSource } from './index-source.mjs';
import { createScanSource } from './scan-source.mjs';
import { readNavigation } from './navigation.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const memory = () => process.memoryUsage();
const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
const phase = name => send({ type: 'phase', name, memory: memory() });

function measure(source, request, expected) {
  const adapter = { revision: source.revision }, observations = {};
  let lastFactsEnd, transitionPreparationMs;
  for (const key of ['related', 'extraTags', 'count', 'page']) adapter[key] = (...args) => {
    const start = performance.now();
    if (key === 'count') transitionPreparationMs = start - lastFactsEnd;
    const answer = source[key](...args), end = performance.now();
    observations[key] = { ms: end - start, answer };
    if (key === 'related' || key === 'extraTags') lastFactsEnd = end;
    return answer;
  };
  const cpuStart = process.cpuUsage(), start = performance.now();
  const answer = readNavigation(adapter, request);
  const readMs = performance.now() - start, cpuUs = process.cpuUsage(cpuStart);
  assert.equal(answer.status, 'ok');
  const answerSHA256 = hash(answer);
  if (expected !== undefined) assert.equal(answerSHA256, expected, 'full answer differs from scan');
  const { sourceFacts, ...view } = answer.value;
  const sourceMs = Object.fromEntries(Object.entries(observations).map(([k, v]) => [k, v.ms]));
  const sourceResponseBytes = Object.fromEntries(Object.entries(observations).map(([k, v]) => [k, Buffer.byteLength(JSON.stringify(v.answer))]));
  const result = {
    readMs, cpuUs, sourceMs, transitionPreparationMs,
    otherAssemblyMs: readMs - transitionPreparationMs - Object.values(sourceMs).reduce((a, b) => a + b, 0),
    answerSHA256, sourceResponseBytes,
    viewBytes: Buffer.byteLength(JSON.stringify({ status: answer.status, revision: answer.revision, value: view })),
    total: view.total, transitions: view.transitions.length, parents: view.parents.length,
    location: view.location, coverage: view.transitions.reduce((sum, t) => sum + t.coveredNodeIds.length, 0),
    countBatch: sourceFacts.counts.length, itemTags: sourceFacts.itemTags.length,
    pageItems: view.page.items.length,
    related: { wider: sourceFacts.related.wider.length, narrower: sourceFacts.related.narrower.length, equal: !!sourceFacts.related.equal },
    memory: memory(),
  };
  return { ...result, postReadMs: performance.now() - start - readMs };
}

function fixtureInfo(fixture, profile) {
  const frequencies = new Map(), degrees = new Map(), filters = new Set();
  for (const item of fixture.items) for (const tag of item.tags) frequencies.set(tag, (frequencies.get(tag) ?? 0) + 1);
  for (const node of fixture.nodes) {
    assert.equal(node.tags.length, 2);
    assert.ok(node.tags[0] < node.tags[1]);
    filters.add(JSON.stringify(node.tags));
    for (const tag of node.tags) degrees.set(tag, (degrees.get(tag) ?? 0) + 1);
  }
  assert.equal(filters.size, profile.savedNodes);
  assert.equal(degrees.size, profile.pool);
  assert.ok([...degrees.values()].every(n => n === profile.savedNodes / (profile.pool / 2)));
  return {
    revision: fixture.revision, sha256: hash(fixture), itemsSHA256: hash(fixture.items), nodesSHA256: hash(fixture.nodes),
    nodePrefixSHA256: Object.fromEntries((profile.variant === 'main' ? [100, 1000, 10000] : [10, 20, 100])
      .filter(n => n <= fixture.nodes.length).map(n => [n, hash(fixture.nodes.slice(0, n))])),
    jsonBytes: Buffer.byteLength(JSON.stringify(fixture)), items: fixture.items.length, nodes: fixture.nodes.length,
    vocabulary: frequencies.size, assignments: [...frequencies.values()].reduce((a, b) => a + b, 0),
    tagFrequencies: Object.fromEntries([...frequencies].sort()),
    structure: { roots: fixture.nodes.length, depth: 1, edges: 0, uniqueFilters: filters.size, filterLength: 2,
      nodeVocabulary: degrees.size, degree: { min: Math.min(...degrees.values()), max: Math.max(...degrees.values()) } },
  };
}

async function run(job) {
  const profile = savedFilterProfile(job.profile), baseline = memory();
  await phase('generation');
  let start = performance.now();
  const fixture = makeSavedFilterFixture(job.profile);
  const generationMs = performance.now() - start, afterGeneration = memory();
  await phase('metadata');
  start = performance.now();
  const info = fixtureInfo(fixture, profile);
  const metadataMs = performance.now() - start;
  await phase('build');
  start = performance.now();
  const source = job.kind === 'verify' ? createScanSource(fixture) : createIndexSource(fixture);
  const second = job.kind === 'verify' ? createIndexSource(fixture) : null;
  const buildMs = performance.now() - start, afterBuild = memory();
  const readings = [];
  let metadataCountMs = 0;
  if (job.kind === 'metadata') {
    await phase('metadata-count');
    start = performance.now();
    const counts = source.count(fixture.nodes.map(n => n.tags));
    metadataCountMs = performance.now() - start;
    assert.equal(counts.status, 'ok');
    info.zeroNodes = counts.value.filter(n => n.count === 0).length;
  } else {
    delete info.tagFrequencies; // Full frequency table is stored once per point, in its metadata job.
    const { request } = savedFilterRequests(job.profile).find(q => q.name === job.query);
    if (job.kind === 'verify') {
      await phase('verify-scan');
      readings.push({ ...measure(source, request), candidate: 'scan', stage: 'verify' });
      await phase('verify-index');
      readings.push({ ...measure(second, request, readings[0].answerSHA256), candidate: 'index', stage: 'verify' });
    } else {
      for (const stage of ['first', 'warmup', ...Array(job.samples).fill('sample')]) {
        await phase(stage);
        readings.push({ ...measure(source, request, job.expected), candidate: 'index', stage });
      }
    }
  }
  await phase('complete');
  return { kind: job.kind, profile: job.profile, node: process.version, execArgv: process.execArgv,
    fixture: info, generationMs, buildMs, metadataMs, metadataCountMs, readings,
    memory: { baseline, afterGeneration, afterBuild, end: memory() } };
}
process.once('message', async job => {
  try { await send({ type: 'result', value: await run(job) }); }
  catch (error) { process.exitCode = 1; await send({ type: 'failure', value: { name: error.name, message: error.message } }); }
  finally { process.disconnect(); }
});
