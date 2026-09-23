// PROTOTYPE: one owned local child, no shell, backend or inherited environment.
import { fork, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { measurementRequests } from './measurement-fixture.mjs';
const exec = promisify(execFile);
const worker = new URL('./measurement-worker.mjs', import.meta.url);
const MiB = 1024 ** 2;

export async function readRss(pid) {
  const { stdout } = await exec('/bin/ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 1000, maxBuffer: 4096, env: {} });
  const kib = Number(stdout.trim());
  if (!Number.isFinite(kib) || kib <= 0) throw new Error('RSS observation unavailable');
  return kib * 1024;
}

export async function runMeasuredJob(job, options = {}) {
  if (!['verify', 'scan', 'index'].includes(job.candidate) ||
      !Number.isSafeInteger(job.count) || job.count < 100 || job.count > 100000 ||
      !Number.isSafeInteger(job.seed) || job.seed < 0 || job.seed > 0xffffffff ||
      !Number.isSafeInteger(job.samples) || job.samples < 1 || job.samples > 20) throw new RangeError('invalid pilot job');
  const available = measurementRequests().map(query => query.name);
  const queryNames = job.queryNames === undefined ? available : job.queryNames;
  if (!Array.isArray(queryNames) || !queryNames.length || new Set(queryNames).size !== queryNames.length ||
      queryNames.some(name => !available.includes(name))) throw new RangeError('invalid query window');
  if (job.candidate !== 'verify' && (!job.expected || queryNames.some(name => typeof job.expected[name] !== 'string' || !job.expected[name]))) {
    throw new Error('verified full-answer digests required');
  }
  const limits = { wallMs: 120000, stepMs: 30000, rssBytes: 6 * 1024 ** 3, outputBytes: 10 * MiB, ...options.limits };
  for (const [key, max] of Object.entries({ wallMs: 120000, stepMs: 30000, rssBytes: 6 * 1024 ** 3, outputBytes: 10 * MiB })) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > max) throw new RangeError(`invalid ${key}`);
  }
  const probe = options.readRss ?? readRss;
  // Fail closed before allocating the workload if OS observation is unavailable.
  await probe(process.pid);
  return new Promise(resolve => {
    const start = performance.now();
    const child = fork(fileURLToPath(options.workerURL ?? worker), [], {
      execArgv: ['--max-old-space-size=4096'], env: {}, silent: true,
    });
    let stopReason, phase = 'startup', result, failure, outputBytes = 0, rssSampleMax = 0;
    let stepTimer, polling = false, closed = false;
    const completed = [];
    const stop = reason => {
      if (closed || stopReason) return;
      stopReason = reason;
      child.kill('SIGKILL'); // Only this owned child; no PID lookup / process-group kill.
    };
    const countOutput = bytes => { outputBytes += bytes; if (outputBytes > limits.outputBytes) stop('output-limit'); };
    const resetStep = () => { clearTimeout(stepTimer); stepTimer = setTimeout(() => stop('step-timeout'), limits.stepMs); };
    const wallTimer = setTimeout(() => stop('wall-timeout'), limits.wallMs);
    resetStep();
    const poll = async () => {
      if (closed || polling) return;
      polling = true;
      try {
        const rss = await probe(child.pid);
        rssSampleMax = Math.max(rssSampleMax, rss);
        if (rss > limits.rssBytes) stop('rss-limit');
      } catch {
        if (!closed && child.exitCode === null && child.signalCode === null) stop('rss-observation-failed');
      } finally { polling = false; }
    };
    const rssTimer = setInterval(poll, 250);
    child.stdout.on('data', data => countOutput(data.length));
    child.stderr.on('data', data => countOutput(data.length));
    child.on('message', message => {
      countOutput(Buffer.byteLength(JSON.stringify(message)));
      if (message.type === 'phase') { phase = message.name; resetStep(); }
      if (message.type === 'completed') completed.push(message.value);
      if (message.type === 'result') result = message.value;
      if (message.type === 'failure') failure = message.value;
    });
    child.on('error', error => { failure = { message: error.message }; });
    child.on('close', (code, signal) => {
      closed = true;
      clearTimeout(wallTimer); clearTimeout(stepTimer); clearInterval(rssTimer);
      resolve({
        status: stopReason ?? (code === 0 && result ? 'ok' : 'worker-failed'),
        phase, code, signal, elapsedMs: performance.now() - start,
        limits, rssPollMs: 250, rssSampleMax, outputBytes,
        ...(result ? { result } : { completed }), ...(failure ? { failure } : {}),
      });
    });
    child.send({ ...job, queryNames });
  });
}
