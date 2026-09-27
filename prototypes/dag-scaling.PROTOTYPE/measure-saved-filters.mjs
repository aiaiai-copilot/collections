// PROTOTYPE: one bounded, sequential, non-resumable measurement window.
import assert from 'node:assert/strict';
import { open, readFile, readdir, statfs } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { runSavedFilterJob } from './saved-filter-runner.mjs';
import { savedFilterAdmission } from './saved-filter-admission.mjs';
import { savedFilterRequests } from './saved-filter-fixture.mjs';

const [mode, filename] = process.argv.slice(2);
assert.ok(['smoke', 'run'].includes(mode) && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.jsonl$/.test(filename ?? '') && process.argv.length === 4,
  'Usage: node measure-saved-filters.mjs <smoke|run> <new-file.jsonl>');
const directory = new URL('./', import.meta.url), root = fileURLToPath(new URL('../../', directory));
const deadline = Date.now() + 20 * 60 * 1000;
const file = await open(new URL(`results/${filename}`, directory), 'wx');
const plan = mode === 'run' ? { variant: 'main', seeds: [23, 47, 89], nodes: [100, 1000, 10000], runs: 3, samples: 5 } :
  { variant: 'smoke', seeds: [23], nodes: [10, 20, 100], runs: 1, samples: 1 };
let outputBytes = 0, jobsCompleted = 0;
async function append(row) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n';
  assert.ok(outputBytes + Buffer.byteLength(line) <= 10 * 1024 ** 2 - 4096, 'series-output-limit');
  await file.write(line); outputBytes += Buffer.byteLength(line); await file.sync();
}
async function resources() {
  assert.ok(Date.now() < deadline, 'series deadline');
  assert.equal(os.platform(), 'darwin');
  const pressure = execFileSync('/usr/bin/memory_pressure', ['-Q'], { env: {}, encoding: 'utf8', timeout: 5000 });
  const percent = Number(pressure.match(/System-wide memory free percentage:\s*(\d+)%/)?.[1]);
  const disk = await statfs(root), available = disk.bavail * disk.bsize;
  assert.ok(Number.isFinite(percent) && percent >= 10 && available >= 1024 ** 3, 'resource preflight failed');
  return { systemMemoryFreePercent: percent, diskAvailable: available, freeMemory: os.freemem(), loadAverage: os.loadavg() };
}
async function job(input, run) {
  const resource = await resources();
  const result = await runSavedFilterJob(input, { deadline });
  const row = { type: 'job', kind: input.kind, profile: input.profile, query: input.query, run, resources: resource, ...result };
  await append(row);
  assert.equal(result.status, 'ok', `${input.kind} stopped: ${result.status}`);
  jobsCompleted++;
  return row;
}
async function point(profile, previous) {
  await append({ type: 'point-start', profile });
  const meta = await job({ kind: 'metadata', profile }), rows = [meta];
  if (previous) {
    assert.equal(meta.result.fixture.itemsSHA256, previous[0].result.fixture.itemsSHA256, 'items drift');
    assert.equal(meta.result.fixture.nodePrefixSHA256[previous[0].profile.savedNodes], previous[0].result.fixture.nodesSHA256, 'node prefix drift');
  }
  for (const query of savedFilterRequests(profile)) {
    const verified = await job({ kind: 'verify', profile, query: query.name }); rows.push(verified);
    assert.equal(verified.result.fixture.sha256, meta.result.fixture.sha256);
    const expected = verified.result.readings[0].answerSHA256;
    assert.equal(verified.result.readings[1].answerSHA256, expected);
    for (let run = 1; run <= plan.runs; run++) {
      const measured = await job({ kind: 'index', profile, query: query.name, expected, samples: plan.samples }, run);
      assert.equal(measured.result.fixture.sha256, meta.result.fixture.sha256);
      rows.push(measured);
    }
    console.log(`${profile.seed} M=${profile.savedNodes} ${query.name}: verified + ${plan.runs} index jobs`);
  }
  await append({ type: 'point-complete', profile, jobs: rows.length, fixtureSHA256: meta.result.fixture.sha256 });
  return rows;
}
try {
  const codeSHA256 = {};
  for (const name of (await readdir(directory)).filter(n => n.endsWith('.mjs')).sort()) {
    codeSHA256[name] = createHash('sha256').update(await readFile(new URL(name, directory))).digest('hex');
  }
  await append({ type: 'header', protocol: 'saved-pairs-measure-v1', mode, plan, deadline: new Date(deadline).toISOString(),
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), codeSHA256,
    host: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version,
      execArgv: process.execArgv, cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, totalMemory: os.totalmem() },
    policy: { limits: 'one owned worker; old space 4096 MiB; step 30s; wall 120s; worker RSS 6GiB; owner RSS 256MiB; window 20min; output 10MiB',
      isolation: 'empty child environment; synthetic memory data only; no network, API, .env, DSN, database or UI',
      order: 'seeds 23/47/89; ascending M per seed; metadata; each query scan+index verification then 3 fresh index workers',
      read: 'same full navigation + page20 offset0; first + warmup + 5 samples; hashing/serialization excluded; no forced GC',
      admission: 'per previous job; 1.25 reserve; quadratic preparation; count-batch scaling; linear other growth; <=4GiB/20s read/100s job',
      scope: 'static in-memory implementation evidence, not overall product limits or a backend SLA; interactive host' } });
  for (const seed of plan.seeds) {
    let previous;
    for (const savedNodes of plan.nodes) {
      if (previous) {
        const gate = savedFilterAdmission(previous, savedNodes);
        await append({ type: 'admission', ...gate });
        assert.ok(gate.allowed, 'saved-filter admission refused');
      }
      previous = await point({ variant: plan.variant, seed, savedNodes }, previous);
    }
  }
  await append({ type: 'complete', jobsCompleted });
} catch (error) {
  await file.write(JSON.stringify({ at: new Date().toISOString(), type: 'failed', jobsCompleted,
    error: { name: error.name, message: error.message } }) + '\n');
  await file.sync(); process.exitCode = 1; console.error(error.message);
} finally { await file.close(); }
