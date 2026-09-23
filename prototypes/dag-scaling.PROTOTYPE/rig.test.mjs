import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanSource } from './scan-source.mjs';
import { createIndexSource } from './index-source.mjs';
import { readNavigation } from './navigation.mjs';
import { makeSmallFixture, SMALL_TAGS } from './small-fixtures.mjs';

function example() {
  return {
    revision: 'fixture:one',
    items: [
      { id: 'e1', tags: ['film', 'calm', 'evening', 'calm'] },
      { id: 'e2', tags: ['film', 'calm'] },
      { id: 'e3', tags: ['book', 'calm'] },
      { id: 'e4', tags: ['film', 'animation'] },
      { id: 'e5', tags: [] },
    ],
    nodes: [
      { id: 'film', name: 'Films', tags: ['film'] },
      { id: 'calm', name: 'Calm', tags: ['calm'] },
      { id: 'calm-film', name: 'Calm films', tags: ['film', 'calm'] },
      { id: 'evening-film', name: 'Evening films', tags: ['evening', 'film'] },
      { id: 'festival', name: 'Festival films', tags: ['film', 'festival'] },
    ],
  };
}

for (const create of [createScanSource, createIndexSource]) {
  test(`${create.name}: fixture revisions, IDs and tag arrays must be explicit`, () => {
    const noRevision = example();
    delete noRevision.revision;
    assert.throws(() => create(noRevision), /revision/);
    const noId = example();
    delete noId.items[0].id;
    assert.throws(() => create(noId), /id/);
    const badTags = example();
    badTags.items[0].tags = 'film';
    assert.throws(() => create(badTags), /tags/);
  });

  test(`${create.name}: AND counts cover all unique elements, not summed children`, () => {
    assert.deepEqual(create(example()).count([[], ['film'], ['calm', 'film'], ['missing'], ['film', 'film']]), {
      status: 'ok', revision: 'fixture:one', value: [
        { tags: [], count: 5 },
        { tags: ['film'], count: 3 },
        { tags: ['calm', 'film'], count: 2 },
        { tags: ['missing'], count: 0 },
        { tags: ['film'], count: 3 },
      ],
    });
  });

  test(`${create.name}: a static snapshot cannot drift or silently replace a revision`, () => {
    const fixture = example();
    const source = create(fixture);
    fixture.revision = 'fixture:two';
    fixture.items[0].tags = [];
    assert.equal(source.revision, 'fixture:one');
    assert.equal(source.count([['film']]).value[0].count, 3);
    assert.deepEqual(source.count([['film']], 'fixture:two'), {
      status: 'revision-unavailable', requestedRevision: 'fixture:two',
    });
  });

  test(`${create.name}: ambiguous IDs and duplicate normalized filters invalidate a fixture`, () => {
    const duplicate = example();
    duplicate.items.push({ ...duplicate.items[0] });
    assert.throws(() => create(duplicate), /duplicate item id/);
    const filters = example();
    filters.nodes.push({ id: 'another-film', name: 'Another', tags: ['film', 'film'] });
    assert.throws(() => create(filters), /duplicate node filter/);
  });

  test(`${create.name}: related filters include all comparable nodes, not only a previous branch`, () => {
    const source = create(example());
    const related = source.related(['film', 'evening', 'calm']).value;
    assert.equal(related.equal, null);
    assert.deepEqual(related.wider.map(node => node.id), ['calm', 'calm-film', 'evening-film', 'film']);
    assert.deepEqual(related.narrower, []);
    const saved = source.related(['calm']).value;
    assert.equal(saved.equal.id, 'calm');
    assert.deepEqual(saved.narrower.map(node => node.id), ['calm-film']);
    assert.deepEqual(saved.wider, []);
  });

  test(`${create.name}: the empty saved filter is returned distinctly and responses cannot mutate the source`, () => {
    const fixture = example();
    fixture.nodes.push({ id: 'all-saved', name: 'All saved', tags: [] });
    const source = create(fixture);
    const answer = source.related([]);
    assert.equal(answer.value.equal.id, 'all-saved');
    assert.equal(answer.value.narrower.length, 5);
    answer.value.equal.tags.push('changed');
    assert.deepEqual(source.related([]).value.equal.tags, []);
    assert.deepEqual(source.related(['missing']).value.wider.map(node => node.id), ['all-saved']);
  });

  test(`${create.name}: extra item tags have exact conditional counts and exclude saved-node-only tags`, () => {
    const source = create(example());
    assert.deepEqual(source.extraTags(['film']), {
      status: 'ok', revision: 'fixture:one', value: [
        { tag: 'animation', count: 1 }, { tag: 'calm', count: 2 }, { tag: 'evening', count: 1 },
      ],
    });
    assert.deepEqual(source.extraTags(['calm']).value, [
      { tag: 'book', count: 1 }, { tag: 'evening', count: 1 }, { tag: 'film', count: 2 },
    ]);
    assert.deepEqual(source.extraTags(['missing']).value, []);
  });

  test(`${create.name}: lookup distinguishes an unavailable collection from unavailable revision`, () => {
    const source = create(example());
    assert.deepEqual(source.collection('film'), {
      status: 'ok', revision: 'fixture:one', value: { id: 'film', name: 'Films', tags: ['film'] },
    });
    assert.deepEqual(source.collection('absent'), {
      status: 'collection-unavailable', revision: 'fixture:one', collectionId: 'absent',
    });
    assert.deepEqual(source.collection('absent', 'old'), {
      status: 'revision-unavailable', requestedRevision: 'old',
    });
  });

  test(`${create.name}: a host page keeps a full count and cannot limit tag answers`, () => {
    const source = create(example());
    const page = source.page(['film'], { offset: 1, limit: 1 });
    assert.deepEqual(page, {
      status: 'ok', revision: 'fixture:one', value: {
        total: 3, offset: 1, limit: 1, items: [{ id: 'e2', tags: ['calm', 'film'] }],
      },
    });
    assert.equal(source.extraTags(['film']).value.length, 3);
    assert.deepEqual(source.page(['film'], { offset: 10, limit: 1 }).value.items, []);
    assert.deepEqual(source.page(['missing']).value, { total: 0, offset: 0, limit: 20, items: [] });
    assert.throws(() => source.page([], { offset: -1 }), /page/);
    assert.throws(() => source.page([], { limit: 0 }), /page/);
  });

  test(`${create.name}: free navigation merges item-only and saved-only tags, retaining zero-count destinations`, () => {
    const value = readNavigation(create(example()), { tags: ['film'], mode: 'free' }).value;
    assert.deepEqual(value.location, { kind: 'node', nodeId: 'film', tags: ['film'] });
    assert.equal(value.total, 3);
    assert.deepEqual(value.transitions.map(t => [t.addedTags, t.nodeId, t.count]), [
      [['animation'], null, 1], [['calm'], 'calm-film', 2],
      [['evening'], 'evening-film', 1], [['festival'], 'festival', 0],
    ]);
  });

  test(`${create.name}: adding a tag can reveal an additional nearest parent`, () => {
    const source = create(example());
    const before = readNavigation(source, { tags: ['calm', 'evening'] }).value;
    assert.equal(before.location.kind, 'temporary');
    assert.deepEqual(before.parents.map(node => node.id), ['calm']);
    const after = readNavigation(source, { tags: ['calm', 'evening', 'film'] }).value;
    assert.deepEqual(after.parents.map(node => node.id), ['calm-film', 'evening-film']);
    assert.equal(after.total, 1);
  });

  test(`${create.name}: nodes mode takes one destination's whole filter and covers every descendant`, () => {
    const value = readNavigation(create(example()), { tags: ['film'], mode: 'nodes' }).value;
    assert.deepEqual(value.transitions.map(t => [t.nodeId, t.targetTags, t.count, t.coveredNodeIds]), [
      ['calm-film', ['calm', 'film'], 2, ['calm-film']],
      ['evening-film', ['evening', 'film'], 1, ['evening-film']],
      ['festival', ['festival', 'film'], 0, ['festival']],
    ]);
    assert.deepEqual(value.parents, []);
  });
}

test('a full navigation read rejects a truncated count batch and inconsistent host count', () => {
  const base = createIndexSource(example());
  const truncated = {
    ...base,
    count: (...args) => ({ ...base.count(...args), value: [] }),
  };
  assert.deepEqual(readNavigation(truncated), { status: 'read-failed', reason: 'invalid-count-batch' });
  const wrongPage = {
    ...base,
    page: (...args) => {
      const answer = base.page(...args);
      return { ...answer, value: { ...answer.value, total: 999 } };
    },
  };
  assert.deepEqual(readNavigation(wrongPage), { status: 'read-failed', reason: 'inconsistent-page-count' });
});

test('a mixed revision or source failure cannot become a successful partial navigation read', () => {
  const base = createIndexSource(example());
  const mixed = { ...base, page: (...args) => ({ ...base.page(...args), revision: 'other' }) };
  assert.deepEqual(readNavigation(mixed), { status: 'read-failed', reason: 'mixed-revision' });
  const failed = { ...base, related: () => ({ status: 'read-failed', reason: 'injected-source-failure' }) };
  assert.deepEqual(readNavigation(failed), { status: 'read-failed', reason: 'injected-source-failure' });
  assert.equal(readNavigation(base, { collectionId: 'absent' }).status, 'collection-unavailable');
  assert.equal(readNavigation(base, { revision: 'old' }).status, 'revision-unavailable');
});

for (const create of [createScanSource, createIndexSource]) {
  test(`${create.name}: all and an empty saved node remain distinct in both modes`, () => {
    const fixture = example();
    fixture.nodes.push({ id: 'saved-all', name: 'Saved all', tags: [] });
    const source = create(fixture);
    for (const mode of ['nodes', 'free']) {
      const all = readNavigation(source, { mode }).value;
      const saved = readNavigation(source, { mode, collectionId: 'saved-all' }).value;
      assert.equal(all.location.kind, 'all');
      assert.equal(saved.location.kind, 'node');
      assert.equal(saved.location.nodeId, 'saved-all');
      assert.equal(all.total, saved.total);
      assert.deepEqual(all.page, saved.page);
      assert.ok(all.transitions.some(t => t.nodeId === 'saved-all'));
      assert.ok(!saved.transitions.some(t => t.nodeId === 'saved-all'));
      if (mode === 'free') assert.ok(all.transitions.some(t => t.addedTags.includes('book')));
      else assert.equal(all.transitions.length, 1);
    }
  });

  test(`${create.name}: an empty space and zero-count saved descendants are valid`, () => {
    const empty = create({ revision: 'empty', items: [], nodes: [] });
    for (const mode of ['nodes', 'free']) {
      const value = readNavigation(empty, { mode }).value;
      assert.equal(value.total, 0);
      assert.deepEqual(value.transitions, []);
      assert.deepEqual(value.page.items, []);
    }
    const saved = create({ revision: 'saved-only', items: [], nodes: [
      { id: 'a', name: 'A', tags: ['a'] }, { id: 'ab', name: 'AB', tags: ['a', 'b'] },
    ] });
    const nodes = readNavigation(saved).value;
    assert.deepEqual(nodes.transitions.map(t => [t.nodeId, t.count, t.coveredNodeIds]), [['a', 0, ['a', 'ab']]]);
    const free = readNavigation(saved, { mode: 'free' }).value;
    assert.deepEqual(free.transitions.map(t => [t.addedTags, t.count]), [[['a'], 0], [['b'], 0]]);
  });

  test(`${create.name}: 80 unrelated roots and tags are not silently limited to a page or top-N`, () => {
    const tags = Array.from({ length: 80 }, (_, i) => `t${String(i).padStart(2, '0')}`);
    const source = create({ revision: 'wide',
      items: tags.map(tag => ({ id: tag, tags: [tag] })),
      nodes: tags.map(tag => ({ id: tag, name: tag, tags: [tag] })),
    });
    for (const mode of ['nodes', 'free']) {
      const value = readNavigation(source, { mode }).value;
      assert.equal(value.total, 80);
      assert.equal(value.page.items.length, 20);
      assert.deepEqual(value.transitions.map(t => t.nodeId), tags);
      assert.ok(value.transitions.every(t => t.count === 1));
    }
    for (const answer of [source.related([], 'old'), source.extraTags([], 'old'), source.page([], {}, 'old')]) {
      assert.deepEqual(answer, { status: 'revision-unavailable', requestedRevision: 'old' });
    }
  });
}

test('small fixture generation is repeatable, varied, bounded and valid for both candidates', () => {
  assert.deepEqual(makeSmallFixture(7), makeSmallFixture(7));
  assert.notDeepEqual(makeSmallFixture(7).items, makeSmallFixture(8).items);
  assert.throws(() => makeSmallFixture(-1), /seed/);
  for (let seed = 1; seed <= 50; seed++) {
    const fixture = makeSmallFixture(seed);
    assert.ok(fixture.items.length > 0 && fixture.items.length <= 80);
    assert.ok(fixture.nodes.length <= 80);
    createScanSource(fixture);
    createIndexSource(fixture);
  }
});

test('50 seeded spaces: full source and navigation answers agree for 70 queries in both modes', t => {
  const queries = Array.from({ length: 64 }, (_, mask) => SMALL_TAGS.filter((_, bit) => mask & (1 << bit)));
  queries.push(['item-only'], ['saved-only'], ['а', 'item-only'], ['а', 'saved-only'], ['missing'], ['а', 'а']);
  let completeComparisons = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const fixture = makeSmallFixture(seed);
    const scan = createScanSource(fixture);
    const indexed = createIndexSource(fixture);
    for (const node of fixture.nodes) assert.deepEqual(indexed.collection(node.id), scan.collection(node.id));
    for (const [queryIndex, tags] of queries.entries()) {
      const context = `seed=${seed}, query=${JSON.stringify(tags)}`;
      assert.deepEqual(indexed.related(tags), scan.related(tags), context);
      assert.deepEqual(indexed.extraTags(tags), scan.extraTags(tags), context);
      assert.deepEqual(indexed.count([tags, [], [...tags, 'missing']]), scan.count([tags, [], [...tags, 'missing']]), context);
      const byMode = [];
      for (const mode of ['nodes', 'free']) {
        const request = { tags, mode, offset: queryIndex % 5, limit: 3 };
        const answer = readNavigation(indexed, request);
        assert.deepEqual(answer, readNavigation(scan, request), `${context}, mode=${mode}`);
        assert.equal(answer.status, 'ok', context);
        const covered = new Set(answer.value.transitions.flatMap(entry => entry.coveredNodeIds));
        const isAll = tags.length === 0;
        const selected = new Set(tags);
        for (const node of fixture.nodes) {
          if (isAll || (node.tags.length > selected.size && tags.every(tag => node.tags.includes(tag)))) {
            assert.ok(covered.has(node.id), `${context}: unreachable saved node ${node.id}`);
          }
        }
        byMode.push(answer.value);
        completeComparisons++;
      }
      assert.equal(byMode[0].total, byMode[1].total, context);
      assert.deepEqual(byMode[0].page, byMode[1].page, context);
    }
  }
  assert.equal(completeComparisons, 7000);
  t.diagnostic('7000 complete navigation comparisons; 3500 queries for each source capability group; 50 seeds.');
});
