// PROTOTYPE: deliberately bounded correctness fixtures, NOT a load generator.
export const SMALL_TAGS = Object.freeze(['а', 'b_c', 'é', '日本語', 'tag:1', '__proto__']);
export function makeSmallFixture(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('invalid seed');
  let state = seed >>> 0;
  const next = bound => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 16) % bound;
  };
  const tagsFor = mask => SMALL_TAGS.filter((_, bit) => mask & (1 << bit));
  const items = Array.from({ length: 12 + next(49) }, (_, i) => {
    const tags = tagsFor(i === 0 ? 0 : next(64));
    if (i > 0 && i % 5 === 0) tags.push('item-only');
    if (tags.length && next(3) === 0) tags.push(tags[0]);
    return { id: `e${String(i).padStart(3, '0')}`, tags: tags.reverse() };
  });
  const nodes = [];
  for (let mask = 0; mask < 64; mask++) {
    if (next(4) === 0) nodes.push({ id: `n${String(mask).padStart(2, '0')}`, name: `Node ${mask}`, tags: tagsFor(mask).reverse() });
  }
  nodes.push(
    { id: 'saved-only', name: 'Saved only', tags: ['saved-only'] },
    { id: 'saved-with-a', name: 'Saved with A', tags: ['saved-only', 'а'] },
  );
  return { revision: `seed:${seed}`, items: items.reverse(), nodes: nodes.reverse() };
}
