// PROTOTYPE: a profile-specific interface over the same owned-process watchdog.
import assert from 'node:assert/strict';
import { runObservedJob } from './million-runner.mjs';
import { savedFilterProfile, savedFilterRequests } from './saved-filter-fixture.mjs';

export function runSavedFilterJob(job, options = {}) {
  assert.ok(['metadata', 'verify', 'index'].includes(job.kind), 'invalid job kind');
  savedFilterProfile(job.profile);
  if (job.kind !== 'metadata') assert.ok(savedFilterRequests(job.profile).some(q => q.name === job.query), 'invalid query');
  if (job.kind === 'index') {
    assert.match(job.expected ?? '', /^[a-f0-9]{64}$/, 'full scan verification digest required');
    assert.ok(Number.isInteger(job.samples) && job.samples >= 1 && job.samples <= 5, 'invalid sample count');
  }
  return runObservedJob(job, { ...options, workerURL: options.workerURL ?? new URL('./saved-filter-worker.mjs', import.meta.url) });
}
