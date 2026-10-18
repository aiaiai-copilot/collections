// PROTOTYPE: explicit bounded profiles, no arbitrary combined expansion.
const tag = i => `тег_${String(i).padStart(4, '0')}`;

export function explorationFamily({ count, vocabulary, savedNodes, tagsPerItem, distribution }) {
  const id = vocabulary === 6079 && savedNodes === 178 && tagsPerItem === 10 && distribution === 'uniform' ? 'S2'
    : vocabulary === 2733 && savedNodes === 367 && tagsPerItem === 30 && distribution === 'clustered' ? 'S4' : null;
  if (!id || !Number.isSafeInteger(count) || count < 100 || count > (id === 'S2' ? 10503 : 36990)) {
    throw new RangeError('unsupported exploration profile');
  }
  return id;
}

export function makeMeasurementFixture({ count = 10000, seed = 23, vocabulary = 1000, tagsPerItem = 10,
  catalog = 'mixed', savedNodes, distribution = 'uniform' } = {}) {
  if (!Number.isSafeInteger(count) || count < 100 || count > 100000) throw new RangeError('pilot count: 100..100000');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed must be uint32');
  if (catalog === 'wide') explorationFamily({ count, vocabulary, savedNodes, tagsPerItem, distribution });
  else {
    if (savedNodes !== undefined || distribution !== 'uniform') throw new RangeError('unsupported distribution profile');
    if (![1000, 10000].includes(vocabulary) || (vocabulary > 1000 && count > 10000)) throw new RangeError('unsupported vocabulary profile');
    if (![10, 30].includes(tagsPerItem) || (tagsPerItem === 30 && vocabulary !== 1000)) throw new RangeError('unsupported density profile');
  }
  if (!['mixed', 'chains', 'wide'].includes(catalog) || (catalog === 'chains' &&
    (count > 10000 || vocabulary !== 1000 || tagsPerItem !== 10))) throw new RangeError('unsupported catalog profile');
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const items = Array.from({ length: count }, (_, i) => {
    const tags = new Set();
    if (i < Math.floor(count / 10)) tags.add(tag(0));
    if (i < Math.floor(count / 100)) tags.add(tag(1));
    if (i === 0) tags.add(tag(2));
    const clustered = distribution === 'clustered';
    if (clustered) {
      if (i < Math.floor(count * 0.6)) for (let t = 3; t < 8; t++) tags.add(tag(t));
      for (let t = 8 + i % 20 * 10; t < 18 + i % 20 * 10; t++) tags.add(tag(t));
    }
    const start = clustered ? 208 : 3;
    while (tags.size < (clustered ? 30 : 10)) tags.add(tag(start + Math.floor(random() * (vocabulary - start))));
    return { id: `item-${String(i).padStart(5, '0')}`, tags: [...tags].sort() };
  });
  // Keep every control assignment; density uses a separate reproducible stream.
  if (tagsPerItem === 30 && distribution !== 'clustered') {
    state = (seed ^ 0x9e3779b9) >>> 0;
    for (const item of items) {
      const tags = new Set(item.tags);
      while (tags.size < tagsPerItem) tags.add(tag(3 + Math.floor(random() * (vocabulary - 3))));
      item.tags = [...tags].sort();
    }
  }
  if (catalog === 'chains') {
    return { revision: `pilot-${count}-${seed}-chains-v1`, items, nodes: chainCatalog(items) };
  }
  if (catalog === 'wide') {
    let ring = Array.from({ length: 200 }, (_, i) => i);
    const nodes = [];
    while (nodes.length < savedNodes) {
      for (let i = 0; i < 100 && nodes.length < savedNodes; i++) {
        const id = String(nodes.length).padStart(5, '0');
        nodes.push({ id: `pair-${id}`, name: `Пара ${id}`, tags: [tag(ring[i]), tag(ring[199 - i])].sort() });
      }
      ring = [ring[0], ring.at(-1), ...ring.slice(1, -1)];
    }
    return { revision: `explore-v1-${count}-${seed}-${vocabulary}-${savedNodes}-${distribution}`, items, nodes };
  }
  const filters = Array.from({ length: 20 }, (_, i) => [tag(i)]);
  for (let i = 0; i < 40; i++) filters.push([tag(i < 20 ? 0 : 1), tag(i === 0 ? 1 : 20 + i)]);
  for (let i = 0; i < 20; i++) filters.push([tag(0), tag(i === 0 ? 1 : 20 + i), tag(60 + i)]);
  for (let i = 0; i < 20; i++) filters.push([tag(0), tag(i === 0 ? 1 : 20 + i), tag(60 + i), tag(80 + i)]);
  return {
    revision: `pilot-${count}-${seed}${vocabulary === 1000 ? '' : `-v${vocabulary}`}${tagsPerItem === 10 ? '' : '-density30-v1'}`,
    items,
    nodes: filters.map((tags, i) => ({ id: `node-${String(i).padStart(3, '0')}`, name: `Подборка ${i}`, tags: tags.sort() })),
  };
}

function chainCatalog(items) {
  const seeds = items.slice(0, 20);
  // Each component has an anchor absent from the other 19 seed records.
  // All ten seed tags are retained, so its first ten chain nodes are nonempty.
  const frequencies = new Map();
  for (const item of seeds) for (const value of item.tags) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  const anchors = seeds.map(item => item.tags.find(value => frequencies.get(value) === 1));
  if (anchors.some(value => value === undefined)) throw new Error('seed does not provide independent catalog anchors');
  const nodes = [];
  for (const [group, item] of seeds.entries()) {
    const prefix = [anchors[group], ...item.tags.filter(value => value !== anchors[group])];
    for (let i = 0; prefix.length < 30; i++) {
      const value = tag(3 + (group * 41 + i) % 997);
      if (!anchors.includes(value) && !prefix.includes(value)) prefix.push(value);
    }
    const add = (kind, length, tags) => nodes.push({
      id: `${kind}-${String(group).padStart(2, '0')}-${String(length).padStart(2, '0')}`,
      name: `Ветка ${group}, ${kind} ${length}`, tags: [...tags].sort(),
    });
    for (let length = 1; length <= 30; length++) add('chain', length, prefix.slice(0, length));
    for (let length = 2; length <= 21; length++) {
      add('side', length, [...prefix.slice(0, length - 1), prefix[length]]);
    }
  }
  return nodes;
}

export function measurementRequests({ catalog = 'mixed' } = {}) {
  if (catalog === 'chains') {
    return [
      ['all', undefined], ['joined', 'chain-00-03'], ['deep-empty', 'chain-00-30'],
    ].flatMap(([name, collectionId]) => ['nodes', 'free'].map(mode => ({
      name: `${mode}/${name}`, request: { mode, ...(collectionId ? { collectionId } : { tags: [] }), offset: 0, limit: 20 },
    })));
  }
  if (!['mixed', 'wide'].includes(catalog)) throw new RangeError('unsupported request catalog');
  return ['nodes', 'free'].flatMap(mode => [
    ['all', []], ['ten-percent', [tag(0)]], ['one-percent', [tag(1)]],
    ['one-item', [tag(2)]], ['absent', ['нет_такого_тега']],
  ].map(([name, tags]) => ({ name: `${mode}/${name}`, request: { tags, mode, offset: 0, limit: 20 } })));
}
