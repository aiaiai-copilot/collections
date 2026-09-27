// Manual diagnostic: exposes the known legacy supervisor race; not a load run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { runMeasuredJob, readRss } from '../measurement-runner.mjs';
import { runSavedFilterJob } from '../saved-filter-runner.mjs';

const workerURL = new URL('../million-lifecycle-worker.TEST.mjs', import.meta.url);
for (const [name, run, job] of [
  ['legacy', runMeasuredJob, { candidate: 'verify', count: 100, seed: 23, samples: 1 }],
  ['saved-filters', runSavedFilterJob, { kind: 'metadata', profile: { variant: 'smoke', seed: 23, savedNodes: 100 } }],
]) {
  const errors = [];
  const result = await run(job, { workerURL, readRss: async pid => {
    if (pid === process.pid) return readRss(pid);
    process.kill(pid, 'SIGUSR2'); // Only the worker created by this supervisor.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    // Read the real OS state before delivering the child exit event to Node.
    try {
      const raw = execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(pid)], { env: {}, encoding: 'utf8', timeout: 1000 });
      const rss = Number(raw.trim()) * 1024;
      if (!(rss > 0)) throw new Error('RSS observation unavailable');
      return rss;
    } catch (error) { errors.push({ message: error.message, status: error.status }); throw error; }
  } });
  console.log(JSON.stringify({ name, status: result.status, code: result.code, signal: result.signal,
    completed: result.result?.completed, errors, issues: result.observationIssues }));
  assert.equal(result.code, 0); assert.equal(result.result.completed, true);
  // Expected diagnosis, not an assertion that the legacy behavior is correct.
  assert.equal(result.status, name === 'legacy' ? 'rss-observation-failed' : 'ok');
}
