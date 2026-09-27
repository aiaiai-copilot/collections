// PROTOTYPE: conservative per-job projection for fixed N/V and growing saved M.
import assert from 'node:assert/strict';
import { savedFilterProfile, savedFilterRequests } from './saved-filter-fixture.mjs';

const finite = n => assert.ok(Number.isFinite(n) && n >= 0, 'incomplete numeric observation');
function validatePoint(rows, profile) {
  const runs = profile.variant === 'main' ? [1, 2, 3] : [1], samples = profile.variant === 'main' ? 5 : 1;
  const expected = ['metadata', ...savedFilterRequests(profile).flatMap(q => [
    `verify:${q.name}`, ...runs.map(run => `index:${q.name}:${run}`),
  ])].sort();
  assert.deepEqual(rows.map(r => r.kind === 'metadata' ? 'metadata' :
    `${r.kind}:${r.query}${r.kind === 'index' ? `:${r.run}` : ''}`).sort(), expected, 'incomplete point');
  for (const row of rows) {
    assert.equal(row.status, 'ok'); assert.deepEqual(row.profile, profile);
    finite(row.elapsedMs); finite(row.rssMax);
    const value = row.result;
    for (const k of ['generationMs', 'buildMs', 'metadataMs', 'metadataCountMs']) finite(value[k]);
    assert.ok(value.memory.baseline.rss > 0);
    for (const m of Object.values(value.memory)) { finite(m.rss); assert.ok(m.rss > 0); }
    assert.ok(row.phases.length > 0);
    for (const p of row.phases) { finite(p.ms); if (p.memory) finite(p.memory.rss); }
    const stages = row.kind === 'metadata' ? [] : row.kind === 'verify' ? ['verify', 'verify'] : ['first', 'warmup', ...Array(samples).fill('sample')];
    assert.deepEqual(value.readings.map(r => r.stage), stages);
    if (row.kind === 'verify') assert.deepEqual(value.readings.map(r => r.candidate), ['scan', 'index']);
    if (row.kind === 'index') assert.ok(value.readings.every(r => r.candidate === 'index'));
    for (const r of value.readings) {
      for (const k of ['readMs', 'postReadMs', 'transitionPreparationMs', 'otherAssemblyMs', 'itemTags']) finite(r[k]);
      finite(r.memory.rss); assert.ok(r.memory.rss > 0);
      assert.ok(Number.isSafeInteger(r.countBatch) && r.countBatch > 0);
      for (const k of ['related', 'count', 'page']) finite(r.sourceMs[k]);
      if (row.query.startsWith('free/')) finite(r.sourceMs.extraTags);
      for (const n of Object.values(r.sourceMs)) finite(n);
      assert.ok(Math.abs(r.readMs - r.transitionPreparationMs - r.otherAssemblyMs -
        Object.values(r.sourceMs).reduce((a, b) => a + b, 0)) < 0.01, 'inconsistent read times');
    }
    assert.ok(row.elapsedMs >= value.readings.reduce((sum, r) => sum + r.readMs, 0), 'inconsistent job time');
  }
}

export function savedFilterAdmission(rows, nextNodes) {
  assert.ok(Array.isArray(rows) && rows.length);
  const profile = rows[0].profile, before = savedFilterProfile(profile);
  validatePoint(rows, profile);
  const next = savedFilterProfile({ ...profile, savedNodes: nextNodes });
  assert.ok(nextNodes > profile.savedNodes);
  const ratio = nextNodes / profile.savedNodes;
  const jobs = rows.map(row => {
    const value = row.result;
    const baseline = value.memory.baseline.rss;
    const peak = Math.max(row.rssMax, ...Object.values(value.memory).map(m => m.rss),
      ...row.phases.map(p => p.memory?.rss ?? 0), ...value.readings.map(r => r.memory.rss));
    const reads = value.readings.map(r => {
      const [mode, selection] = row.query.split('/');
      let nextBatch = r.countBatch;
      if (mode === 'nodes') nextBatch = selection === 'all' ? nextNodes + 1 :
        ['ten-percent', 'one-percent', 'one-item'].includes(selection) ? nextNodes / (next.pool / 2) + 1 : 1;
      else if (['ten-percent', 'one-percent', 'one-item'].includes(selection)) {
        nextBatch = 1 + Math.min(999, r.itemTags + nextNodes / (next.pool / 2));
      }
      const terms = { related: r.sourceMs.related * ratio, count: r.sourceMs.count * Math.max(1, nextBatch / r.countBatch),
        extraTags: r.sourceMs.extraTags ?? 0, page: r.sourceMs.page,
        transitionPreparationMs: r.transitionPreparationMs * ratio ** 2, otherAssemblyMs: r.otherAssemblyMs * ratio };
      const projectedReadMs = 1.25 * Object.values(terms).reduce((a, b) => a + b, 0);
      return { candidate: r.candidate, stage: r.stage, observed: r, nextBatch, terms, projectedReadMs };
    });
    const observedReadsMs = value.readings.reduce((sum, r) => sum + r.readMs, 0);
    const observedOverheadMs = row.elapsedMs - observedReadsMs;
    const projectedJobMs = 1.25 * observedOverheadMs * ratio + reads.reduce((sum, r) => sum + r.projectedReadMs, 0);
    const projectedRSS = 1.25 * (baseline + ratio * (peak - baseline));
    const service = Object.fromEntries(['generationMs', 'buildMs', 'metadataMs', 'metadataCountMs'].map(k => [k, value[k] * ratio * 1.25]));
    return { kind: row.kind, query: row.query, run: row.run, baseline, peak, projectedRSS,
      observedOverheadMs, projectedJobMs, service, reads,
      allowed: projectedRSS <= 4 * 1024 ** 3 && projectedJobMs <= 100000 &&
        reads.every(r => r.projectedReadMs <= 20000) && Object.values(service).every(ms => ms <= 20000) };
  });
  return { from: before.savedNodes, to: nextNodes, profile, ratio, jobs, allowed: jobs.every(j => j.allowed) };
}
