// PROTOTYPE: bounded streaming counterpart of the unchanged measurement fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeMeasurementFixture } from './measurement-fixture.mjs';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function profileOf(input) {
  const { count, seed, vocabulary = 1000 } = input;
  if (!Number.isSafeInteger(count) || count < 100 || count > 1000000 ||
      !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || vocabulary !== 1000) throw new RangeError('invalid million profile');
  return { count, seed, vocabulary };
}
const tag = i => `тег_${String(i).padStart(4, '0')}`;
function* records(profile, start = 0, end = profile.count, initial = profile.seed) {
  let state = initial;
  for (let i = start; i < end; i++) {
    const tags = new Set();
    if (i < Math.floor(profile.count / 10)) tags.add(tag(0));
    if (i < Math.floor(profile.count / 100)) tags.add(tag(1));
    if (i === 0) tags.add(tag(2));
    while (tags.size < 10) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      tags.add(tag(3 + Math.floor((state / 2 ** 32) * 997)));
    }
    yield { item: { id: `item-${String(i).padStart(5, '0')}`, tags: [...tags].sort() }, state };
  }
}
function summarizer(revision, nodes) {
  const sha = createHash('sha256'), frequencies = new Map();
  let jsonBytes = 0, items = 0;
  const add = text => { sha.update(text); jsonBytes += Buffer.byteLength(text); };
  add(`{"revision":${JSON.stringify(revision)},"items":[`);
  return {
    item(item) {
      if (items++) add(',');
      add(JSON.stringify(item));
      for (const tag of item.tags) frequencies.set(tag, (frequencies.get(tag) ?? 0) + 1);
    },
    finish() {
      add(`],"nodes":${JSON.stringify(nodes)}}`);
      const sorted = [...frequencies.values()].sort((a, b) => a - b);
      return { sha256: sha.digest('hex'), jsonBytes, items, nodes: nodes.length, vocabulary: frequencies.size,
        assignments: sorted.reduce((a, b) => a + b, 0),
        tagFrequency: { min: sorted[0], median: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2, max: sorted.at(-1) } };
    },
  };
}
export function summarizeFixture(fixture) {
  const summary = summarizer(fixture.revision, fixture.nodes);
  for (const item of fixture.items) summary.item(item);
  return summary.finish();
}
export function createManifest(input, chunkSize = 100000) {
  const profile = profileOf(input);
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 100000 || Math.ceil(profile.count / chunkSize) > 100) throw new RangeError('invalid partition size');
  const revision = `pilot-${profile.count}-${profile.seed}`;
  const nodes = makeMeasurementFixture({ count: 100, seed: profile.seed }).nodes;
  const summary = summarizer(revision, nodes), parts = [];
  let state = profile.seed;
  for (let start = 0; start < profile.count; start += chunkSize) {
    const end = Math.min(start + chunkSize, profile.count), before = state, sha = createHash('sha256');
    for (const row of records(profile, start, end, state)) {
      state = row.state;
      summary.item(row.item);
      sha.update(JSON.stringify(row.item) + '\n');
    }
    parts.push({ start, end, before, after: state, sha256: sha.digest('hex') });
  }
  const body = { version: 1, profile, revision, nodes, nodesSHA256: digest(nodes), parts, fixture: summary.finish() };
  return { ...body, id: digest(body) };
}
export function readPartition(manifest, index) {
  validateManifest(manifest);
  const part = manifest.parts[index];
  if (!part) throw new RangeError('missing partition');
  const items = [], sha = createHash('sha256');
  let state = part.before;
  for (const row of records(manifest.profile, part.start, part.end, state)) {
    state = row.state; items.push(row.item); sha.update(JSON.stringify(row.item) + '\n');
  }
  assert.equal(state, part.after, 'partition state mismatch');
  assert.equal(sha.digest('hex'), part.sha256, 'partition checksum mismatch');
  return { revision: manifest.revision, items, nodes: manifest.nodes };
}
export function createFullFixture(manifest) {
  validateManifest(manifest);
  return { revision: manifest.revision, items: Array.from(records(manifest.profile), row => row.item), nodes: manifest.nodes };
}

export function validateManifest(manifest) {
  const { id, ...body } = manifest;
  assert.equal(id, digest(body), 'manifest checksum mismatch');
  const profile = profileOf(manifest.profile);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.revision, `pilot-${profile.count}-${profile.seed}`);
  assert.deepEqual(manifest.nodes, makeMeasurementFixture({ count: 100, seed: profile.seed }).nodes);
  assert.equal(manifest.nodesSHA256, digest(manifest.nodes));
  assert.ok(Array.isArray(manifest.parts) && manifest.parts.length > 0 && manifest.parts.length <= 100);
  let end = 0, state = profile.seed;
  for (const part of manifest.parts) {
    assert.equal(part.start, end, 'partition coverage mismatch');
    assert.ok(Number.isSafeInteger(part.end) && part.end > end && part.end - end <= 100000 && part.end <= profile.count);
    assert.equal(part.before, state, 'partition PRNG chain mismatch');
    assert.ok(Number.isSafeInteger(part.after) && part.after >= 0 && part.after <= 0xffffffff);
    assert.match(part.sha256, /^[a-f0-9]{64}$/);
    end = part.end; state = part.after;
  }
  assert.equal(end, profile.count, 'incomplete partition coverage');
  assert.equal(manifest.fixture.items, profile.count);
  assert.equal(manifest.fixture.assignments, profile.count * 10);
  assert.equal(manifest.fixture.nodes, 100);
  assert.match(manifest.fixture.sha256, /^[a-f0-9]{64}$/);
  return manifest;
}
