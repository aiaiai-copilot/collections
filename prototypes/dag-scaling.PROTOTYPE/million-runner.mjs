// PROTOTYPE: one owned process with coordinator + worker observation and deadlines.
import assert from 'node:assert/strict';
import { fork, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readRss } from './measurement-runner.mjs';
import { profileOf, validateManifest } from './million-fixture.mjs';
import { measurementRequests } from './measurement-fixture.mjs';

const exec = promisify(execFile);
const errorInfo = error => Object.fromEntries(['name', 'message', 'code', 'signal', 'stdout', 'stderr']
  .filter(key => error[key] !== undefined).map(key => [key, String(error[key]).slice(0, 4096)]));
async function exitState(pid) {
  try {
    const { stdout } = await exec('/bin/ps', ['-o', 'stat=', '-p', String(pid)], { timeout: 1000, maxBuffer: 4096, env: {} });
    const state = stdout.trim();
    // macOS ps: E = trying to exit; Z = dead process not yet reaped.
    return { state, terminal: /^\S+$/.test(state) && (state.includes('E') || state.startsWith('Z')) };
  } catch (error) {
    if (error.code === 1 && error.stdout === '' && error.stderr === '') return { state: 'absent', terminal: true };
    throw error;
  }
}

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
  return runObservedJob(job, { ...options, workerURL: options.workerURL ?? new URL('./million-worker.mjs', import.meta.url) });
}

// Shared supervision only; each profile's caller must validate its own job first.
export async function runObservedJob(job, options) {
  assert.ok(options.workerURL instanceof URL, 'an explicit worker is required');
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
    const child = fork(fileURLToPath(options.workerURL), [], {
      execArgv: ['--max-old-space-size=4096'], env: {}, silent: true,
    });
    let reason, result, failure, phase = 'startup', phaseStart = start, phaseMemory;
    let stepTimer, closed = false, polling = false, rssMax = 0, ownerRSS = initialOwnerRSS, outputBytes = 0;
    let activePoll = Promise.resolve(), exit;
    const phases = [], observationIssues = [];
    const stop = value => { if (!reason) { reason = value; if (!closed) child.kill('SIGKILL'); } };
    const step = () => { clearTimeout(stepTimer); stepTimer = setTimeout(() => stop('step-timeout'), limits.stepMs); };
    const countOutput = n => { outputBytes += n; if (outputBytes > limits.outputBytes) stop('output-limit'); };
    const wall = setTimeout(() => stop('deadline'), Math.max(1, deadline - Date.now()));
    step();
    const timer = setInterval(() => {
      if (closed || polling) return;
      polling = true;
      activePoll = (async () => {
      let target = 'coordinator';
      try {
        ownerRSS = Math.max(ownerRSS, await probe(process.pid));
        if (ownerRSS > limits.ownerBytes) stop('coordinator-rss-limit');
        if (closed) return;
        target = 'child';
        const rss = await probe(child.pid); rssMax = Math.max(rssMax, rss);
        if (rss > limits.rssBytes) stop('rss-limit');
      } catch (error) {
        const issue = { target, atMs: performance.now() - start, phase, error: errorInfo(error),
          exitCodeAtFailure: child.exitCode, signalCodeAtFailure: child.signalCode };
        observationIssues.push(issue);
        if (target === 'child') {
          try {
            issue.process = await exitState(child.pid);
            if (issue.process.terminal) { issue.classification = 'exit-pending'; return; }
          } catch (stateError) { issue.stateError = errorInfo(stateError); }
        }
        issue.classification = 'observation-failed';
        stop('rss-observation-failed');
      }
      finally { polling = false; }
      })();
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
    child.on('exit', (code, signal) => { exit = { code, signal, atMs: performance.now() - start }; });
    child.on('close', async (code, signal) => {
      closed = true; clearInterval(timer); clearTimeout(wall); clearTimeout(stepTimer);
      phases.push({ name: phase, ms: performance.now() - phaseStart, memory: phaseMemory });
      // Do not lose a real coordinator/child observation failure racing with close.
      await activePoll;
      resolve({ status: reason ?? (code === 0 && result ? 'ok' : 'worker-failed'), code, signal, phase,
        elapsedMs: performance.now() - start, phases, limits, rssMax, ownerRSS, outputBytes,
        exit, observationIssues,
        ...(result ? { result } : {}), ...(failure ? { failure } : {}) });
    });
    child.send(job);
  });
}
