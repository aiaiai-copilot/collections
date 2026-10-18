import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE, inventoryOf, validateJob } from './protocol.mjs';
test('D1 refuses smaller replacement profiles and fingerprints canonical ordered data', () => {
  const job = { kind: 'prepare', profile: PROFILE, space: 'data-D1-test' };
  assert.equal(validateJob(job), job);
  assert.throws(() => validateJob({ ...job, profile: { ...PROFILE, count: 1000 } }), /planned D1/);
  assert.throws(() => validateJob({ ...job, space: 'production' }));
  const input = { revision: 'r', items: [{ id: 'z', tags: ['b','a','a'] }, { id: 'a', tags: [] }], nodes: [] };
  const canonical = { revision: 'r', items: [{ id: 'a', tags: [] }, { id: 'z', tags: ['a','b'] }], nodes: [] };
  assert.deepEqual(inventoryOf(input), inventoryOf(canonical));
  assert.notDeepEqual(inventoryOf(input), inventoryOf({ ...canonical, revision: 'other' }));
});
