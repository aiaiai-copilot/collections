import test from 'node:test';
import assert from 'node:assert/strict';
import { runMillionJob } from './million-runner.mjs';
import { readRss } from './measurement-runner.mjs';

const job = { kind: 'manifest', profile: { count: 100, seed: 23 } };
const workerURL = new URL('./million-lifecycle-worker.TEST.mjs', import.meta.url);
test('a successful owned OS exit before delivery of the exit event is not an observation failure', async () => {
  const result = await runMillionJob(job, { workerURL, readRss: async pid => {
    if (pid === process.pid) return readRss(pid);
    process.kill(pid, 'SIGUSR2');
    // Child exits while the coordinator cannot yet deliver its exit event.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    throw new Error('RSS observation unavailable');
  } });
  assert.equal(result.status, 'ok');
  assert.equal(result.code, 0);
  assert.deepEqual(result.result, { completed: true });
  assert.equal(result.observationIssues[0].target, 'child');
  assert.equal(result.observationIssues[0].classification, 'exit-pending');
  assert.equal(result.exit.code, 0);
});

test('a result message cannot mask loss of observation while the child is alive', async () => {
  const result = await runMillionJob(job, { workerURL, readRss: async pid => {
    if (pid === process.pid) return readRss(pid);
    throw Object.assign(new Error('observer unavailable'), { code: 'EIO' });
  } });
  assert.deepEqual(result.result, { completed: true });
  assert.equal(result.status, 'rss-observation-failed');
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.observationIssues[0].error.code, 'EIO');
  assert.equal(result.observationIssues[0].process.terminal, false);
});

test('an observed terminal child with nonzero exit remains a failed job', async () => {
  const result = await runMillionJob({ ...job, testExitCode: 7 }, { workerURL, readRss: async pid => {
    if (pid === process.pid) return readRss(pid);
    process.kill(pid, 'SIGUSR2');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    throw new Error('RSS observation unavailable');
  } });
  assert.equal(result.status, 'worker-failed');
  assert.equal(result.code, 7);
  assert.equal(result.observationIssues[0].classification, 'exit-pending');
});

test('coordinator observation failure stops an otherwise healthy child', async () => {
  let ownerCalls = 0;
  const result = await runMillionJob(job, { workerURL, readRss: async pid => {
    if (pid === process.pid && ++ownerCalls > 1) throw new Error('owner observer unavailable');
    return readRss(pid);
  } });
  assert.equal(result.status, 'rss-observation-failed');
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.observationIssues[0].target, 'coordinator');
});

test('a coordinator error in flight cannot disappear when the child closes successfully', async () => {
  let childPID;
  const result = await runMillionJob(job, { workerURL, readRss: async pid => {
    if (pid !== process.pid) { childPID = pid; return readRss(pid); }
    if (!childPID) return readRss(pid);
    process.kill(childPID, 'SIGUSR2');
    await new Promise(resolve => setTimeout(resolve, 100));
    throw new Error('late owner observer failure');
  } });
  assert.equal(result.code, 0);
  assert.deepEqual(result.result, { completed: true });
  assert.equal(result.status, 'rss-observation-failed');
  assert.equal(result.observationIssues[0].target, 'coordinator');
});
