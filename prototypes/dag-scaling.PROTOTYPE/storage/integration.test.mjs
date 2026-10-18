// Explicit local container only. No environment-selected DSN and no benchmark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openStore } from './source.mjs';
import { readNavigation } from '../navigation.mjs';
import { createScanSource } from '../scan-source.mjs';
import { readNavigation as readAsync } from './navigation.mjs';
import { makeSmallFixture, SMALL_TAGS } from '../small-fixtures.mjs';
import { connect, stopOwnedSession } from './client.mjs';
import { inventoryOf } from './protocol.mjs';

function fixture() {
  return { revision: 'small:0', items: [
    { id: 'e1', tags: ['film', 'calm', 'evening', 'calm'] },
    { id: 'e2', tags: ['film', 'calm'] },
    { id: 'e3', tags: ['book', 'calm'] },
    { id: 'e4', tags: [] },
  ], nodes: [
    { id: 'film', name: 'Films', tags: ['film'] },
    { id: 'calm', name: 'Calm', tags: ['calm'] },
    { id: 'calm-film', name: 'Calm films', tags: ['film', 'calm'] },
    { id: 'evening-film', name: 'Evening films', tags: ['evening', 'film'] },
    { id: 'zero', name: 'Zero', tags: ['film', 'absent'] },
    { id: 'saved-all', name: 'Saved all', tags: [] },
  ] };
}

test('isolated PostgreSQL returns full navigation identical to the scan oracle', { timeout: 30000 }, async () => {
  const store = await openStore();
  try {
    const space = 'test-' + randomUUID(), input = fixture();
    await store.load(space, input);
    assert.deepEqual(await store.inventory(space), inventoryOf(input));
    const scan = createScanSource(input);
    for (const mode of ['nodes', 'free']) for (const request of [
      { tags: [] }, { tags: ['film'] }, { tags: ['calm', 'evening', 'film'] },
      { tags: ['not-found'] }, { collectionId: 'saved-all' }, { collectionId: 'missing' },
      { tags: ['calm'], offset: 1, limit: 1 }, { tags: [], revision: 'old' },
    ]) assert.deepEqual(await store.read(space, { ...request, mode }), readNavigation(scan, { ...request, mode }));
  } finally { await store.close(); }
});

test('chunked loading publishes only a complete space and an interrupted load can be retried', { timeout: 30000 }, async () => {
  const writer = await openStore(), reader = await openStore();
  try {
    const space = 'test-' + randomUUID(), input = fixture();
    let batches = 0;
    await assert.rejects(() => writer.load(space, input, { batchRows: 2, onBatch: async () => {
      batches++;
      await assert.rejects(() => reader.read(space, { mode: 'free' }), /unknown synthetic space/);
      throw new Error('interrupt loading');
    } }), /interrupt loading/);
    assert.equal(batches, 1);
    await assert.rejects(() => reader.read(space, { mode: 'free' }), /unknown synthetic space/);
    await writer.load(space, input, { batchRows: 2, onBatch: async () => { batches++; } });
    assert.equal(batches, 6); // 1 rolled-back batch + 2 item batches + 3 node batches.
    assert.deepEqual(await reader.read(space, { mode: 'free' }), readNavigation(createScanSource(input), { mode: 'free' }));
  } finally { await writer.close(); await reader.close(); }
});

test('explicit cancellation confirms that the owned backend is gone', { timeout: 15000 }, async () => {
  const client = await connect();
  try {
    assert.equal(typeof client.abort, 'function');
    const pending = client.query('SELECT to_json(pg_sleep(10));');
    const rejected = assert.rejects(pending, /psql closed|cancelled|closed storage/);
    await new Promise(resolve => setTimeout(resolve, 100));
    const stopped = await client.abort();
    await rejected;
    assert.deepEqual(stopped, { backendGone: true, pid: client.identity.pid });
    await assert.rejects(() => client.query('SELECT 1;'), /closed storage/);
  } finally { await client.close(); }
});

test('a server statement deadline closes the client and leaves no owned backend', { timeout: 15000 }, async () => {
  const client = await connect();
  await client.query("SET statement_timeout='100ms';");
  await assert.rejects(() => client.query('SELECT to_json(pg_sleep(1));'), /statement timeout/);
  assert.deepEqual(await client.close(), { backendGone: true, pid: client.identity.pid });
});

test('supervisor cleanup can terminate only the captured owned session', { timeout: 15000 }, async () => {
  const client = await connect();
  try {
    const pending = assert.rejects(() => client.query('SELECT to_json(pg_sleep(10));'), /psql closed/);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(await stopOwnedSession({ identity: client.identity, target: client.target }), { backendGone: true, pid: client.identity.pid });
    await pending;
  } finally { await client.close(); }
});

test('one open snapshot remains consistent across a committed data and revision change', { timeout: 30000 }, async () => {
  const reader = await openStore(), writer = await openStore();
  try {
    const space = 'test-' + randomUUID(), input = fixture();
    await reader.load(space, input);
    const updated = structuredClone(input);
    updated.revision += '/change-1';
    updated.items.push({ id: 'e5', tags: ['film'] });
    updated.nodes.find(n => n.id === 'zero').tags = ['book'];
    let released;
    await reader.withSnapshot(space, async source => {
      released = source;
      assert.deepEqual(await readAsync(source, { mode: 'free' }), readNavigation(createScanSource(input), { mode: 'free' }));
      assert.equal(await writer.change(space, [
        { kind: 'item', action: 'put', record: updated.items.at(-1) },
        { kind: 'node', action: 'put', record: updated.nodes.find(n => n.id === 'zero') },
      ]), updated.revision);
      assert.deepEqual(await readAsync(source, { mode: 'free' }), readNavigation(createScanSource(input), { mode: 'free' }));
    });
    await assert.rejects(() => released.count([[]]), /snapshot already closed/);
    for (const mode of ['nodes', 'free']) assert.deepEqual(await reader.read(space, { mode }), readNavigation(createScanSource(updated), { mode }));
    assert.deepEqual(await reader.read(space, { revision: input.revision }), { status: 'revision-unavailable', requestedRevision: input.revision });
  } finally { await reader.close(); await writer.close(); }
});

test('a rejected change batch rolls back data, revision and the committed-change journal together', { timeout: 30000 }, async () => {
  const reader = await openStore(), writer = await openStore();
  try {
    const space = 'test-' + randomUUID(), input = fixture();
    await reader.load(space, input);
    const deletion = [{ kind: 'item', action: 'delete', id: 'e4' }];
    await writer.change(space, deletion);
    input.items = input.items.filter(i => i.id !== 'e4');
    input.revision += '/change-1';
    assert.deepEqual(await reader.journal(space), [{ seq: 1, operations: deletion }]);
    await assert.rejects(() => writer.change(space, [
      { kind: 'item', action: 'put', record: { id: 'must-rollback', tags: ['film'] } },
      { kind: 'node', action: 'put', record: { id: 'duplicate-filter', name: 'Invalid', tags: ['film'] } },
    ]), /duplicate key/);
    for (const mode of ['nodes','free']) assert.deepEqual(await reader.read(space, { mode }), readNavigation(createScanSource(input), { mode }));
    assert.deepEqual(await reader.journal(space), [{ seq: 1, operations: deletion }]);
  } finally { await reader.close(); await writer.close(); }
});

test('small Unicode fixtures, independent spaces and mutations preserve complete answers', { timeout: 30000 }, async () => {
  const store = await openStore();
  try {
    const spaces = [];
    for (const seed of [1, 23, 71]) {
      const data = makeSmallFixture(seed), id = 'test-' + randomUUID();
      data.items.push({ id: '\u{10000}', tags: ["quote'", 'line\nbreak', '\\', '\u{10000}', '\uE000'] });
      data.items.push({ id: '\uE000', tags: ["quote'"] });
      await store.load(id, data); spaces.push({ id, data });
      const oracle = createScanSource(data);
      const requests = [[], ...SMALL_TAGS.map(tag => [tag]), ['а','b_c'], ['item-only'],
        ['saved-only'], ['missing'], ["quote'"], ['line\nbreak'], ['\\']];
      for (const mode of ['nodes','free']) for (const tags of requests) {
        const request = { mode, tags, limit: 3, offset: tags.length ? 0 : data.items.length - 2 };
        assert.deepEqual(await store.read(id, request), readNavigation(oracle, request));
      }
    }
    const { id, data } = spaces[0];
    await store.change(id, [
      { kind: 'item', action: 'put', record: { id: data.items[0].id, tags: ['new-only'] } },
      { kind: 'node', action: 'delete', id: 'saved-only' },
    ]);
    const updated = structuredClone(data);
    updated.items[0] = { id: data.items[0].id, tags: ['new-only'] };
    updated.nodes = updated.nodes.filter(n => n.id !== 'saved-only');
    updated.revision += '/change-1';
    for (const mode of ['nodes','free']) assert.deepEqual(await store.read(id, { mode }), readNavigation(createScanSource(updated), { mode }));
    for (const other of spaces.slice(1)) {
      assert.deepEqual(await store.read(other.id, { mode: 'free' }), readNavigation(createScanSource(other.data), { mode: 'free' }));
      assert.deepEqual(await store.journal(other.id), []);
    }
  } finally { await store.close(); }
});
