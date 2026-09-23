// PROTOTYPE: bounded N or vocabulary steps, never both expanded together.
const tag = i => `тег_${String(i).padStart(4, '0')}`;

export function makeMeasurementFixture({ count = 10000, seed = 23, vocabulary = 1000 } = {}) {
  if (!Number.isSafeInteger(count) || count < 100 || count > 100000) throw new RangeError('pilot count: 100..100000');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed must be uint32');
  if (![1000, 10000].includes(vocabulary) || (vocabulary > 1000 && count > 10000)) throw new RangeError('unsupported vocabulary profile');
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const items = Array.from({ length: count }, (_, i) => {
    const tags = new Set();
    if (i < Math.floor(count / 10)) tags.add(tag(0));
    if (i < Math.floor(count / 100)) tags.add(tag(1));
    if (i === 0) tags.add(tag(2));
    while (tags.size < 10) tags.add(tag(3 + Math.floor(random() * (vocabulary - 3))));
    return { id: `item-${String(i).padStart(5, '0')}`, tags: [...tags].sort() };
  });
  const filters = Array.from({ length: 20 }, (_, i) => [tag(i)]);
  for (let i = 0; i < 40; i++) filters.push([tag(i < 20 ? 0 : 1), tag(i === 0 ? 1 : 20 + i)]);
  for (let i = 0; i < 20; i++) filters.push([tag(0), tag(i === 0 ? 1 : 20 + i), tag(60 + i)]);
  for (let i = 0; i < 20; i++) filters.push([tag(0), tag(i === 0 ? 1 : 20 + i), tag(60 + i), tag(80 + i)]);
  return {
    revision: `pilot-${count}-${seed}${vocabulary === 1000 ? '' : `-v${vocabulary}`}`,
    items,
    nodes: filters.map((tags, i) => ({ id: `node-${String(i).padStart(3, '0')}`, name: `Подборка ${i}`, tags: tags.sort() })),
  };
}

export function measurementRequests() {
  return ['nodes', 'free'].flatMap(mode => [
    ['all', []], ['ten-percent', [tag(0)]], ['one-percent', [tag(1)]],
    ['one-item', [tag(2)]], ['absent', ['нет_такого_тега']],
  ].map(([name, tags]) => ({ name: `${mode}/${name}`, request: { tags, mode, offset: 0, limit: 20 } })));
}
