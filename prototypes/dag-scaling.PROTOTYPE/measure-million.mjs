// PROTOTYPE: supervised synthetic admission gates, then paired 100k/1m series.
import assert from 'node:assert/strict';
import { open, readFile, readdir, statfs } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { runMillionJob, admission } from './million-runner.mjs';
import { prepareOracle } from './million-oracle.mjs';
import { measurementRequests } from './measurement-fixture.mjs';
import { millionSchedule } from './million-schedule.mjs';

const [mode, filename] = process.argv.slice(2);
assert.ok(['smoke', 'run', 'finish89'].includes(mode) && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.jsonl$/.test(filename ?? '') && process.argv.length === 4,
  'Usage: node measure-million.mjs <smoke|run|finish89> <new-file.jsonl>');
const schedule = millionSchedule(mode);
const directory = new URL('./', import.meta.url), root = fileURLToPath(new URL('../../', directory));
const file = await open(new URL(`results/${filename}`, directory), 'wx');
const deadline = Date.now() + 20 * 60 * 1000;
let outputBytes = 0;
async function append(row) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n';
  if (outputBytes + Buffer.byteLength(line) > 10 * 1024 ** 2 - 4096) throw new Error('series-output-limit');
  await file.write(line); outputBytes += Buffer.byteLength(line); await file.sync();
}
async function resources() {
  assert.ok(Date.now() < deadline, 'series deadline');
  assert.equal(os.platform(), 'darwin', 'memory observer requires macOS');
  const pressure = execFileSync('/usr/bin/memory_pressure', ['-Q'], { env: {}, encoding: 'utf8', timeout: 5000 });
  const percent = Number(pressure.match(/System-wide memory free percentage:\s*(\d+)%/)?.[1]);
  const disk = await statfs(root), available = disk.bavail * disk.bsize;
  assert.ok(Number.isFinite(percent) && percent >= 10 && available >= 1024 ** 3, 'resource preflight failed');
  return { systemMemoryFreePercent: percent, diskAvailable: available, freeMemory: os.freemem(), loadAverage: os.loadavg() };
}
let controls;
async function oldControl(seed) {
  controls ??= (await readFile(new URL('results/growth-10k-100k-2026-09-23.jsonl', directory), 'utf8')).trim().split('\n').map(JSON.parse)
    .filter(r => r.type === 'verification' && r.count === 100000);
  const rows = controls.filter(r => r.seed === seed);
  assert.equal(rows.length, 6);
  return { fixture: rows[0].result.fixture, answers: Object.assign({}, ...rows.map(r => r.result.answers)) };
}
async function job(job, context, jobDeadline = deadline) {
  const resource = await resources();
  const result = await runMillionJob(job, { deadline: Math.min(deadline, jobDeadline) });
  const saved = { ...result };
  if (job.kind === 'oracle' && result.result) {
    const { value, ...audit } = result.result;
    saved.result = { ...audit, rows: Array.isArray(value) ? value.length : value.counts.length,
      ...(value.page ? { pageTotal: value.page.total, pageItems: value.page.items.length } : {}) };
  }
  await append({ type: job.kind, ...context, resources: resource, ...saved });
  assert.equal(result.status, 'ok', `${job.kind} stopped: ${result.status}`);
  return result;
}
async function point(count, seed, stage, samples, runs) {
  const context = { count, seed, stage };
  await append({ type: 'point-start', ...context });
  const manifest = (await job({ kind: 'manifest', profile: { count, seed }, chunkSize: mode === 'smoke' ? 37 : 100000 }, context)).result;
  const control = count === 100000 ? await oldControl(seed) : null;
  if (control) assert.deepEqual(manifest.fixture, control.fixture, 'control fixture drift');
  const expected = {};
  for (const query of measurementRequests()) {
    const start = performance.now();
    const verified = await prepareOracle(manifest, query.request, async (part, queryDeadline) =>
      (await job({ kind: 'oracle', ...part }, { ...context, query: query.name, index: part.index, oracleStage: part.stage }, queryDeadline)).result,
    { deadline });
    expected[query.name] = verified.answerSHA256;
    if (control) assert.equal(verified.answerSHA256, control.answers[query.name], `control answer drift: ${query.name}`);
    await append({ type: 'verified', ...context, query: query.name, answerSHA256: verified.answerSHA256,
      manifestID: manifest.id, elapsedMs: performance.now() - start, total: verified.answer.value.total,
      transitions: verified.answer.value.transitions.length, controlMatched: !!control });
    console.log(`${stage} ${count}/${seed} ${query.name}: verified`);
  }
  let last;
  for (let run = 1; run <= runs; run++) {
    last = await job({ kind: 'index', manifest, expected, samples, queryNames: measurementRequests().map(q => q.name) }, { ...context, run });
    console.log(`${stage} ${count}/${seed} index ${run}/${runs}: ok, RSS poll ${(last.rssMax / 1048576).toFixed(1)} MiB`);
  }
  await append({ type: 'point-complete', ...context, fixtureSHA256: manifest.fixture.sha256 });
  return { ...last, count };
}
try {
  const codeSHA256 = {};
  for (const name of (await readdir(directory)).filter(n => n.endsWith('.mjs')).sort()) {
    codeSHA256[name] = createHash('sha256').update(await readFile(new URL(name, directory))).digest('hex');
  }
  await append({ type: 'header', protocol: 'partition-million-v2-exit-observation', mode, schedule,
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), codeSHA256,
    host: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version, cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, totalMemory: os.totalmem() },
    profile: { ...(mode === 'smoke' ? { gates: [113], series: [], seeds: [23], runs: 1, samples: 1 }
      : { gates: [100000, 250000, 500000], series: [100000, 1000000], seeds: mode === 'finish89' ? [89] : [23, 47, 89], runs: 3, samples: 5 }), tagsPerItem: 10, vocabulary: 1000, savedNodes: 100 },
    policy: { worker: 'one; empty environment; old space 4096 MiB; step 30s; wall 120s; RSS watchdog 6GiB',
      coordinator: 'RSS watchdog 256MiB; oracle whole-query 120s; whole series 20min; output 10MiB',
      gate: '1.25 reserve, projected phase/OS RSS <=4GiB and whole step <=20s',
      oracle: 'independent scan in <=100k item partitions; two passes; exact complete answers; no partial success',
      metadata: 'streamed same fixture JSON checksum; input retained in index worker; no forced GC',
      read: 'same full read, copying and stage timers; hashing/JSON excluded; first + warmup + 5 samples',
      evidence: 'partition response payloads checked live; audit digests/identities saved; index measurements saved in full',
      observation: 'RSS failure checks owned child OS exit state; code-zero close plus result required; live child and coordinator failures stop; audit retained',
      network: 'none; no API, DSN, .env, database or server', interference: 'interactive host, not CPU-pinned' } });
  let previous, admittedMillion = false;
  for (const task of schedule) {
    if (task.stage === 'gate' && previous) {
      const gate = admission(previous, task.count); await append({ type: 'admission', ...gate });
      assert.ok(gate.allowed, 'resource admission refused');
    }
    if (task.stage === 'series' && !admittedMillion) {
      const gate = admission(previous, 1000000); await append({ type: 'admission', ...gate });
      assert.ok(gate.allowed, 'million admission refused'); admittedMillion = true;
    }
    const result = await point(task.count, task.seed, task.stage, task.samples, task.runs);
    if (task.stage === 'gate') previous = result;
  }
  await append({ type: 'complete' });
} catch (error) {
  const line = JSON.stringify({ at: new Date().toISOString(), type: 'failed', error: { name: error.name, message: error.message } }) + '\n';
  await file.write(line); await file.sync(); process.exitCode = 1; console.error(error.message);
} finally { await file.close(); }
