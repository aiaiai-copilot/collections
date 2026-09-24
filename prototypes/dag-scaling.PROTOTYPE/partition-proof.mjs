// PROTOTYPE: small, synchronous algebra proof, NOT a bounded large-data worker.
// All partitions coexist here. Never use its memory/timings as load measurements.
import { canonicalTags, snapshot, reader, pageWindow } from './contract.mjs';
import { createScanSource } from './scan-source.mjs';

export function createPartitionProofSource(input, { chunkSize = 20 } = {}) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 100) throw new RangeError('proof chunk: 1..100');
  if (input?.items?.length > 100 || input?.nodes?.length > 100) throw new RangeError('proof supports at most 100 items and 100 nodes');
  const fixture = snapshot(input);
  const metadata = createScanSource({ ...fixture, items: [] });
  const partitions = [];
  for (let i = 0; i < fixture.items.length; i += chunkSize) {
    partitions.push(createScanSource({ ...fixture, items: fixture.items.slice(i, i + chunkSize) }));
  }
  const read = reader(fixture);
  return Object.freeze({
    revision: fixture.revision,
    collection: metadata.collection,
    related: metadata.related,
    count(tagSets, revision = fixture.revision) {
      return read(revision, () => {
        const queries = tagSets.map(canonicalTags);
        const values = queries.map(tags => ({ tags, count: 0 }));
        for (const part of partitions) {
          part.count(queries).value.forEach((entry, i) => { values[i].count += entry.count; });
        }
        return values;
      });
    },
    extraTags(tags, revision = fixture.revision) {
      return read(revision, () => {
        const query = canonicalTags(tags);
        const counts = new Map();
        for (const part of partitions) {
          for (const entry of part.extraTags(query).value) counts.set(entry.tag, (counts.get(entry.tag) ?? 0) + entry.count);
        }
        return [...counts.keys()].sort().map(tag => ({ tag, count: counts.get(tag) }));
      });
    },
    page(tags, options, revision = fixture.revision) {
      return read(revision, () => {
        const { offset, limit } = pageWindow(options);
        const query = canonicalTags(tags);
        const items = [];
        let total = 0;
        for (const part of partitions) {
          // A global offset cannot be applied separately to every partition.
          const page = part.page(query, { offset: 0, limit: Math.min(fixture.items.length, offset + limit) }).value;
          total += page.total;
          items.push(...page.items);
        }
        items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        return { total, offset, limit, items: items.slice(offset, offset + limit) };
      });
    },
  });
}
