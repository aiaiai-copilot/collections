import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeMeasurementFixture } from './measurement-fixture.mjs';
import { makeSavedFilterFixture } from './saved-filter-fixture.mjs';
import { makeSavedFilterProofFixture } from './saved-filter-proof.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('saved pairs grow by prefixes with fixed items, vocabulary, length and balanced tag degree', () => {
  const itemsHash = hash(makeMeasurementFixture({ count: 10000, seed: 23 }).items);
  let previous = [];
  for (const savedNodes of [100, 1000, 10000]) {
    const fixture = makeSavedFilterFixture({ variant: 'main', seed: 23, savedNodes });
    assert.equal(hash(fixture.items), itemsHash);
    assert.equal(fixture.nodes.length, savedNodes);
    assert.deepEqual(fixture.nodes.slice(0, previous.length), previous);
    assert.deepEqual(fixture.nodes[0], { id: 'pair-00000', name: 'Пара 00000', tags: ['тег_0000', 'тег_0199'] });
    assert.equal(new Set(fixture.nodes.map(n => JSON.stringify(n.tags))).size, savedNodes);
    const degrees = new Map();
    for (const node of fixture.nodes) {
      assert.equal(node.tags.length, 2);
      assert.notEqual(node.tags[0], node.tags[1]);
      assert.deepEqual([...node.tags].sort(), node.tags);
      assert.equal(node.id.length, 10);
      assert.equal(node.name.length, 10);
      for (const tag of node.tags) degrees.set(tag, (degrees.get(tag) ?? 0) + 1);
    }
    assert.equal(degrees.size, 200);
    assert.deepEqual(new Set(degrees.values()), new Set([savedNodes / 100]));
    previous = fixture.nodes;
  }
});

test('only declared main profiles or the unchanged small proof can be generated', () => {
  for (const options of [null, {}, { variant: 'main', seed: 23, savedNodes: 20000 },
    { variant: 'main', seed: 23, savedNodes: 100, count: 1000000 },
    { variant: 'main', seed: 7, savedNodes: 100 }, { variant: 'smoke', seed: 23, savedNodes: 1000 }]) {
    assert.throws(() => makeSavedFilterFixture(options), /profile/);
  }
  for (const savedNodes of [10, 20, 100]) {
    assert.deepEqual(makeSavedFilterFixture({ variant: 'smoke', seed: 23, savedNodes }),
      makeSavedFilterProofFixture({ seed: 23, savedNodes }));
  }
});
