import test from 'node:test';
import assert from 'node:assert/strict';
import { millionSchedule } from './million-schedule.mjs';

test('finishing seed 89 repeats bounded gates and only the missing pair', () => {
  assert.deepEqual(millionSchedule('finish89'), [
    { count: 100000, seed: 89, stage: 'gate', samples: 1, runs: 1 },
    { count: 250000, seed: 89, stage: 'gate', samples: 1, runs: 1 },
    { count: 500000, seed: 89, stage: 'gate', samples: 1, runs: 1 },
    { count: 100000, seed: 89, stage: 'series', samples: 5, runs: 3 },
    { count: 1000000, seed: 89, stage: 'series', samples: 5, runs: 3 },
  ]);
});

test('the original full series and smoke keep their work order, and unknown work is refused', () => {
  assert.deepEqual(millionSchedule('smoke'), [{ count: 113, seed: 23, stage: 'smoke', samples: 1, runs: 1 }]);
  const full = millionSchedule('run');
  assert.deepEqual(full.filter(x => x.stage === 'gate').map(x => [x.count, x.seed]), [[100000, 23], [250000, 23], [500000, 23]]);
  assert.deepEqual(full.filter(x => x.stage === 'series').map(x => [x.count, x.seed]),
    [[100000, 23], [1000000, 23], [1000000, 47], [100000, 47], [100000, 89], [1000000, 89]]);
  assert.ok(full.filter(x => x.stage === 'series').every(x => x.samples === 5 && x.runs === 3));
  assert.throws(() => millionSchedule('retry'), /unknown/);
});
