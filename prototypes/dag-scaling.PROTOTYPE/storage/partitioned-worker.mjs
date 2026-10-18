// C2: one physical partition, ten disjoint oracle indexes, three windows, one merge.
import assert from 'node:assert/strict';
import { makeMeasurementFixture } from '../measurement-fixture.mjs';
import { PROFILE,hash,inventoryOf } from './protocol.mjs';
import { prepareOverlay } from './overlay.mjs';
import { mutationPlan } from './changes.mjs';
import { openStore } from './source.mjs';
import { openSpaceControl,shardOf } from './spaces.mjs';
import { runPartitionedGroup } from './partitioned.mjs';
const send=value=>new Promise((resolve,reject)=>process.send(value,e=>e?reject(e):resolve()));
const phase=name=>send({type:'phase',name,memory:process.memoryUsage()});
const corpus=x=>({items:x.items,nodes:x.nodes});
const revision=s=>s.seq?`${s.initial}/change-${s.seq}`:s.initial;
function shape(input) {
  const ordered=[...input.nodes].sort((a,b)=>a.tags.length-b.tags.length),depth=new Map();let roots=0,pairs=0;
  for(const b of ordered) {
    const parents=ordered.filter(a=>a.tags.length<b.tags.length&&a.tags.every(t=>b.tags.includes(t)));
    if(!parents.length)roots++;pairs+=parents.length;
    depth.set(b.id,1+Math.max(0,...parents.map(a=>depth.get(a.id))));
  }
  return {items:input.items.length,nodes:input.nodes.length,vocabulary:new Set(input.items.flatMap(i=>i.tags)).size,
    assignments:input.items.reduce((n,i)=>n+i.tags.length,0),roots,properSubsetPairs:pairs,maxNodeChain:Math.max(0,...depth.values()),
    control0:input.items.filter(i=>i.tags.includes('тег_0000')).length,control1:input.items.filter(i=>i.tags.includes('тег_0001')).length};
}
async function run(job) {
  assert.equal(job.kind,'C2');assert.deepEqual(job.profile,PROFILE);
  assert.equal(job.space,'data-D1-20261003-v1');assert.equal(job.inventory.state.seq,618);
  const clients=[];let control,reader,receipt,merged;
  try {
    await phase('guarded-connect');const readers=[];
    for(let i=0;i<4;i++) {
      const c=await openStore();clients.push(c);readers.push(c);
      await send({type:'completed',value:{type:'session',...c.session}});
    }
    reader=readers[0];control=await openSpaceControl();clients.push(control);
    await send({type:'completed',value:{type:'session',...control.session}});
    assert.equal(new Set(clients.map(c=>c.session.identity.pid)).size,5);
    const before=await reader.facts();assert.equal(before.otherLabSessions,4);
    const initial=await reader.inventory(job.space);assert.deepEqual(initial,job.inventory);
    const originalJournal=await reader.journal(job.space);assert.equal(hash(originalJournal),job.journalSHA256);
    await phase('one-disjoint-reference-preparation');let start=performance.now();
    const input=makeMeasurementFixture({count:job.profile.count,seed:job.profile.seed});assert.equal(hash(input),job.fixtureSHA256);
    const buckets=Array.from({length:10},()=>({items:[],nodes:[]}));
    for(const kind of ['items','nodes'])for(const row of input[kind])buckets[shardOf(row.id)][kind].push(row);
    const parts=buckets.map((rows,i)=>{
      const fixture={revision:`pilot-C2-v1-${String(i).padStart(2,'0')}`,...rows};
      return {id:`data-C2-20261003-v1-${String(i).padStart(2,'0')}`,revision:fixture.revision,fixture,inventory:inventoryOf(fixture)};
    });
    const profile={global:shape(input),local:parts.map(p=>({space:p.id,...shape(p.fixture)}))},fixtureMs=performance.now()-start;
    start=performance.now();const references=parts.map(p=>prepareOverlay(p.fixture)),plan=mutationPlan(input),referenceMs=performance.now()-start;
    await phase('atomic-partition-of-existing-rows');start=performance.now();
    receipt=await control.partition({base:job.space,expected:initial,parts});
    const partitionMs=performance.now()-start;
    await send({type:'completed',value:{type:'partition',receipt,partitionMs,fixtureMs,referenceMs,profile,memory:process.memoryUsage()}});
    const afterPartition=await reader.facts(),groups=[];
    for(let group=0;group<3;group++) {
      await phase(`group-${group}/routed-readers-writes-verify-restore`);
      const states=[];
      for(const p of parts){const state=await reader.inventory(p.id);assert.deepEqual(corpus(state),corpus(p.inventory));states.push(state);}
      start=performance.now();
      const result=await runPartitionedGroup({control,readers,parts,references,plan,
        baseRevisions:states.map(s=>revision(s.state)),schedule:{writePeriodMs:100,readPeriodMs:1000,readCount:12}});
      assert.equal(result.fullAnswerChecks,62);assert.equal(result.maxReadInFlight,4);
      for(const [i,state]of result.restoration.inventories.entries()) {
        assert.deepEqual(corpus(state),corpus(parts[i].inventory));assert.equal(state.state.seq,(group+1)*12);
      }
      const value={group,elapsedMs:performance.now()-start,...result,memory:process.memoryUsage()};groups.push(value);
      await send({type:'completed',value:{type:'group',...value}});
    }
    await phase('atomic-merge-and-final-history-audit');start=performance.now();
    merged=await control.merge(receipt);const mergeMs=performance.now()-start;
    assert.deepEqual(corpus(merged),corpus(initial));assert.equal(merged.state.seq,620);
    const journal=await reader.journal(job.space);assert.equal(journal.length,620);assert.deepEqual(journal.slice(0,618),originalJournal);
    const localJournals=[],empty=[];
    for(const p of parts) {
      const state=await reader.inventory(p.id),history=await reader.journal(p.id);
      assert.equal(state.items.count,0);assert.equal(state.nodes.count,0);assert.equal(state.state.seq,37);assert.equal(history.length,37);
      empty.push(state);localJournals.push(history);
    }
    return {space:job.space,fixtureSHA256:job.fixtureSHA256,fixtureMs,referenceMs,profile,partitionMs,mergeMs,
      before,afterPartition,after:await reader.facts(),initial,restored:merged,journal,localJournals,empty,
      groups,sessions:clients.map(c=>c.session),memory:process.memoryUsage()};
  } finally {
    // Only merge known original corpora. If restore failed, refuse rather than overwrite.
    if(receipt&&!merged) {
      await phase('failure-guarded-merge');
      try {const state=await control.merge(receipt);await send({type:'completed',value:{type:'failure-restoration',state}});}
      catch(error){await send({type:'completed',value:{type:'restoration-attention',message:error.message}});}
    }
    await phase('confirmed-close');
    const outcomes=await Promise.allSettled(clients.map(c=>c.close()));
    for(const value of outcomes)if(value.status==='rejected')throw value.reason;
  }
}
process.once('message',async job=>{
  try{await send({type:'result',value:await run(job)});}
  catch(error){process.exitCode=1;await send({type:'failure',value:{name:error.name,message:error.message}});}
  finally{process.disconnect();}
});
