// C1: same prepared physical store + shared bounded observation, not another backend.
import assert from 'node:assert/strict';
import { readFileSync,readdirSync,openSync,writeSync,closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runObservedJob } from '../million-runner.mjs';
import { readRss } from '../measurement-runner.mjs';
import { connect,stopOwnedSession } from './client.mjs';
import { containerResources } from './resources.mjs';
import { PROFILE } from './protocol.mjs';
const here=new URL('./',import.meta.url),parent=new URL('../',here),digest=b=>createHash('sha256').update(b).digest('hex');
const output=process.argv[2];assert.match(output??'',/^prototypes\/dag-scaling\.PROTOTYPE\/results\/storage-C1-[a-zA-Z0-9-]+\.jsonl$/);
const priorBytes=readFileSync(new URL('../results/storage-D2-20261003-v1.jsonl',here));
assert.equal(digest(priorBytes),'6497754e0f7344eb1960b7d144fda343f2112123d2eec3ad52a1ff75c2425fcc');
const prior=priorBytes.toString().trim().split('\n').map(JSON.parse);assert.equal(prior.at(-1).type,'complete');
for(const [file,wanted]of Object.entries(prior[0].codeSHA256))
  assert.equal(digest(readFileSync(new URL(file,parent))),wanted,'D2 module changed: '+file);
const prepared=prior.find(x=>x.type==='dynamic').result;
const codeSHA256={};
for(const file of readdirSync(fileURLToPath(here)).filter(n=>n.endsWith('.mjs')))codeSHA256['storage/'+file]=digest(readFileSync(new URL(file,here)));
for(const file of ['contract.mjs','navigation.mjs','index-source.mjs','scan-source.mjs','measurement-fixture.mjs','measurement-runner.mjs','million-runner.mjs'])
  codeSHA256[file]=digest(readFileSync(new URL(file,parent)));
const limits={stepMs:30000,wallMs:120000,rssBytes:768*1024**2,ownerBytes:256*1024**2,outputBytes:10*1024**2};
assert.deepEqual(limits,prior[0].limits);
const fd=openSync(output,'wx');let bytes=0;
const record=value=>{const line=JSON.stringify({at:new Date().toISOString(),...value})+'\n';bytes+=Buffer.byteLength(line);
  assert.ok(bytes<=10*1024**2);writeSync(fd,line);console.log(value.type+(value.status?': '+value.status:''));};
try {
  const client=await connect(),target=client.target;await client.close();
  record({type:'header',protocol:'postgres-independent-readers-v1',profile:PROFILE,kind:'C1',target,limits,codeSHA256,
    reuse:{journalSHA256:digest(priorBytes),space:prepared.space,fixtureSHA256:prepared.fixtureSHA256,inventory:prepared.restored},
    workload:{groups:3,writerCount:1,readerCount:4,streamTransactions:100,writePeriodMs:100,burstEntities:21,
      scheduledReadsPerReader:12,readPeriodMs:1000,catchUpProbesPerReader:1,readerQueues:'independent, aligned absolute arrivals; no dropping or barrier',
      data:'same restored D1/D2 corpus/GIN; no load/ANALYZE; initial seq309',restoration:'120 originals + node, two commits/window; no seq rewind',
      reference:'one prepared independent index + validated delta, not four copies',
      timing:'local psql transport; host adapter/oracle CPU outside DB quota; baseline/probes/verification/restore separated',
      scope:'mixed four arrivals/second, short windows and small working set; not users, throughput ceiling, notification or SLA'} });
  const resources=[await containerResources(target.containerId)];let last=Date.now();
  const probe=async pid=>{
    if(Date.now()-last>=1000){last=Date.now();const state=await containerResources(target.containerId);resources.push(state);
      assert.ok(state.memoryChargeBytes<=3*1024**3&&state.volumeBytes<=10*1024**3&&state.oomKills===resources[0].oomKills,'container resource limit or OOM');}
    return readRss(pid);
  };
  const observed=await runObservedJob({kind:'C1',profile:PROFILE,space:prepared.space,fixtureSHA256:prepared.fixtureSHA256,inventory:prepared.restored},
    {workerURL:new URL('concurrent-worker.mjs',here),limits,readRss:probe});
  resources.push(await containerResources(target.containerId));let cleanup=[];
  if(observed.status!=='ok') {
    const sessions=observed.completed?.filter(x=>x.type==='session')??observed.result?.sessions??[];
    const outcomes=await Promise.allSettled(sessions.map(session=>stopOwnedSession(session)));
    cleanup=outcomes.map((outcome,i)=>({pid:sessions[i].identity.pid,status:outcome.status,
      ...(outcome.status==='fulfilled'?{result:outcome.value}:{error:String(outcome.reason)})}));
    if(!sessions.length)record({type:'attention',message:'failure before session capture; explicit owned-backend audit required'});
  }
  record({type:'concurrent',...observed,resources,cleanup});
  assert.equal(observed.status,'ok','C1 stopped on first failure; no rerun, smaller corpus or raised limits');
  record({type:'complete',groups:3,streamTransactions:300,burstTransactions:3,restorationTransactions:6,fullAnswerChecks:168});
}catch(error){record({type:'failed',name:error.name,message:error.message});process.exitCode=1;}
finally{closeSync(fd);}
