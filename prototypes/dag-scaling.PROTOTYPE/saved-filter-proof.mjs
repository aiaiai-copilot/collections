// PROTOTYPE: small proof only; not a load generator or benchmark.
import { makeMeasurementFixture } from './measurement-fixture.mjs';

const tag = n => `тег_${String(n).padStart(4, '0')}`;
export function makeSavedFilterProofFixture(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['seed', 'savedNodes'].includes(key))) throw new RangeError('invalid proof profile');
  const { seed = 23, savedNodes = 10 } = options;
  if (![10, 20, 100].includes(savedNodes)) throw new RangeError('proof savedNodes: 10, 20 or 100');
  const base = makeMeasurementFixture({ count: 100, seed });
  let ring = Array.from({ length: 20 }, (_, i) => i);
  const nodes = [];
  for (let round = 0; round < savedNodes / 10; round++) {
    for (let i = 0; i < 10; i++) {
      const id = String(nodes.length).padStart(5, '0');
      nodes.push({ id: `pair-${id}`, name: `Пара ${id}`, tags: [tag(ring[i]), tag(ring[19 - i])].sort() });
    }
    ring = [ring[0], ring.at(-1), ...ring.slice(1, -1)];
  }
  return { revision: `saved-pairs-proof-v1-${seed}-${savedNodes}`, items: base.items, nodes };
}
