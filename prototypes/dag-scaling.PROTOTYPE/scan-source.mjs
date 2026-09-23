// PROTOTYPE: independent scan oracle; no production API or I/O.
import { canonicalTags, snapshot, reader, pageWindow } from './contract.mjs';

export function createScanSource(input) {
  const fixture = snapshot(input);
  const read = reader(fixture);
  return Object.freeze({
    revision: fixture.revision,
    collection(id, revision = fixture.revision) {
      const answer = read(revision, () => fixture.nodes.find(node => node.id === id) ?? null);
      return answer.status === 'ok' && answer.value === null
        ? { status: 'collection-unavailable', revision, collectionId: id } : answer;
    },
    page(input, options, revision = fixture.revision) {
      return read(revision, () => {
        const { offset, limit } = pageWindow(options);
        const tags = canonicalTags(input);
        const matches = fixture.items.filter(item => tags.every(tag => item.tags.includes(tag)));
        return { total: matches.length, offset, limit, items: matches.slice(offset, offset + limit) };
      });
    },
    extraTags(input, revision = fixture.revision) {
      return read(revision, () => {
        const tags = canonicalTags(input);
        const vocabulary = new Set(fixture.items.flatMap(item => item.tags));
        const result = [];
        // Deliberately slow oracle: independent recount for each vocabulary tag.
        for (const tag of [...vocabulary].sort()) {
          if (tags.includes(tag)) continue;
          const ids = new Set();
          for (const item of fixture.items) {
            if (item.tags.includes(tag) && tags.every(selected => item.tags.includes(selected))) ids.add(item.id);
          }
          if (ids.size) result.push({ tag, count: ids.size });
        }
        return result;
      });
    },
    related(input, revision = fixture.revision) {
      return read(revision, () => {
        const tags = canonicalTags(input);
        const value = { equal: null, wider: [], narrower: [] };
        for (const node of fixture.nodes) {
          if (node.tags.length < tags.length && node.tags.every(tag => tags.includes(tag))) value.wider.push(node);
          if (tags.every(tag => node.tags.includes(tag))) {
            if (node.tags.length === tags.length) value.equal = node;
            else value.narrower.push(node);
          }
        }
        return value;
      });
    },
    count(tagSets, revision = fixture.revision) {
      return read(revision, () => tagSets.map(input => {
        const tags = canonicalTags(input);
        const ids = new Set();
        for (const item of fixture.items) {
          if (tags.every(tag => item.tags.includes(tag))) ids.add(item.id);
        }
        return { tags, count: ids.size };
      }));
    },
  });
}
