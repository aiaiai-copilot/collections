// PROTOTYPE: fixed items/vocabulary; only the number of saved pairs grows.
import { makeMeasurementFixture } from './measurement-fixture.mjs';
import { measurementRequests } from './measurement-fixture.mjs';
import { makeSavedFilterProofFixture } from './saved-filter-proof.mjs';

const tag = n => `тег_${String(n).padStart(4, '0')}`;
export function savedFilterProfile(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(k => !['variant', 'seed', 'savedNodes'].includes(k)) ||
      !['main', 'smoke'].includes(options.variant) || ![23, 47, 89].includes(options.seed) ||
      !(options.variant === 'main' ? [100, 1000, 10000] : [10, 20, 100]).includes(options.savedNodes)) {
    throw new RangeError('invalid saved-pairs profile');
  }
  return { ...options, count: options.variant === 'main' ? 10000 : 100, pool: options.variant === 'main' ? 200 : 20 };
}
export function makeSavedFilterFixture(options) {
  const { seed, savedNodes, variant } = savedFilterProfile(options);
  if (variant === 'smoke') return makeSavedFilterProofFixture({ seed, savedNodes });
  const base = makeMeasurementFixture({ count: 10000, seed });
  let ring = Array.from({ length: 200 }, (_, i) => i);
  const nodes = [];
  for (let round = 0; round < savedNodes / 100; round++) {
    for (let i = 0; i < 100; i++) {
      const id = String(nodes.length).padStart(5, '0');
      nodes.push({ id: `pair-${id}`, name: `Пара ${id}`, tags: [tag(ring[i]), tag(ring[199 - i])].sort() });
    }
    ring = [ring[0], ring.at(-1), ...ring.slice(1, -1)];
  }
  return { revision: `saved-pairs-v1-${seed}-${savedNodes}`, items: base.items, nodes };
}

export function savedFilterRequests(profile) {
  const { pool } = savedFilterProfile(profile);
  return ['nodes', 'free'].flatMap(mode => [
    ...measurementRequests().filter(q => q.request.mode === mode),
    ...[['saved-pair', [tag(0), tag(pool - 1)]], ['two-parents', [tag(0), tag(pool - 2), tag(pool - 1)]]]
      .map(([name, tags]) => ({ name: `${mode}/${name}`, request: { mode, tags, offset: 0, limit: 20 } })),
  ]);
}
