// PROTOTYPE: paired growth of N OR vocabulary. No database, network or product config.
import { open, mkdir, readFile, readdir, statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { runMeasuredJob } from './measurement-runner.mjs';
import { measurementRequests } from './measurement-fixture.mjs';

const [mode, filename] = process.argv.slice(2);
if (!['smoke', 'growth', 'width-smoke', 'width'].includes(mode) || !filename ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.jsonl$/.test(filename) || process.argv.length !== 4) {
  throw new Error('Usage: node measure-growth.mjs <smoke|growth|width-smoke|width> <new-file.jsonl>');
}
const directory = new URL('./', import.meta.url);
const root = fileURLToPath(new URL('../../', directory));
const results = new URL('./results/', directory);
await mkdir(results, { recursive: true });
const target = new URL(filename, results);
const file = await open(target, 'wx');
let bytes = 0;
const append = async record => {
  const line = JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n';
  bytes += Buffer.byteLength(line);
  if (bytes > 10 * 1024 ** 2) throw new Error('series file budget exceeded');
  await file.write(line);
  await file.sync();
};

async function resources() {
  if (os.platform() !== 'darwin') throw new Error('this measured profile requires macOS resource preflight');
  const disk = await statfs(directory);
  const pressure = execFileSync('/usr/bin/memory_pressure', ['-Q'], { encoding: 'utf8', env: {}, timeout: 5000 });
  const match = pressure.match(/System-wide memory free percentage:\s*(\d+)%/);
  const info = { freeMemory: os.freemem(), loadAverage: os.loadavg(), diskAvailable: disk.bavail * disk.bsize,
    systemMemoryFreePercent: match ? Number(match[1]) : null };
  await append({ type: 'resources', ...info });
  if (!match || info.systemMemoryFreePercent < 10 || info.diskAvailable < 1024 ** 3) throw new Error('resource preflight failed');
}

try {
  const codeSHA256 = {};
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.mjs')).sort()) {
    codeSHA256[name] = createHash('sha256').update(await readFile(new URL(name, directory))).digest('hex');
  }
  const profile = {
    growth: { counts: [10000, 100000], vocabularies: [1000], seeds: [23, 47, 89], runs: 3, samples: 5 },
    smoke: { counts: [100], vocabularies: [1000], seeds: [23], runs: 1, samples: 1 },
    width: { counts: [10000], vocabularies: [1000, 10000], seeds: [23, 47, 89], runs: 3, samples: 5 },
    'width-smoke': { counts: [100], vocabularies: [1000, 10000], seeds: [23], runs: 1, samples: 1 },
  }[mode];
  const names = measurementRequests().map(query => query.name);
  const windows = [names.filter(name => name.startsWith('nodes/')), ...names.filter(name => name.startsWith('free/')).map(name => [name])];
  await append({ type: 'header', protocol: mode.startsWith('width') ? 'vocabulary-width-v1' : 'fixed-vocabulary-growth-v1', mode, profile: { ...profile, tagsPerItem: 10, nodes: 100, warmups: 1 },
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), codeSHA256,
    host: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version,
      cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, totalMemory: os.totalmem() },
    policy: { network: 'none', workerEnvironment: 'empty', oldSpaceMiB: 4096,
      gc: 'normal; no forced GC', memory: 'input retained; RSS snapshots + 250ms OS polls, not exact peak or index size',
      verificationWindows: windows, scanRole: 'correctness only; verify elapsed is not query latency',
      measuredCandidate: 'index', read: 'complete navigation + one page; method timer overhead included; hashing/serialization excluded',
      first: 'first for this query in a fresh process, not guaranteed cold runtime or OS cache',
      order: 'paired axis values per seed; reverse points for middle seed; all 10 queries in original order per measured job',
      limits: 'step 30s; process 120s; observed RSS 6GiB; series output 10MiB; stop on first failure',
      interference: 'interactive host, not CPU-pinned or isolated; resource preflight before each point' } });
  for (const [seedIndex, seed] of profile.seeds.entries()) {
    const points = profile.counts.flatMap(count => profile.vocabularies.map(vocabulary => ({ count, vocabulary, seed })));
    if (seedIndex % 2) points.reverse();
    for (const point of points) {
      const label = `${point.count}/V${point.vocabulary}/${seed}`;
      await append({ type: 'point-start', ...point });
      await resources();
      const config = { ...point, samples: profile.samples };
      const expected = {};
      let fixtureSHA256;
      for (const [window, queryNames] of windows.entries()) {
        const outcome = await runMeasuredJob({ ...config, candidate: 'verify', queryNames });
        await append({ type: 'verification', ...point, window, queryNames, ...outcome });
        console.log(`${label} verify ${window + 1}/${windows.length}: ${outcome.status}, ${(outcome.elapsedMs / 1000).toFixed(2)} s`);
        if (outcome.status !== 'ok') throw new Error(`verification stopped: ${outcome.status}`);
        fixtureSHA256 ??= outcome.result.fixture.sha256;
        if (fixtureSHA256 !== outcome.result.fixture.sha256) throw new Error('verification fixture checksum mismatch');
        Object.assign(expected, outcome.result.answers);
      }
      if (Object.keys(expected).length !== names.length || names.some(name => !expected[name])) throw new Error('incomplete verification coverage');
      for (let run = 1; run <= profile.runs; run++) {
        const outcome = await runMeasuredJob({ ...config, candidate: 'index', expected });
        await append({ type: 'measurement', ...point, run, candidate: 'index', ...outcome });
        console.log(`${label} index ${run}/${profile.runs}: ${outcome.status}, ${(outcome.elapsedMs / 1000).toFixed(2)} s`);
        if (outcome.status !== 'ok') throw new Error(`measurement stopped: ${outcome.status}`);
        if (fixtureSHA256 !== outcome.result.fixture.sha256) throw new Error('measurement fixture checksum mismatch');
      }
      await append({ type: 'point-complete', ...point, fixtureSHA256 });
    }
  }
  await append({ type: 'complete' });
  console.log(fileURLToPath(target));
} catch (error) {
  await append({ type: 'failed', message: error.message }).catch(() => {});
  process.exitCode = 1;
  console.error(error.message);
} finally { await file.close(); }
