// D2 uses runObservedJob and the existing PostgreSQL adapter; no reload or DDL choice.
import assert from 'node:assert/strict';
import { readFileSync,readdirSync,openSync,writeSync,closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runObservedJob } from '../million-runner.mjs';
import { readRss } from '../measurement-runner.mjs';
import { connect,stopOwnedSession } from './client.mjs';
import { containerResources } from './resources.mjs';
import { PROFILE } from './protocol.mjs';
const here=new URL('./',import.meta.url), parent=new URL('../',here);
const digest=b=>createHash('sha256').update(b).digest('hex');
const output=process.argv[2]; assert.match(output??'',/^prototypes\/dag-scaling\.PROTOTYPE\/results\/storage-D2-[a-zA-Z0-9-]+\.jsonl$/);
const oldBytes=readFileSync(new URL('../results/storage-D1-20261003-v1.jsonl',here));
assert.equal(digest(oldBytes),'bf7b0c99f7b4d5dbd161e93aa762aab1846e03271de1acd2a96f3766a3c49d9a');
const old=oldBytes.toString().trim().split('\n').map(JSON.parse);
assert.equal(old.at(-1).type,'complete');
for(const [name,expected] of Object.entries(old[0].codeSHA256))
  assert.equal(digest(readFileSync(new URL(name,parent))),expected,'D1 module changed: '+name);
const prepared=old.find(j=>j.type==='prepare').result;
const codeSHA256={};
for(const name of readdirSync(fileURLToPath(here)).filter(n=>n.endsWith('.mjs'))) codeSHA256['storage/'+name]=digest(readFileSync(new URL(name,here)));
for(const name of ['contract.mjs','navigation.mjs','index-source.mjs','scan-source.mjs','measurement-fixture.mjs','measurement-runner.mjs','million-runner.mjs'])
  codeSHA256[name]=digest(readFileSync(new URL(name,parent)));
const limits={stepMs:30000,wallMs:120000,rssBytes:768*1024**2,ownerBytes:256*1024**2,outputBytes:10*1024**2};
const fd=openSync(output,'wx'); let bytes=0;
const record=value=>{
  const line=JSON.stringify({at:new Date().toISOString(),...value})+'\n'; bytes+=Buffer.byteLength(line);
  assert.ok(bytes<=10*1024**2); writeSync(fd,line); console.log(value.type+(value.status?': '+value.status:''));
};
try {
  const client=await connect(), target=client.target; await client.close();
  record({type:'header',protocol:'postgres-live-groups-v1',profile:PROFILE,kind:'D2',target,limits,codeSHA256,
    reuse:{journalSHA256:digest(oldBytes),space:old[0].space,fixtureSHA256:prepared.fixtureSHA256,inventory:prepared.inventory},
    workload:{groups:3,writerCount:1,readerCount:1,streamTransactions:100,writePeriodMs:100,
      burstEntities:21,burstTransactions:1,scheduledReads:12,readPeriodMs:1000,catchUpProbes:1,
      data:'N/V/M/k retained; 120 item tag sets and one node name changed, then restored',
      restoration:'120 items + one node in two committed batches; seq never rewound',
      reference:'one independent prepared index + validated delta for all groups; no SQL-derived expectations',
      freshness:'scheduled complete reads, not a product notification/debounce guarantee',
      timing:'includes local psql transport; DB container CPU quota excludes host adapter/observer'} });
  const resources=[await containerResources(target.containerId)]; let last=Date.now();
  const probe=async pid=>{
    if(Date.now()-last>=1000) {
      last=Date.now(); const state=await containerResources(target.containerId); resources.push(state);
      assert.ok(state.memoryChargeBytes<=3*1024**3 && state.volumeBytes<=10*1024**3 && state.oomKills===resources[0].oomKills,'container resource limit or OOM');
    }
    return readRss(pid);
  };
  const observed=await runObservedJob({kind:'D2',profile:PROFILE,space:old[0].space,
    fixtureSHA256:prepared.fixtureSHA256,inventory:prepared.inventory},
  {workerURL:new URL('dynamic-worker.mjs',here),limits,readRss:probe});
  resources.push(await containerResources(target.containerId));
  const cleanup=[];
  if(observed.status!=='ok') {
    const sessions=observed.completed?.filter(c=>c.type==='session')??observed.result?.sessions??[];
    for(const session of sessions) cleanup.push(await stopOwnedSession(session));
    if(!sessions.length) record({type:'attention',message:'worker failed before session capture; explicit backend audit needed'});
  }
  record({type:'dynamic',...observed,resources,cleanup});
  assert.equal(observed.status,'ok','D2 stopped on first failure; no rerun or smaller replacement');
  record({type:'complete',groups:3,streamTransactions:300,burstTransactions:3,restorationTransactions:6,fullAnswerChecks:42});
} catch(error) {record({type:'failed',name:error.name,message:error.message});process.exitCode=1;}
finally {closeSync(fd);}
