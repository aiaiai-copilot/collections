import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMeasurementFixture } from './measurement-fixture.mjs';
import { createIndexSource } from './index-source.mjs';
import { createScanSource } from './scan-source.mjs';
import { readNavigation } from './navigation.mjs';
import { runGroupedJob, validateGroupedProfile } from './grouped-runner.mjs';

test('the common series entry accepts only the recorded S1 and S3 manifests', () => {
  for (const name of ['density-S1', 'catalog-S3']) {
    const profile = JSON.parse(readFileSync(new URL(`./profiles/${name}.json`, import.meta.url)));
    assert.equal(validateGroupedProfile(profile), profile);
    assert.throws(() => validateGroupedProfile({ ...profile, seed: 47 }));
    assert.throws(() => validateGroupedProfile({ ...profile, id: 'unplanned' }));
    assert.throws(() => validateGroupedProfile({ ...profile, steps: profile.steps.map(s => ({ ...s, count: s.count * 10 })) }));
    assert.throws(() => validateGroupedProfile({ ...profile, queryNames: ['nodes/all'] }));
  }
});

test('chain catalog preserves items and exposes deep diamonds with nonempty and empty nodes', () => {
  const fixture = makeMeasurementFixture({ count: 100, seed: 23, catalog: 'chains' });
  assert.equal(fixture.nodes.length, 1000);
  assert.deepEqual(fixture.items, makeMeasurementFixture({ count: 100, seed: 23 }).items);
  assert.equal(new Set(fixture.nodes.map(n => JSON.stringify(n.tags))).size, 1000);
  assert.equal(Math.max(...fixture.nodes.map(n => n.tags.length)), 30);
  const index = createIndexSource(fixture), scan = createScanSource(fixture);
  const top = readNavigation(index, { mode: 'nodes' }).value;
  assert.equal(top.transitions.length, 20);
  assert.ok(top.transitions.every(t => t.coveredNodeIds.length === 50));
  assert.equal(new Set(top.transitions.flatMap(t => t.coveredNodeIds)).size, 1000);
  const joined = readNavigation(index, { mode: 'nodes', collectionId: 'chain-00-03' }).value;
  assert.deepEqual(joined.parents.map(n => n.id).sort(), ['chain-00-02', 'side-00-02']);
  assert.ok(joined.total > 0);
  assert.ok(readNavigation(index, { collectionId: 'chain-00-10' }).value.total > 0);
  const deep = readNavigation(index, { mode: 'nodes', collectionId: 'chain-00-30' }).value;
  assert.equal(deep.total, 0);
  assert.deepEqual(deep.parents.map(n => n.id), ['chain-00-29']);
  for (const mode of ['nodes', 'free']) for (const collectionId of [undefined, 'chain-00-03', 'chain-00-30']) {
    assert.deepEqual(readNavigation(index, { mode, collectionId }), readNavigation(scan, { mode, collectionId }));
  }
  assert.throws(() => makeMeasurementFixture({ count: 10001, catalog: 'chains' }));
  assert.throws(() => makeMeasurementFixture({ count: 100, catalog: 'chains', tagsPerItem: 30 }));
  assert.throws(() => makeMeasurementFixture({ count: 100, catalog: 'unknown' }));
});

test('one prepared catalog group verifies and measures all, joined and deep-empty reads in both modes', async () => {
  const queryNames = ['nodes/all', 'free/all', 'nodes/joined', 'free/joined', 'nodes/deep-empty', 'free/deep-empty'];
  const job = { count: 100, seed: 23, tagsPerItem: 10, catalog: 'chains', samples: 1, queryNames };
  const verified = await runGroupedJob({ ...job, candidate: 'verify' });
  assert.equal(verified.status, 'ok');
  const measured = await runGroupedJob({ ...job, candidate: 'index',
    expected: verified.result.answers, expectedFixtureSHA256: verified.result.fixture.sha256 });
  assert.equal(measured.status, 'ok');
  assert.equal(measured.result.fixture.nodes, 1000);
  assert.deepEqual(measured.result.fixture.filterLength, { min: 1, median: 13.5, max: 30 });
  assert.equal(measured.result.fixture.nodeAssignments, 13900);
  assert.equal(measured.phases.filter(p => p.name === 'generation').length, 1);
  assert.equal(measured.phases.filter(p => p.name === 'build').length, 1);
  assert.deepEqual(measured.result.queries.map(q => q.first.parents), [0, 0, 2, 0, 1, 0]);
  assert.deepEqual(measured.result.queries.map(q => q.first.total > 0), [true, true, true, true, false, false]);
  for (const q of measured.result.queries) {
    assert.equal(q.preparationId, measured.result.preparationId);
    assert.equal(q.first.answerSHA256, verified.result.answers[q.name]);
    assert.equal(q.samples[0].answerSHA256, verified.result.answers[q.name]);
  }
  assert.throws(() => runGroupedJob({ ...job, count: 10001, candidate: 'verify' }));
  assert.throws(() => runGroupedJob({ ...job, tagsPerItem: 30, candidate: 'verify' }));
});
