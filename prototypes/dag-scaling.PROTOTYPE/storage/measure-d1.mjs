// PROTOTYPE: exclusive JSONL journal; one prepared DB corpus for all D1 groups.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runObservedJob } from '../million-runner.mjs';
import { readRss } from '../measurement-runner.mjs';
import { connect, stopOwnedSession } from './client.mjs';
import { containerResources } from './resources.mjs';
import { PROFILE, QUERY_NAMES, validateJob } from './protocol.mjs';
const here = new URL('./', import.meta.url), parent = new URL('../', here);
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
const output = process.argv[2], space = process.argv[3];
assert.match(output ?? '', /^prototypes\/dag-scaling\.PROTOTYPE\/results\/storage-D1-[a-zA-Z0-9-]+\.jsonl$/);
validateJob({ kind: 'prepare', profile: PROFILE, space });
const limits = { stepMs: 30000, wallMs: 120000, rssBytes: 768 * 1024 ** 2, ownerBytes: 256 * 1024 ** 2, outputBytes: 10 * 1024 ** 2 };
const referenceBytes = readFileSync(new URL('../results/growth-10k-100k-2026-09-23.jsonl', here));
const reference = referenceBytes.toString().trim().split('\n').map(JSON.parse), header = reference[0];
// Reuse independent answers only with unchanged representation/assembler/oracle.
for (const name of ['contract.mjs','navigation.mjs','scan-source.mjs'])
  assert.equal(digest(readFileSync(new URL(name, parent))), header.codeSHA256[name], 'frozen oracle code changed');
const verified = reference.filter(r => r.type === 'verification' && r.count === 100000 && r.seed === 23);
assert.ok(verified.length && verified.every(r => r.status === 'ok'));
const fixtureSHA256 = verified[0].result.fixture.sha256, expected = {};
for (const r of verified) {
  assert.equal(r.result.fixture.sha256, fixtureSHA256);
  Object.assign(expected, r.result.answers);
}
assert.ok(QUERY_NAMES.every(name => /^[a-f0-9]{64}$/.test(expected[name])));
const codeSHA256 = {};
for (const name of readdirSync(fileURLToPath(here)).filter(n => n.endsWith('.mjs')))
  codeSHA256['storage/' + name] = digest(readFileSync(new URL(name, here)));
for (const name of ['contract.mjs','navigation.mjs','scan-source.mjs','measurement-fixture.mjs','measurement-runner.mjs','million-runner.mjs'])
  codeSHA256[name] = digest(readFileSync(new URL(name, parent)));
const fd = openSync(output, 'wx'); let bytes = 0;
function record(value) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'; bytes += Buffer.byteLength(line);
  assert.ok(bytes <= 10 * 1024 ** 2, 'journal output limit'); writeSync(fd, line);
  console.log(value.type + (value.status ? ': ' + value.status : ''));
}
let target;
async function job(input) {
  validateJob(input);
  const resources = [await containerResources(target.containerId)];
  let last = Date.now();
  const probe = async pid => {
    if (Date.now() - last >= 1000) {
      last = Date.now();
      const state = await containerResources(target.containerId); resources.push(state);
      assert.ok(state.memoryChargeBytes <= 3 * 1024 ** 3 && state.volumeBytes <= 10 * 1024 ** 3 &&
        state.oomKills === resources[0].oomKills, 'container resource limit or OOM');
    }
    return readRss(pid);
  };
  const result = await runObservedJob(input, { workerURL: new URL('worker.mjs', here), limits, readRss: probe });
  resources.push(await containerResources(target.containerId));
  let cleanup;
  if (result.status !== 'ok') {
    const session = result.completed?.find(c => c.type === 'session') ?? result.result?.session;
    if (session) cleanup = await stopOwnedSession(session);
    else throw new Error('worker failed before session capture; backend state requires audit');
  }
  record({ type: input.kind, ...result, resources, ...(cleanup ? { cleanup } : {}) });
  assert.equal(result.status, 'ok', 'D1 stopped on first failure; no smaller replacement');
  return result.result;
}
try {
  const client = await connect(); target = client.target; await client.close();
  record({ type: 'header', protocol: 'postgres-prepared-groups-v1', profile: PROFILE, space, target, limits, codeSHA256,
    oracleReference: { path: '../results/growth-10k-100k-2026-09-23.jsonl', sha256: digest(referenceBytes), fixtureSHA256, expected },
    policy: { preparation: 'one atomic load and one ANALYZE; same DB corpus/GIN retained for all groups',
      first: 'fresh adapter connection only; DB/OS caches not cleared', samples: '3 connections × 4 queries × (first + warmup + 5 measured)',
      timing: 'complete snapshot read including local psql transport and commit; not pure SQL latency',
      memory: 'adapter RSS via OS polls; container cgroup charge includes cache; not DB RSS',
      admission: 'same 100k/k10 fixture already verified; observed old oracle RSS <768MiB; no new intermediate profile',
      cpu: 'DB container 2CPU; host adapter/control/observer outside that quota' } });
  const prepared = await job({ kind: 'prepare', profile: PROFILE, space, fixtureSHA256 });
  const preparationId = space + '/' + fixtureSHA256;
  for (let group = 0; group < 3; group++) {
    record({ type: 'group-start', group, preparationId });
    await job({ kind: 'measure', profile: PROFILE, space, fixtureSHA256, inventory: prepared.inventory,
      expected, samples: 5, preparationId });
  }
  record({ type: 'complete', groups: 3, measuredSamples: 60, fullAnswerChecks: 84, preparationId });
} catch (error) {
  record({ type: 'failed', name: error.name, message: error.message }); process.exitCode = 1;
} finally { closeSync(fd); }
