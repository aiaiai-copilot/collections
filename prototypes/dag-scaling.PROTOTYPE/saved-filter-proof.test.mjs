import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSavedFilterProofFixture } from './saved-filter-proof.mjs';
import { makeMeasurementFixture } from './measurement-fixture.mjs';
import { createScanSource } from './scan-source.mjs';
import { createIndexSource } from './index-source.mjs';
import { readNavigation } from './navigation.mjs';

const tag = n => `тег_${String(n).padStart(4, '0')}`;
test('small saved-filter profile exposes ten incomparable pairs without changing the item space', () => {
  const fixture = makeSavedFilterProofFixture({ seed: 23, savedNodes: 10 });
  assert.deepEqual(fixture.items, makeMeasurementFixture({ count: 100, seed: 23 }).items);
  const pairs = [[0, 19], [1, 18], [2, 17], [3, 16], [4, 15],
    [5, 14], [6, 13], [7, 12], [8, 11], [9, 10]].map(pair => pair.map(tag));
  for (const create of [createScanSource, createIndexSource]) {
    const answer = readNavigation(create(fixture), { mode: 'nodes' });
    assert.equal(answer.status, 'ok');
    assert.equal(answer.value.total, 100);
    assert.deepEqual(answer.value.transitions.map(x => x.targetTags), pairs);
    assert.deepEqual(answer.value.parents, []);
    assert.ok(answer.value.transitions.every(x => x.coveredNodeIds.length === 1 && x.coveredNodeIds[0] === x.nodeId));
  }
});

test('adding a balanced round preserves previous filters and reveals another semantic parent', () => {
  const first = makeSavedFilterProofFixture({ seed: 47, savedNodes: 10 });
  const second = makeSavedFilterProofFixture({ seed: 47, savedNodes: 20 });
  assert.deepEqual(second.items, first.items);
  assert.deepEqual(second.nodes.slice(0, 10), first.nodes);
  assert.notEqual(second.revision, first.revision);
  const request = { tags: [tag(0), tag(18), tag(19)], mode: 'nodes' };
  for (const create of [createScanSource, createIndexSource]) {
    const before = readNavigation(create(first), request).value;
    const after = readNavigation(create(second), request).value;
    assert.equal(after.location.kind, 'temporary');
    assert.deepEqual(before.parents.map(n => n.tags), [[tag(0), tag(19)]]);
    assert.deepEqual(after.parents.map(n => n.tags), [[tag(0), tag(19)], [tag(0), tag(18)]]);
    assert.equal(after.total, before.total);
    const facts = readNavigation(create(second), { mode: 'nodes' }).value.sourceFacts.related;
    assert.equal(facts.narrower.length, 20);
    const degree = new Map();
    for (const node of facts.narrower) for (const t of node.tags) degree.set(t, (degree.get(t) ?? 0) + 1);
    assert.equal(degree.size, 20);
    assert.ok([...degree.values()].every(n => n === 2));
  }
});

test('one hundred pair roots remain complete, balanced and independently verifiable in both modes', () => {
  const requests = [[], [tag(0)], [tag(1)], [tag(2)], ['нет_такого_тега'],
    [tag(0), tag(19)], [tag(0), tag(18), tag(19)]];
  for (const seed of [23, 47, 89]) {
    const fixture = makeSavedFilterProofFixture({ seed, savedNodes: 100 });
    assert.deepEqual(fixture.nodes.slice(0, 20), makeSavedFilterProofFixture({ seed, savedNodes: 20 }).nodes);
    const scan = createScanSource(fixture), index = createIndexSource(fixture);
    const all = readNavigation(index, { mode: 'nodes' }).value;
    assert.equal(all.transitions.length, 100);
    assert.equal(all.sourceFacts.counts.length, 101);
    assert.ok(all.transitions.every(x => x.targetTags.length === 2 && x.coveredNodeIds.length === 1));
    assert.ok(all.transitions.some(x => x.count === 0));
    const degree = new Map();
    for (const node of all.sourceFacts.related.narrower) for (const t of node.tags) degree.set(t, (degree.get(t) ?? 0) + 1);
    assert.equal(degree.size, 20);
    assert.ok([...degree.values()].every(n => n === 10));
    for (const tags of requests) for (const mode of ['nodes', 'free']) {
      const expected = readNavigation(scan, { tags, mode });
      assert.equal(expected.status, 'ok');
      assert.deepEqual(readNavigation(index, { tags, mode }), expected);
    }
    const exact = readNavigation(index, { tags: [tag(0), tag(19)] }).value;
    assert.equal(exact.location.kind, 'node');
    assert.deepEqual(exact.transitions, []);
    const temporary = readNavigation(index, { tags: [tag(0), tag(18), tag(19)] }).value;
    assert.equal(temporary.location.kind, 'temporary');
    assert.deepEqual(temporary.parents.map(x => x.tags), [[tag(0), tag(19)], [tag(0), tag(18)]]);
  }
});

test('the proof cannot silently become a large or different profile', () => {
  for (const options of [{ count: 10000 }, { vocabulary: 10000 }, { poolSize: 200 }, null, [],
    { savedNodes: 1000 }, { savedNodes: 0 }, { savedNodes: '100' }, { savedNodes: NaN },
    { seed: -1 }, { seed: 2 ** 32 }]) {
    assert.throws(() => makeSavedFilterProofFixture(options), RangeError);
  }
  assert.deepEqual(makeSavedFilterProofFixture(), makeSavedFilterProofFixture({ seed: 23, savedNodes: 10 }));
});
