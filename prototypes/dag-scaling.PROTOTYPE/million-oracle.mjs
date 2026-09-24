// PROTOTYPE: offline complete oracle; no candidate postings or candidate answers.
import assert from 'node:assert/strict';
import { canonicalTags, reader, pageWindow } from './contract.mjs';
import { createScanSource } from './scan-source.mjs';
import { readNavigation } from './navigation.mjs';
import { readPartition, validateManifest, digest } from './million-fixture.mjs';

const key = tags => JSON.stringify(canonicalTags(tags));
const requestID = job => digest({ request: job.request, stage: job.stage, tagSets: job.tagSets ?? null });
export function readOraclePart(job) {
  assert.ok(['tags', 'counts'].includes(job.stage), 'invalid oracle stage');
  const fixture = readPartition(job.manifest, job.index);
  const source = createScanSource(fixture);
  const tags = canonicalTags(job.request.tags ?? []);
  const value = job.stage === 'tags' ? source.extraTags(tags).value : {
    counts: source.count(job.tagSets).value,
    page: source.page(tags, { offset: 0, limit: job.request.offset + job.request.limit }).value,
  };
  const body = { manifestID: job.manifest.id, index: job.index, partitionSHA256: job.manifest.parts[job.index].sha256,
    revision: fixture.revision, requestID: requestID(job), stage: job.stage, value };
  return { ...body, sha256: digest(body) };
}

export async function prepareOracle(manifest, input, runPart, { timeoutMs = 120000, deadline = Infinity } = {}) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000);
  deadline = Math.min(deadline, Date.now() + timeoutMs);
  const checkTime = () => { if (Date.now() >= deadline) throw new Error('oracle deadline'); };
  checkTime();
  validateManifest(manifest);
  const request = { ...input, tags: canonicalTags(input.tags ?? []), ...pageWindow(input) };
  assert.ok(['nodes', 'free'].includes(request.mode));
  const metadata = createScanSource({ revision: manifest.revision, nodes: manifest.nodes, items: [] });
  const related = metadata.related(request.tags).value;
  const frequencies = new Map();
  const part = async (stage, index, tagSets) => {
    checkTime();
    const job = { manifest, index, request, stage, ...(tagSets ? { tagSets } : {}) };
    const result = await runPart(job, deadline);
    checkTime();
    assert.ok(result, 'missing partition response');
    const { sha256, ...body } = result;
    assert.equal(sha256, digest(body), 'response checksum mismatch');
    assert.equal(result.manifestID, manifest.id);
    assert.equal(result.index, index, 'replayed partition');
    assert.equal(result.partitionSHA256, manifest.parts[index].sha256);
    assert.equal(result.revision, manifest.revision);
    assert.equal(result.requestID, requestID(job));
    assert.equal(result.stage, stage);
    const size = manifest.parts[index].end - manifest.parts[index].start;
    const countOK = n => Number.isSafeInteger(n) && n >= 0 && n <= size;
    if (stage === 'tags') {
      const seen = new Set();
      for (const row of result.value) {
        assert.ok(typeof row.tag === 'string' && !request.tags.includes(row.tag) && !seen.has(row.tag));
        assert.ok(countOK(row.count) && row.count > 0); seen.add(row.tag);
      }
    } else {
      assert.equal(result.value.counts.length, tagSets.length, 'incomplete counts');
      result.value.counts.forEach((row, i) => { assert.deepEqual(row.tags, tagSets[i]); assert.ok(countOK(row.count)); });
      const page = result.value.page;
      assert.equal(page.offset, 0); assert.equal(page.limit, request.offset + request.limit);
      assert.ok(countOK(page.total)); assert.equal(page.total, result.value.counts[0].count);
      assert.equal(page.items.length, Math.min(page.total, page.limit));
      assert.equal(new Set(page.items.map(item => item.id)).size, page.items.length);
    }
    return result.value;
  };
  if (request.mode === 'free') {
    for (let i = 0; i < manifest.parts.length; i++) {
      for (const { tag, count } of await part('tags', i)) frequencies.set(tag, (frequencies.get(tag) ?? 0) + count);
    }
  }
  const tagSets = new Map([[key(request.tags), request.tags]]);
  if (request.mode === 'free') {
    const candidates = new Set([...frequencies.keys(), ...related.narrower.flatMap(node => node.tags)]);
    for (const tag of candidates) {
      if (!request.tags.includes(tag)) {
        const tags = canonicalTags([...request.tags, tag]); tagSets.set(key(tags), tags);
      }
    }
  } else for (const node of related.narrower) tagSets.set(key(node.tags), node.tags);
  const queries = [...tagSets.values()], sums = queries.map(tags => ({ tags, count: 0 }));
  let total = 0, items = [];
  for (let i = 0; i < manifest.parts.length; i++) {
    const value = await part('counts', i, queries);
    value.counts.forEach((row, index) => { sums[index].count += row.count; });
    total += value.page.total;
    items = [...items, ...value.page.items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, request.offset + request.limit);
  }
  const counts = new Map(sums.map(row => [key(row.tags), row]));
  const read = reader({ revision: manifest.revision });
  const source = { ...metadata,
    extraTags: (tags, revision = manifest.revision) => read(revision, () => {
      assert.equal(key(tags), key(request.tags));
      return [...frequencies.keys()].sort().map(tag => ({ tag, count: frequencies.get(tag) }));
    }),
    count: (sets, revision = manifest.revision) => read(revision, () => sets.map(tags => {
      const row = counts.get(key(tags)); assert.ok(row, 'unverified count query'); return row;
    })),
    page: (tags, options, revision = manifest.revision) => read(revision, () => {
      assert.equal(key(tags), key(request.tags)); assert.deepEqual(pageWindow(options), pageWindow(request));
      return { total, offset: request.offset, limit: request.limit, items: items.slice(request.offset) };
    }),
  };
  const answer = readNavigation(source, request);
  assert.equal(answer.status, 'ok');
  checkTime();
  return { answer, answerSHA256: digest(answer) };
}
