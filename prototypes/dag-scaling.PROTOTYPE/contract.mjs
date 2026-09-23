// PROTOTYPE: shared representation only, never a shared query algorithm.
export function canonicalTags(tags) {
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || tag.length === 0)) {
    throw new TypeError('tags must be an array of nonempty strings');
  }
  return [...new Set(tags)].sort();
}

export function pageWindow({ offset = 0, limit = 20 } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError('invalid page window');
  }
  return { offset, limit };
}

export function snapshot(input) {
  const data = structuredClone(input);
  if (typeof data.revision !== 'string' || data.revision.length === 0) throw new TypeError('fixture revision required');
  for (const [kind, records] of [['item', data.items], ['node', data.nodes]]) {
    if (!Array.isArray(records)) throw new TypeError(`fixture ${kind} array required`);
    const ids = new Set();
    const filters = new Set();
    for (const record of records) {
      if (typeof record.id !== 'string' || record.id.length === 0) throw new TypeError(`${kind} id required`);
      if (ids.has(record.id)) throw new Error(`duplicate ${kind} id`);
      ids.add(record.id);
      record.tags = canonicalTags(record.tags);
      if (kind === 'node') {
        const key = JSON.stringify(record.tags);
        if (filters.has(key)) throw new Error('duplicate node filter');
        filters.add(key);
      }
    }
    records.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  return data;
}

export function reader(fixture) {
  return (requestedRevision, compute) => requestedRevision !== fixture.revision
    ? { status: 'revision-unavailable', requestedRevision }
    : { status: 'ok', revision: fixture.revision, value: structuredClone(compute()) };
}
