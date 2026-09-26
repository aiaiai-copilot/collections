// Explicit bounded work order; no automatic retry/resume of a failed file.
export function millionSchedule(mode) {
  if (mode === 'smoke') return [{ count: 113, seed: 23, stage: 'smoke', samples: 1, runs: 1 }];
  if (!['run', 'finish89'].includes(mode)) throw new RangeError('unknown million schedule');
  const seeds = mode === 'run' ? [23, 47, 89] : [89];
  return [
    ...[100000, 250000, 500000].map(count => ({ count, seed: seeds[0], stage: 'gate', samples: 1, runs: 1 })),
    ...seeds.flatMap((seed, i) => (i === 1 ? [1000000, 100000] : [100000, 1000000])
      .map(count => ({ count, seed, stage: 'series', samples: 5, runs: 3 }))),
  ];
}
