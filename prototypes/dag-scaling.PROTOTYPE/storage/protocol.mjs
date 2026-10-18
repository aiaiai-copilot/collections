// PROTOTYPE: bounded D1 protocol; hashes are not a public revision scheme.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { snapshot } from '../contract.mjs';
export const PROFILE = Object.freeze({ id: 'storage-D1-v1', count: 100000, seed: 23,
  vocabulary: 1000, tagsPerItem: 10, savedNodes: 100, catalog: 'mixed' });
export const QUERY_NAMES = Object.freeze(['nodes/all', 'free/all', 'nodes/ten-percent', 'free/ten-percent']);
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const md5 = text => createHash('md5').update(text).digest('hex');
export function inventoryOf(input) {
  const data = snapshot(input);
  return { state: { initial: data.revision, seq: 0 },
    ...Object.fromEntries(['items','nodes'].map(kind => [kind, {
      count: data[kind].length, digest: md5(data[kind].map(row => md5(JSON.stringify(row))).join('')),
    }])) };
}
export function validateJob(job) {
  assert.ok(['prepare','verify','measure'].includes(job.kind));
  assert.deepEqual(job.profile, PROFILE, 'only the planned D1 profile is admitted');
  assert.match(job.space, /^data-D1-[a-zA-Z0-9-]{1,60}$/);
  if (job.kind !== 'prepare') {
    assert.match(job.fixtureSHA256, /^[a-f0-9]{64}$/);
    assert.equal(job.inventory.items.count, PROFILE.count);
    assert.equal(job.inventory.nodes.count, PROFILE.savedNodes);
  }
  if (job.kind === 'measure') {
    assert.ok(QUERY_NAMES.every(name => /^[a-f0-9]{64}$/.test(job.expected[name])));
    assert.equal(job.samples, 5);
  }
  return job;
}
