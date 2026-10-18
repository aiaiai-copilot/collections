import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMeasurementFixture } from './measurement-fixture.mjs';
import { groupedAdmission, runGroupedJob, validateGroupedProfile } from './grouped-runner.mjs';

const wide = { catalog: 'wide', seed: 23, vocabulary: 6079, savedNodes: 178, tagsPerItem: 10, distribution: 'uniform' };
const correlated = { ...wide, vocabulary: 2733, savedNodes: 367, tagsPerItem: 30, distribution: 'clustered' };

test('admitted manifests preserve the two preselected random points without redrawing', () => {
  const selected = JSON.parse(readFileSync(new URL('./profiles/static-exploration.json', import.meta.url)));
  for (const id of ['S2', 'S4']) {
    const p = JSON.parse(readFileSync(new URL(`./profiles/exploration-${id}.json`, import.meta.url)));
    assert.equal(validateGroupedProfile(p), p);
    const s = selected.profiles.find(s => s.id === id);
    assert.equal(p.steps.at(-1).count, s.count);
    for (const key of ['vocabulary', 'savedNodes', 'tagsPerItem']) assert.equal(p[key], s[key]);
    assert.equal(p.seed, selected.dataSeed);
    assert.throws(() => validateGroupedProfile({ ...p, vocabulary: p.vocabulary + 1 }));
    assert.throws(() => validateGroupedProfile({ ...p, steps: p.steps.slice(1) }));
    assert.throws(() => validateGroupedProfile({ ...p, distribution: 'unknown' }));
  }
});

test('recorded exploration families keep exact sizes, unique wide nodes and explicit correlations', () => {
  for (const options of [wide, correlated]) {
    const f = makeMeasurementFixture({ ...options, count: 100 });
    assert.equal(f.nodes.length, options.savedNodes);
    assert.equal(new Set(f.nodes.map(n => JSON.stringify(n.tags))).size, options.savedNodes);
    assert.ok(f.nodes.every(n => n.tags.length === 2));
    assert.ok(f.items.every(i => new Set(i.tags).size === options.tagsPerItem));
    assert.deepEqual(f, makeMeasurementFixture({ ...options, count: 100 }));
    const containing = tag => f.items.filter(i => i.tags.includes(tag)).map(i => i.id);
    assert.equal(containing('тег_0000').length, 10);
    if (options.distribution === 'clustered') {
      assert.equal(containing('тег_0003').length, 60);
      assert.equal(containing('тег_0008').length, 5);
      assert.deepEqual(containing('тег_0003'), containing('тег_0007'));
      assert.deepEqual(containing('тег_0008'), containing('тег_0017'));
    }
  }
  assert.throws(() => makeMeasurementFixture({ ...wide, count: 10504 }));
  assert.throws(() => makeMeasurementFixture({ ...correlated, count: 36991 }));
  assert.throws(() => makeMeasurementFixture({ ...wide, count: 100, vocabulary: 6080 }));
});

test('both exploration distributions reuse the grouped verification and measurement path', async () => {
  for (const family of [wide, correlated]) {
    const job = { ...family, count: 100, samples: 1,
      queryNames: ['nodes/all', 'free/all', 'nodes/ten-percent', 'free/ten-percent'] };
    const verification = await runGroupedJob({ ...job, candidate: 'verify' });
    assert.equal(verification.status, 'ok');
    const measured = await runGroupedJob({ ...job, candidate: 'index', expected: verification.result.answers,
      expectedFixtureSHA256: verification.result.fixture.sha256 });
    assert.equal(measured.status, 'ok');
    assert.equal(measured.result.fixture.nodes, family.savedNodes);
    assert.equal(measured.result.fixture.assignments, family.tagsPerItem * 100);
    assert.deepEqual(measured.result.queries.map(q => q.first.total), [100, 100, 10, 10]);
    assert.equal(measured.phases.filter(p => p.name === 'build').length, 1);
    assert.ok(measured.result.queries.every(q => q.preparationId === measured.result.preparationId));
    assert.throws(() => runGroupedJob({ ...job, candidate: 'verify', savedNodes: family.savedNodes + 1 }));
  }
});

test('admission accounts for unseen vocabulary and additional timed repeats', () => {
  const row = { count: 1000, samples: 1, status: 'ok', elapsedMs: 5000, rssMax: 0,
    phases: [{ name: 'startup', ms: 20 }, { name: 'read', ms: 500 }],
    result: { candidate: 'index', fixture: { vocabulary: 1000 },
      memory: { baseline: { rss: 50e6 }, end: { rss: 60e6 } } } };
  assert.equal(groupedAdmission(row, 10000).allowed, true);
  assert.equal(groupedAdmission(row, 10000, { vocabulary: 10000 }).allowed, false);
  assert.equal(groupedAdmission(row, 10000, { vocabulary: 1000, samples: 5 }).allowed, false);
  assert.equal(groupedAdmission({ ...row, result: { ...row.result, candidate: 'verify' } },
    10000, { vocabulary: 1000, samples: 5 }).allowed, true);
});
