// PROTOTYPE entry point. Fixed pilot series; no product config or network.
import { open, mkdir, readFile, readdir, statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { runMeasuredJob } from './measurement-runner.mjs';

const count = Number(process.argv[2]);
const filename = process.argv[3];
if (![100, 10000].includes(count) || !filename || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.jsonl$/.test(filename) || process.argv.length !== 4) {
  throw new Error('Usage: node measure.mjs <100|10000> <new-file.jsonl>; output is under ./results');
}
const directory = new URL('./', import.meta.url);
const root = fileURLToPath(new URL('../../', directory));
const results = new URL('./results/', directory);
await mkdir(results, { recursive: true });
const target = new URL(filename, results);
const file = await open(target, 'wx'); // Never overwrite an earlier run.
let bytes = 0;
const append = async record => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n';
  bytes += Buffer.byteLength(line);
  if (bytes > 10 * 1024 ** 2) throw new Error('series file budget exceeded');
  await file.write(line);
  await file.sync(); // Outside workers and their timing windows.
};

try {
  const versions = {};
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.mjs')).sort()) {
    versions[name] = createHash('sha256').update(await readFile(new URL(name, directory))).digest('hex');
  }
  const disk = await statfs(directory);
  if (disk.bavail * disk.bsize < 1024 ** 3) throw new Error('less than 1 GiB disk available');
  await append({ type: 'header', profile: { count, seed: 23, tagsPerItem: 10, vocabulary: 1000, nodes: 100, runs: 3, samples: 5, warmups: 1 },
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), codeSHA256: versions,
    host: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version,
      cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, totalMemory: os.totalmem(),
      freeMemory: os.freemem(), loadAverage: os.loadavg(), diskAvailable: disk.bavail * disk.bsize },
    policy: { network: 'none', workerEnvironment: 'empty', gc: 'normal; no forced GC', heapMiB: 4096,
      memory: 'RSS samples; includes generator input, source snapshot, indexes, answers, runtime; not isolated index bytes',
      first: 'first for this query, not guaranteed cold runtime or OS cache',
      read: 'complete navigation + one page; per-method timing overhead included; hashing/serialization excluded',
      serialization: 'source response envelopes separately, final view without sourceFacts; not a chosen wire protocol',
      fixedOrder: 'nodes then free; selectivity all, 10%, 1%, one, none; candidates alternate order by run',
      interference: 'ordinary interactive host, not isolated or CPU-pinned; no caches cleared' } });
  const config = { count, seed: 23, samples: 5 };
  const verification = await runMeasuredJob({ ...config, candidate: 'verify' });
  await append({ type: 'verification', ...verification });
  console.log(`verification: ${verification.status}, ${(verification.elapsedMs / 1000).toFixed(2)} s`);
  if (verification.status !== 'ok') throw new Error('verification failed; no timing comparison');
  for (let run = 1; run <= 3; run++) {
    for (const candidate of run % 2 ? ['scan', 'index'] : ['index', 'scan']) {
      const outcome = await runMeasuredJob({ ...config, candidate, expected: verification.result.answers });
      await append({ type: 'measurement', run, candidate, ...outcome });
      console.log(`run ${run}, ${candidate}: ${outcome.status}, ${(outcome.elapsedMs / 1000).toFixed(2)} s`);
      if (outcome.status !== 'ok') throw new Error(`series stopped: ${outcome.status}`);
      if (outcome.result.fixture.sha256 !== verification.result.fixture.sha256) throw new Error('fixture checksum mismatch');
    }
  }
  await append({ type: 'complete' });
  console.log(fileURLToPath(target));
} catch (error) {
  await append({ type: 'failed', message: error.message }).catch(() => {});
  process.exitCode = 1;
  console.error(error.message);
} finally { await file.close(); }
