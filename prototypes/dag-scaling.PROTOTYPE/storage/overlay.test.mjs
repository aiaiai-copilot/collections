// Same agreed full-answer interface; the reference must not trust PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOverlay } from './overlay.mjs';
import { makeSmallFixture, SMALL_TAGS } from '../small-fixtures.mjs';
import { createScanSource } from '../scan-source.mjs';
import { readNavigation } from '../navigation.mjs';
test('one prepared reference accounts for mutations at every revision with complete answers', () => {
  const original = makeSmallFixture(23), prepare = prepareOverlay(original);
  const batches = [
    [{ kind: 'item', action: 'put', record: { id: original.items[0].id, tags: ['new-only'] } }],
    [{ kind: 'item', action: 'delete', id: original.items[1].id }],
    [{ kind: 'item', action: 'put', record: { id: '\u{10000}', tags: ['new-only','а'] } }],
    [{ kind: 'node', action: 'put', record: { ...original.nodes[0], name: 'Changed name' } }],
    [{ kind: 'node', action: 'delete', id: original.nodes[1].id }],
  ];
  let operations = [];
  for (let seq = 0; seq <= batches.length; seq++) {
    const data = structuredClone(original); data.revision = `revision-${seq}`;
    for (const op of operations) {
      const records = data[op.kind === 'item' ? 'items' : 'nodes'];
      const id = op.action === 'put' ? op.record.id : op.id;
      const i = records.findIndex(row => row.id === id);
      if (i !== -1) records.splice(i, 1);
      if (op.action === 'put') records.push(op.record);
    }
    const reference = prepare.at(data.revision, operations), scan = createScanSource(data);
    for (const mode of ['nodes','free']) for (const tags of [[], ...SMALL_TAGS.map(t=>[t]), ['new-only'], ['missing']])
      for (const offset of [0, 2]) {
        const request = { tags, mode, offset, limit: 3 };
        assert.deepEqual(readNavigation(reference, request), readNavigation(scan, request));
      }
    for (const id of original.nodes.slice(0,2).map(n=>n.id))
      assert.deepEqual(readNavigation(reference, { collectionId: id, mode: 'free' }), readNavigation(scan, { collectionId: id, mode: 'free' }));
    assert.deepEqual(readNavigation(reference, { revision: 'unavailable' }), { status: 'revision-unavailable', requestedRevision: 'unavailable' });
    if (seq < batches.length) operations = [...operations, ...batches[seq]];
  }
  assert.deepEqual(readNavigation(prepare.at(original.revision, []), { mode: 'free' }), readNavigation(createScanSource(original), { mode: 'free' }));
});
