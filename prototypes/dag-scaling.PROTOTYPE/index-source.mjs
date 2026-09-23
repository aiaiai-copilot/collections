// PROTOTYPE: sorted posting-list candidate; no production API or I/O.
import { canonicalTags, snapshot, reader, pageWindow } from './contract.mjs';

function buildPostings(records) {
  const postings = new Map();
  records.forEach((record, ordinal) => {
    for (const tag of new Set(record.tags)) {
      if (!postings.has(tag)) postings.set(tag, []);
      postings.get(tag).push(ordinal);
    }
  });
  return postings;
}

function intersect(left, right) {
  const result = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { result.push(left[i]); i++; j++; }
    else if (left[i] < right[j]) i++;
    else j++;
  }
  return result;
}

function matching(postings, all, tags) {
  if (tags.length === 0) return all;
  const lists = tags.map(tag => postings.get(tag) ?? []).sort((a, b) => a.length - b.length);
  let result = lists[0];
  for (let i = 1; i < lists.length && result.length; i++) result = intersect(result, lists[i]);
  return result;
}

export function createIndexSource(input) {
  const fixture = snapshot(input);
  const read = reader(fixture);
  const postings = buildPostings(fixture.items);
  const all = fixture.items.map((_, i) => i);
  const nodePostings = buildPostings(fixture.nodes);
  const allNodes = fixture.nodes.map((_, i) => i);
  const emptyNodes = allNodes.filter(i => fixture.nodes[i].tags.length === 0);
  const nodeById = new Map(fixture.nodes.map(node => [node.id, node]));
  return Object.freeze({
    revision: fixture.revision,
    collection(id, revision = fixture.revision) {
      const answer = read(revision, () => nodeById.get(id) ?? null);
      return answer.status === 'ok' && answer.value === null
        ? { status: 'collection-unavailable', revision, collectionId: id } : answer;
    },
    page(input, options, revision = fixture.revision) {
      return read(revision, () => {
        const { offset, limit } = pageWindow(options);
        const matches = matching(postings, all, canonicalTags(input));
        return {
          total: matches.length, offset, limit,
          items: matches.slice(offset, offset + limit).map(i => fixture.items[i]),
        };
      });
    },
    extraTags(input, revision = fixture.revision) {
      return read(revision, () => {
        const tags = canonicalTags(input);
        const selected = new Set(tags);
        const counts = new Map();
        for (const i of matching(postings, all, tags)) {
          for (const tag of fixture.items[i].tags) {
            if (!selected.has(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
          }
        }
        return [...counts.keys()].sort().map(tag => ({ tag, count: counts.get(tag) }));
      });
    },
    related(input, revision = fixture.revision) {
      return read(revision, () => {
        const tags = canonicalTags(input);
        const containing = matching(nodePostings, allNodes, tags).map(i => fixture.nodes[i]);
        const hits = new Map(emptyNodes.map(i => [i, 0]));
        for (const tag of tags) {
          for (const i of nodePostings.get(tag) ?? []) hits.set(i, (hits.get(i) ?? 0) + 1);
        }
        const wider = [...hits.entries()]
          .filter(([i, count]) => count === fixture.nodes[i].tags.length && count < tags.length)
          .sort(([a], [b]) => a - b).map(([i]) => fixture.nodes[i]);
        return {
          equal: containing.find(node => node.tags.length === tags.length) ?? null,
          wider,
          narrower: containing.filter(node => node.tags.length > tags.length),
        };
      });
    },
    count(tagSets, revision = fixture.revision) {
      return read(revision, () => tagSets.map(input => {
        const tags = canonicalTags(input);
        return { tags, count: matching(postings, all, tags).length };
      }));
    },
  });
}
