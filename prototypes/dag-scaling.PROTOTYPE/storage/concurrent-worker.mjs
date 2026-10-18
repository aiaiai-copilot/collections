// Same prepared DB, adapter, oracle and supervisor as D2; four reader queues.
import assert from 'node:assert/strict';
import { makeMeasurementFixture } from '../measurement-fixture.mjs';
import { PROFILE,hash } from './protocol.mjs';
import { prepareOverlay } from './overlay.mjs';
import { mutationPlan } from './changes.mjs';
import { runConcurrentGroup } from './concurrency.mjs';
import { openStore } from './source.mjs';
const send=value=>new Promise((resolve,reject)=>process.send(value,e=>e?reject(e):resolve()));
const phase=name=>send({type:'phase',name,memory:process.memoryUsage()});
const corpus=x=>({items:x.items,nodes:x.nodes});
async function run(job) {
  assert.equal(job.kind,'C1');assert.deepEqual(job.profile,PROFILE);
  assert.equal(job.space,'data-D1-20261003-v1');assert.equal(job.inventory.state.seq,309);
  const clients=[];
  try {
    await phase('guarded-connect');const writer=await openStore();clients.push(writer);
    await send({type:'completed',value:{type:'session',...writer.session}});
    const before=await writer.facts();assert.equal(before.otherLabSessions,0);
    const initial=await writer.inventory(job.space);assert.deepEqual(initial,job.inventory);
    const readers=[];
    for(let i=0;i<4;i++) {
      const reader=await openStore();readers.push(reader);clients.push(reader);
      await send({type:'completed',value:{type:'session',...reader.session}});
    }
    assert.equal(new Set(clients.map(c=>c.session.identity.pid)).size,5);
    await phase('one-reference-preparation');const began=performance.now();
    const input=makeMeasurementFixture({count:job.profile.count,seed:job.profile.seed});assert.equal(hash(input),job.fixtureSHA256);
    const reference=prepareOverlay(input),plan=mutationPlan(input),referenceMs=performance.now()-began,groups=[];
    for(let group=0;group<3;group++) {
      await phase(`group-${group}/independent-readers-writes-verify-restore`);
      const state=await writer.inventory(job.space);assert.deepEqual(corpus(state),corpus(initial));
      const baseRevision=`${state.state.initial}/change-${state.state.seq}`,start=performance.now();
      const result=await runConcurrentGroup({writer,readers,space:job.space,reference,plan,baseRevision,
        schedule:{writePeriodMs:100,readPeriodMs:1000,readCount:12}});
      assert.deepEqual(corpus(result.restoration.inventory),corpus(initial));
      assert.equal(result.fullAnswerChecks,56);assert.equal(result.maxReadInFlight,4);
      const value={group,elapsedMs:performance.now()-start,...result,memory:process.memoryUsage()};groups.push(value);
      await send({type:'completed',value:{type:'group',...value}});
    }
    await phase('final-corpus-and-journal');
    const restored=await writer.inventory(job.space),journal=await writer.journal(job.space);
    assert.deepEqual(corpus(restored),corpus(initial));assert.equal(restored.state.seq,618);assert.equal(journal.length,618);
    return {space:job.space,fixtureSHA256:job.fixtureSHA256,referenceMs,before,after:await writer.facts(),initial,restored,journal,
      groups,sessions:clients.map(c=>c.session),memory:process.memoryUsage()};
  } finally {
    await phase('confirmed-close');
    const outcomes=await Promise.allSettled(clients.map(c=>c.close()));
    for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason;
  }
}
process.once('message',async job=>{
  try{await send({type:'result',value:await run(job)});}
  catch(error){process.exitCode=1;await send({type:'failure',value:{name:error.name,message:error.message}});}
  finally{process.disconnect();}
});
