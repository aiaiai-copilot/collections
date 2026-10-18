// PROTOTYPE: one prepared worker serves a query group; local synthetic data only.
import assert from 'node:assert/strict';
import { open, mkdir, readFile, readdir, statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { runGroupedJob, groupedAdmission, resumeSmoke, validateGroupedProfile } from './grouped-runner.mjs';

const [profileName, filename, checkpoint] = process.argv.slice(2);
const resultName = name => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.jsonl$/.test(name ?? '');
assert.ok([4, 5].includes(process.argv.length) && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.json$/.test(profileName ?? '') &&
  resultName(filename) && (checkpoint === undefined || resultName(checkpoint)),
  'Usage: node --max-old-space-size=192 measure-groups.mjs <profile.json> <new-result.jsonl> [smoke-checkpoint.jsonl]');
const directory = new URL('./', import.meta.url), results = new URL('results/', directory);
const profileText = await readFile(new URL(`profiles/${profileName}`, directory), 'utf8');
const profile = validateGroupedProfile(JSON.parse(profileText));
await mkdir(results, { recursive: true });
const target = new URL(filename, results), file = await open(target, 'wx');
const deadline = Date.now() + 20 * 60 * 1000;
let bytes = 0;
const append = async record => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n';
  bytes += Buffer.byteLength(line);
  if (bytes > 10 * 1024 ** 2) throw new Error('series output limit');
  await file.write(line); await file.sync();
};
async function resources() {
  assert.ok(Date.now() < deadline, 'series deadline');
  assert.equal(os.platform(), 'darwin', 'macOS preflight required');
  const disk = await statfs(directory);
  const text = execFileSync('/usr/bin/memory_pressure', ['-Q'], { encoding: 'utf8', env: {}, timeout: 5000 });
  const match = text.match(/System-wide memory free percentage:\s*(\d+)%/);
  const value = { freeMemory: os.freemem(), loadAverage: os.loadavg(),
    memoryFreePercent: match ? Number(match[1]) : null, diskAvailable: disk.bavail * disk.bsize };
  await append({ type: 'resources', ...value });
  assert.ok(match && value.memoryFreePercent >= 10 && value.diskAvailable >= 1024 ** 3, 'resource preflight failed');
}

try {
  const codeSHA256 = {};
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.mjs')).sort()) {
    codeSHA256[name] = createHash('sha256').update(await readFile(new URL(name, directory))).digest('hex');
  }
  await append({ type: 'header', protocol: 'prepared-query-groups-v4', profile,
    profileSHA256: createHash('sha256').update(profileText).digest('hex'), codeSHA256,
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(),
    host: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version,
      cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, totalMemory: os.totalmem() },
    policy: {
      target: 'synthetic in-memory only; empty child environment; no API/DB/network',
      setup: 'one fixture and one index per measured group; separate full scan/index verification group',
      memory: 'input retained; RSS includes snapshots, indexes, answers and normal GC; no forced GC',
      first: 'first in group is fresh process, not guaranteed cold OS/runtime; later queries share warm state',
      repeats: 'queries inside a group are dependent; independent preparations are group-level repeats',
      order: 'normal, reverse, rotate by two across three main preparations',
      stops: 'step 30s; worker 120s; RSS 6GiB; owner 256MiB; window 20min; output 10MiB; first error stops',
      admission: 'prior same-family/density/catalog-size group x N ratio x declared/observed vocabulary ratio x1.25; startup fixed x1.25, whole index job also scales by repeat count; RSS<=4GiB, step<=20s, job<=100s; estimate not guarantee',
      completeness: 'full scan/index answers; matching input digest; no top-N; one page of 20 items',
    } });
  let previous;
  if (checkpoint) {
    const raw = await readFile(new URL(checkpoint, results), 'utf8');
    previous = resumeSmoke(raw.trim().split('\n').map(JSON.parse), { profile, codeSHA256 });
    await append({ type: 'resume', checkpoint, sha256: createHash('sha256').update(raw).digest('hex'),
      completedCount: 100, reason: 'v2 separates fixed process startup from N-dependent phases; all measurement code unchanged' });
  }
  for (const step of profile.steps) {
    if (checkpoint && step.count === 100) continue;
    if (previous) {
      const gates = previous.map(row => groupedAdmission(row, step.count,
        { vocabulary: profile.vocabulary ?? 1000, samples: step.samples }));
      const allowed = gates.every(g => g.allowed);
      await append({ type: 'admission', to: step.count, gates, allowed });
      assert.ok(allowed, 'resource admission refused; no automatic smaller replacement');
    }
    const common = { count: step.count, seed: profile.seed, tagsPerItem: profile.tagsPerItem,
      ...(profile.catalog ? { catalog: profile.catalog } : {}),
      ...(profile.catalog === 'wide' ? { vocabulary: profile.vocabulary,
        savedNodes: profile.savedNodes, distribution: profile.distribution } : {}),
      queryNames: profile.queryNames, samples: step.samples };
    await resources();
    const verification = await runGroupedJob({ ...common, candidate: 'verify' }, { deadline });
    await append({ type: 'verification', ...step, ...verification });
    console.log(`${step.role} verify: ${verification.status}, ${(verification.elapsedMs / 1000).toFixed(2)} s`);
    assert.equal(verification.status, 'ok', 'verification failed');
    const rows = [{ ...verification, count: step.count, samples: step.samples }];
    for (let run = 0; run < step.runs; run++) {
      const queryNames = run === 1 ? [...profile.queryNames].reverse() : run === 2
        ? [...profile.queryNames.slice(2), ...profile.queryNames.slice(0, 2)] : profile.queryNames;
      await resources();
      const outcome = await runGroupedJob({ ...common, queryNames, candidate: 'index',
        expected: verification.result.answers, expectedFixtureSHA256: verification.result.fixture.sha256 }, { deadline });
      await append({ type: 'measurement', ...step, run: run + 1, queryNames, ...outcome });
      console.log(`${step.role} group ${run + 1}/${step.runs}: ${outcome.status}, ${(outcome.elapsedMs / 1000).toFixed(2)} s`);
      assert.equal(outcome.status, 'ok', 'measurement failed');
      rows.push({ ...outcome, count: step.count, samples: step.samples });
    }
    await append({ type: 'group-complete', ...step, fixtureSHA256: verification.result.fixture.sha256 });
    previous = rows;
  }
  await append({ type: 'complete' });
  console.log(fileURLToPath(target));
} catch (error) {
  await append({ type: 'failed', message: error.message }).catch(() => {});
  process.exitCode = 1;
  console.error(error.message);
} finally { await file.close(); }
