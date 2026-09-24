// Manual diagnostic, not an ordinary passing test or a measurement entry point.
import assert from 'node:assert/strict';
import { runMillionJob } from '../million-runner.mjs';
import { readRss } from '../measurement-runner.mjs';
const end = Date.now() + 45000;
let reproduced = 0;
for (let i = 0; i < 120 && Date.now() < end; i++) {
  const errors = [], delay = 185 + i % 20;
  const result = await runMillionJob({ kind: 'manifest', profile: { count: 100, seed: 23 }, delay }, {
    workerURL: new URL('./exit-worker.REPRO.mjs', import.meta.url), deadline: end,
    readRss: async pid => {
      try { return await readRss(pid); }
      catch (error) { errors.push({ target: pid === process.pid ? 'coordinator' : 'child', code: error.code, signal: error.signal, stdout: error.stdout, stderr: error.stderr, message: error.message }); throw error; }
    },
  });
  if (result.status !== 'ok') {
    console.log(JSON.stringify({ iteration: i, delay, status: result.status, code: result.code, signal: result.signal, result: result.result, errors }));
    if (result.status === 'rss-observation-failed' && result.code === 0 && result.result?.completed) reproduced++;
  }
}
console.log(JSON.stringify({ reproduced }));
assert.equal(reproduced, 0, 'successful exits reported as RSS failures');
