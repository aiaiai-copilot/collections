// Full snapshots used only in this isolated correctness test, never in the coordinator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeMeasurementFixture } from './measurement-fixture.mjs';
import { createManifest, readPartition, createFullFixture, summarizeFixture } from './million-fixture.mjs';

test('streamed fixture and partial last partition reproduce the existing fixture and JSON checksum', () => {
  for (const count of [100, 113, 10000, 100000]) {
    const original = makeMeasurementFixture({ count, seed: 23 });
    const manifest = createManifest({ count, seed: 23 }, count > 1000 ? 30000 : 37);
    const joined = { revision: manifest.revision, items: manifest.parts.flatMap((_, i) => readPartition(manifest, i).items), nodes: manifest.nodes };
    assert.deepEqual(joined, original);
    assert.deepEqual(createFullFixture(manifest), original);
    assert.equal(manifest.fixture.sha256, createHash('sha256').update(JSON.stringify(original)).digest('hex'));
    assert.equal(manifest.fixture.jsonBytes, Buffer.byteLength(JSON.stringify(original)));
    assert.deepEqual(summarizeFixture(original), manifest.fixture);
    assert.equal(manifest.fixture.assignments, count * 10);
  }
});
