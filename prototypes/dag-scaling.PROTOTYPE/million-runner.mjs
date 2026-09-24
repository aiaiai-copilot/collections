// PROTOTYPE: one owned process with coordinator + worker observation and deadlines.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRss } from './measurement-runner.mjs';
import { profileOf, validateManifest } from './million-fixture.mjs';
import { measurementRequests } from './measurement-fixture.mjs';

export function admission(previous, nextCount) {
  assert.equal(previous.status, 'ok');
  assert.ok(nextCount > previous.count && nextCount <= 1000000);
  const memory = previous.result.memory, baseline = memory.baseline.rss;
  const snapshots = [...Object.values(memory), ...previous.phases.map(p => p.memory).filter(Boolean),
    ...(previous.result.queries ?? []).flatMap(q => [q.first, ...q.samples].map(s => s.memory))];
  const peak = Math.max(previous.rssMax, ...snapshots.map(m => m.rss));
  const ratio = nextCount / previous.count;
  const projectedRSS = 1.25 * (baseline + (peak - baseline) * ratio);
  const projectedStepMs = 1.25 * Math.max(...previous.phases.map(p => p.ms)) * ratio;
  return { from: previous.count, to: nextCount, baseline, peak, projectedRSS, projectedStepMs,
    allowed: projectedRSS <= 4 * 1024 ** 3 && projectedStepMs <= 20000 };
}

export async function runMillionJob(job, options = {}) {
  assert.ok(['manifest', 'oracle', 'index'].includes(job.kind));
  if (job.kind === 'manifest') profileOf(job.profile); else validateManifest(job.manifest);
  if (job.kind === 'index') {
    const names = measurementRequests().map(q => q.name);
    assert.ok(Array.isArray(job.queryNames) && job.queryNames.length && new Set(job.queryNames).size === job.queryNames.length);
    assert.ok(job.queryNames.every(name => names.includes(name) && /^[a-f0-9]{64}$/.test(job.expected?.[name])));
    assert.ok(Number.isInteger(job.samples) && job.samples >= 1 && job.samples <= 5);
  }
  const maxima = { stepMs: 30000, wallMs: 120000, rssBytes: 6 * 1024 ** 3, ownerBytes: 256 * 1024 ** 2, outputBytes: 10 * 1024 ** 2 };
  const limits = { ...maxima, ...options.limits };
  for (const [key, max] of Object.entries(maxima)) assert.ok(Number.isSafeInteger(limits[key]) && limits[key] > 0 && limits[key] <= max, `invalid ${key}`);
  const deadline = Math.min(options.deadline ?? Infinity, Date.now() + limits.wallMs);
  if (deadline <= Date.now()) return { status: 'deadline', phases: [] };
  const probe = options.readRss ?? readRss;
  const initialOwnerRSS = await probe(process.pid);
  if (initialOwnerRSS > limits.ownerBytes) return { status: 'coordinator-rss-limit', ownerRSS: initialOwnerRSS, phases: [] };
  return new Promise(resolve => {
    const start = performance.now();
    const child = fork(fileURLToPath(options.workerURL ?? new URL('./million-worker.mjs', import.meta.url)), [], {
      execArgv: ['--max-old-space-size=4096'], env: {}, silent: true,
    });
    let reason, result, failure, phase = 'startup', phaseStart = start, phaseMemory;
    let stepTimer, closed = false, polling = false, rssMax = 0, ownerRSS = initialOwnerRSS, outputBytes = 0;
    const phases = [];
    const stop = value => { if (!closed && !reason) { reason = value; child.kill('SIGKILL'); } };
    const step = () => { clearTimeout(stepTimer); stepTimer = setTimeout(() => stop('step-timeout'), limits.stepMs); };
    const countOutput = n => { outputBytes += n; if (outputBytes > limits.outputBytes) stop('output-limit'); };
    const wall = setTimeout(() => stop('deadline'), Math.max(1, deadline - Date.now()));
    step();
    const timer = setInterval(async () => {
      if (closed || polling) return;
      polling = true;
      try {
        ownerRSS = Math.max(ownerRSS, await probe(process.pid));
        if (ownerRSS > limits.ownerBytes) stop('coordinator-rss-limit');
        const rss = await probe(child.pid); rssMax = Math.max(rssMax, rss);
        if (rss > limits.rssBytes) stop('rss-limit');
      } catch { if (!closed && child.exitCode === null && child.signalCode === null) stop('rss-observation-failed'); }
      finally { polling = false; }
    }, 250);
    child.stdout.on('data', data => countOutput(data.length));
    child.stderr.on('data', data => countOutput(data.length));
    child.on('message', message => {
      countOutput(Buffer.byteLength(JSON.stringify(message)));
      if (message.type === 'phase') {
        const now = performance.now(); phases.push({ name: phase, ms: now - phaseStart, memory: phaseMemory });
        phase = message.name; phaseMemory = message.memory; phaseStart = now; step();
      }
      if (message.type === 'result') result = message.value;
      if (message.type === 'failure') failure = message.value;
    });
    child.on('error', error => { failure = { message: error.message }; });
    child.on('close', (code, signal) => {
      closed = true; clearInterval(timer); clearTimeout(wall); clearTimeout(stepTimer);
      phases.push({ name: phase, ms: performance.now() - phaseStart, memory: phaseMemory });
      resolve({ status: reason ?? (code === 0 && result ? 'ok' : 'worker-failed'), code, signal, phase,
        elapsedMs: performance.now() - start, phases, limits, rssMax, ownerRSS, outputBytes,
        ...(result ? { result } : {}), ...(failure ? { failure } : {}) });
    });
    child.send(job);
  });
}
