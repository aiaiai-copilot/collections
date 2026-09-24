import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartitionProofSource } from './partition-proof.mjs';
import { createScanSource } from './scan-source.mjs';
import { readNavigation } from './navigation.mjs';
import { makeSmallFixture, SMALL_TAGS } from './small-fixtures.mjs';

test('disjoint item partitions preserve a full response, including an offset page and saved-only tags', () => {
  const fixture = { revision: 'proof', items: [
    { id: 'd', tags: ['a', 'b'] }, { id: 'b', tags: ['a'] },
    { id: 'a', tags: ['a', 'b', 'b'] }, { id: 'c', tags: ['b'] },
  ], nodes: [
    { id: 'a', name: 'A', tags: ['a'] }, { id: 'ab', name: 'AB', tags: ['a', 'b'] },
    { id: 'saved', name: 'No items', tags: ['saved-only'] },
  ] };
  const partitioned = createPartitionProofSource(fixture, { chunkSize: 2 });
  const request = { mode: 'free', tags: [], offset: 1, limit: 2 };
  const actual = readNavigation(partitioned, request);
  assert.equal(actual.status, 'ok');
  assert.equal(actual.value.total, 4);
  assert.deepEqual(actual.value.page.items.map(item => item.id), ['b', 'c']);
  assert.deepEqual(actual.value.transitions.map(t => [t.addedTags[0], t.count]), [['a', 3], ['b', 3], ['saved-only', 0]]);
  assert.deepEqual(actual, readNavigation(createScanSource(fixture), request));
});

test('proof refuses a large input before copying or reading its records', () => {
  const fixture = { revision: 'too-large', items: Array.from({ length: 101 }, (_, i) => ({ id: String(i), tags: [] })), nodes: [] };
  assert.throws(() => createPartitionProofSource(fixture), /proof supports at most 100 items and 100 nodes/);
  assert.throws(() => createPartitionProofSource({ revision: 'too-wide', items: [], nodes: Array(101) }), /proof supports at most 100 items and 100 nodes/);
  for (const chunkSize of [0, -1, 101, 1.5, NaN]) {
    assert.throws(() => createPartitionProofSource({ revision: 'empty', items: [], nodes: [] }, { chunkSize }), RangeError);
  }
});

test('a far offset produces the same empty page without overflowing the partition request', () => {
  const fixture = { revision: 'far', items: [{ id: 'one', tags: [] }], nodes: [] };
  const request = { offset: Number.MAX_SAFE_INTEGER, limit: 20 };
  assert.deepEqual(readNavigation(createPartitionProofSource(fixture), request), readNavigation(createScanSource(fixture), request));
});

test('empty item space preserves all versus an empty saved node and zero-count descendants', () => {
  const fixture = { revision: 'empty', items: [], nodes: [
    { id: 'empty', name: 'All saved', tags: [] },
    { id: 'a', name: 'A', tags: ['a'] }, { id: 'ab', name: 'AB', tags: ['a', 'b'] },
  ] };
  const source = createPartitionProofSource(fixture);
  for (const mode of ['nodes', 'free']) {
    for (const collectionId of [undefined, 'empty', 'ab', 'absent']) {
      const request = { mode, collectionId };
      assert.deepEqual(readNavigation(source, request), readNavigation(createScanSource(fixture), request));
    }
  }
  assert.equal(readNavigation(source).value.location.kind, 'all');
  assert.equal(readNavigation(source, { collectionId: 'empty' }).value.location.kind, 'node');
});

test('partition proof rejects overlapping item IDs, preserves revisions and owns defensive snapshots', () => {
  assert.throws(() => createPartitionProofSource({ revision: 'duplicate', items: [
    { id: 'same', tags: ['a'] }, { id: 'same', tags: ['b'] },
  ], nodes: [] }, { chunkSize: 1 }), /duplicate item id/);
  const fixture = makeSmallFixture(23);
  const source = createPartitionProofSource(fixture, { chunkSize: 7 });
  const expected = readNavigation(createScanSource(fixture), { mode: 'free' });
  fixture.items[0].tags.push('external-mutation');
  source.extraTags([]).value.push({ tag: 'injected', count: 999 });
  source.page([]).value.items[0].tags.push('returned-mutation');
  source.count([[]]).value[0].count = -1;
  assert.deepEqual(readNavigation(source, { mode: 'free' }), expected);
  for (const answer of [source.related([], 'old'), source.extraTags([], 'old'), source.count([[]], 'old'), source.page([], {}, 'old')]) {
    assert.deepEqual(answer, { status: 'revision-unavailable', requestedRevision: 'old' });
  }
});

test('50 small spaces: partition sizes 1, 7 and 100 preserve 21000 complete navigation answers', t => {
  const queries = Array.from({ length: 64 }, (_, mask) => SMALL_TAGS.filter((_, bit) => mask & (1 << bit)));
  queries.push(['item-only'], ['saved-only'], ['а', 'item-only'], ['а', 'saved-only'], ['missing'], ['а', 'а']);
  let compared = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const fixture = makeSmallFixture(seed);
    const whole = createScanSource(fixture);
    for (const chunkSize of [1, 7, 100]) {
      const parts = createPartitionProofSource(fixture, { chunkSize });
      for (const node of fixture.nodes) assert.deepEqual(parts.collection(node.id), whole.collection(node.id));
      for (const [i, tags] of queries.entries()) {
        for (const mode of ['nodes', 'free']) {
          const request = { tags, mode, offset: i % 7, limit: 3 };
          assert.deepEqual(readNavigation(parts, request), readNavigation(whole, request), `seed=${seed}, chunk=${chunkSize}, query=${i}, mode=${mode}`);
          compared++;
        }
      }
    }
  }
  assert.equal(compared, 21000);
  t.diagnostic('21000 complete answers agree with the monolithic independent scan; no large-data allocation.');
});
