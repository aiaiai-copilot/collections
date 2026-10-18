// PROTOTYPE: grouped reads on the existing worker, with the corrected watchdog.
import assert from 'node:assert/strict';
import { admission, runObservedJob } from './million-runner.mjs';
import { measurementRequests, explorationFamily } from './measurement-fixture.mjs';

export function validateGroupedProfile(profile) {
  if (['exploration-S2-v1', 'exploration-S4-v1'].includes(profile.id)) {
    assert.deepEqual(Object.keys(profile).sort(), ['catalog', 'distribution', 'id', 'queryNames', 'savedNodes',
      'seed', 'steps', 'tagsPerItem', 'vocabulary']);
    assert.equal(profile.seed, 23);
    assert.equal(profile.catalog, 'wide');
    const s2 = profile.id === 'exploration-S2-v1';
    assert.equal(explorationFamily({ ...profile, count: profile.steps.at(-1).count }), s2 ? 'S2' : 'S4');
    assert.deepEqual(profile.steps, [
      { count: 100, role: 'smoke', runs: 1, samples: 1 },
      { count: s2 ? 1000 : 2000, role: s2 ? 'admission-R3' : 'admission-R4', runs: 1, samples: 1 },
      { count: s2 ? 10503 : 36990, role: s2 ? 'exploration-S2' : 'exploration-S4', runs: 3, samples: 5 },
    ]);
    assert.deepEqual(profile.queryNames, ['nodes/all', 'free/all', 'nodes/ten-percent', 'free/ten-percent']);
    return profile;
  }
  assert.ok(['density-S1-v1', 'catalog-S3-v1'].includes(profile.id), 'unadmitted profile');
  const chains = profile.id === 'catalog-S3-v1';
  assert.deepEqual(Object.keys(profile).sort(),
    [...(chains ? ['catalog'] : []), 'id', 'queryNames', 'seed', 'steps', 'tagsPerItem']);
  assert.equal(profile.seed, 23);
  assert.equal(profile.tagsPerItem, chains ? 10 : 30);
  if (chains) assert.equal(profile.catalog, 'chains');
  assert.deepEqual(profile.steps, [
    { count: 100, role: 'smoke', runs: 1, samples: 1 },
    { count: chains ? 1000 : 10000, role: chains ? 'admission-R2' : 'admission-R1', runs: 1, samples: 1 },
    { count: chains ? 10000 : 100000, role: chains ? 'anchor-S3' : 'anchor-S1', runs: 3, samples: 5 },
  ]);
  assert.deepEqual(profile.queryNames, chains ? measurementRequests({ catalog: 'chains' }).map(q => q.name)
    : ['nodes/all', 'free/all', 'nodes/ten-percent', 'free/ten-percent']);
  return profile;
}

export function resumeSmoke(records, { profile, codeSHA256 }) {
  const header = records[0];
  assert.equal(header.protocol, 'prepared-query-groups-v1');
  assert.deepEqual(header.profile, profile);
  // Only admission/continuation plumbing and its test changed in v2.
  // Every generator, worker, source, assembly and watchdog module must match.
  const mutable = new Set(['grouped-runner.mjs', 'measure-groups.mjs', 'grouped-measurement.test.mjs']);
  const stable = hashes => Object.fromEntries(Object.entries(hashes).filter(([name]) => !mutable.has(name)));
  assert.deepEqual(stable(header.codeSHA256), stable(codeSHA256), 'measurement code changed');
  assert.equal(records.at(-1).type, 'failed');
  assert.equal(records.at(-1).message, 'resource admission refused; no automatic smaller replacement');
  const complete = records.filter(r => r.type === 'group-complete');
  assert.equal(complete.length, 1);
  assert.equal(complete[0].count, 100);
  const jobs = records.filter(r => ['verification', 'measurement'].includes(r.type));
  assert.deepEqual(jobs.map(r => [r.type, r.count, r.status]),
    [['verification', 100, 'ok'], ['measurement', 100, 'ok']]);
  const [verified, measured] = jobs;
  assert.equal(complete[0].fixtureSHA256, verified.result.fixture.sha256);
  assert.deepEqual(measured.result.fixture, verified.result.fixture);
  assert.deepEqual(measured.queryNames, profile.queryNames);
  assert.deepEqual(measured.result.queries.map(q => q.name), profile.queryNames);
  for (const q of measured.result.queries) for (const s of [q.first, ...q.samples]) {
    assert.equal(s.answerSHA256, verified.result.answers[q.name]);
  }
  return jobs;
}

export function groupedAdmission(previous, nextCount, next = {}) {
  // Startup loads the same worker code before data generation. It is not
  // proportional to N. Retain its own margin and the conservative whole-job gate.
  const dataPhases = previous.phases.filter(p => p.name !== 'startup');
  const startup = previous.phases.filter(p => p.name === 'startup');
  assert.ok(dataPhases.length && startup.length === 1);
  assert.ok([...dataPhases, ...startup].every(p => Number.isFinite(p.ms) && p.ms >= 0));
  const gate = admission({ ...previous, phases: dataPhases }, nextCount);
  const seenVocabulary = previous.result.fixture?.vocabulary;
  if (next.vocabulary !== undefined) assert.ok(Number.isSafeInteger(seenVocabulary) && seenVocabulary > 0 &&
    Number.isSafeInteger(next.vocabulary) && next.vocabulary > 0);
  const vocabularyFactor = next.vocabulary === undefined ? 1 : Math.max(1, next.vocabulary / seenVocabulary);
  const oldSamples = previous.samples ?? previous.result.queries?.[0]?.samples.length ?? 1;
  if (next.samples !== undefined) assert.ok(Number.isInteger(next.samples) && next.samples >= 1 && next.samples <= 5);
  const repeatFactor = previous.result.candidate === 'index' && next.samples !== undefined
    ? Math.max(1, (2 + next.samples) / (2 + oldSamples)) : 1;
  const projectedStartupMs = 1.25 * startup[0].ms;
  const projectedStepMs = Math.max(gate.projectedStepMs * vocabularyFactor, projectedStartupMs);
  const projectedRSS = 1.25 * gate.baseline + (gate.projectedRSS - 1.25 * gate.baseline) * vocabularyFactor;
  const projectedJobMs = 1.25 * previous.elapsedMs * nextCount / previous.count * vocabularyFactor * repeatFactor;
  return { ...gate, projectedRSS, projectedStartupMs, projectedStepMs, projectedJobMs, vocabularyFactor, repeatFactor,
    allowed: gate.allowed && projectedRSS <= 4 * 1024 ** 3 && projectedStepMs <= 20000 && projectedJobMs <= 100000 };
}

export function runGroupedJob(job, options = {}) {
  assert.ok(job && Object.keys(job).every(k => ['candidate', 'count', 'seed', 'tagsPerItem',
    'catalog', 'vocabulary', 'savedNodes', 'distribution', 'samples', 'queryNames', 'expected', 'expectedFixtureSHA256'].includes(k)), 'invalid grouped job fields');
  assert.ok(['verify', 'index'].includes(job.candidate), 'invalid grouped candidate');
  assert.ok(Number.isSafeInteger(job.count) && job.count >= 100 && job.count <= 100000, 'invalid grouped count');
  assert.ok(Number.isSafeInteger(job.seed) && job.seed >= 0 && job.seed <= 0xffffffff, 'invalid grouped seed');
  const catalog = job.catalog ?? 'mixed';
  assert.ok(['mixed', 'chains', 'wide'].includes(catalog), 'invalid grouped catalog');
  if (catalog === 'wide') explorationFamily(job);
  else {
    assert.ok(job.vocabulary === undefined && job.savedNodes === undefined && job.distribution === undefined,
      'unsupported grouped parameters');
    assert.ok(catalog === 'mixed' ? job.tagsPerItem === 30 : job.tagsPerItem === 10 && job.count <= 10000,
      'only admitted density/catalog combinations are supported');
  }
  assert.ok(Number.isInteger(job.samples) && job.samples >= 1 && job.samples <= 5, 'invalid grouped samples');
  const available = measurementRequests({ catalog }).map(q => q.name);
  assert.ok(Array.isArray(job.queryNames) && job.queryNames.length > 0 &&
    new Set(job.queryNames).size === job.queryNames.length &&
    job.queryNames.every(name => available.includes(name)), 'invalid grouped query window');
  if (job.candidate === 'index') {
    assert.match(job.expectedFixtureSHA256 ?? '', /^[a-f0-9]{64}$/, 'verified fixture digest required');
    assert.ok(job.queryNames.every(name => /^[a-f0-9]{64}$/.test(job.expected?.[name])), 'full answer digests required');
  }
  return runObservedJob({ ...job, vocabulary: job.vocabulary ?? 1000, grouped: true }, {
    ...options, workerURL: options.workerURL ?? new URL('./measurement-worker.mjs', import.meta.url),
  });
}
