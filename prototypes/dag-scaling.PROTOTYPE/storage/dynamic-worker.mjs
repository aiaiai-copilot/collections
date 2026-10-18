// Shared live-workload path: the existing store, corpus, GIN and observer remain.
import assert from 'node:assert/strict';
import { makeMeasurementFixture } from '../measurement-fixture.mjs';
import { PROFILE, hash } from './protocol.mjs';
import { prepareOverlay } from './overlay.mjs';
import { mutationPlan, runChangeGroup } from './changes.mjs';
import { openStore } from './source.mjs';
const send=message=>new Promise((resolve,reject)=>process.send(message,e=>e?reject(e):resolve()));
const phase=name=>send({type:'phase',name,memory:process.memoryUsage()});
const corpus=inventory=>({items:inventory.items,nodes:inventory.nodes});
async function run(job) {
  assert.equal(job.kind,'D2'); assert.deepEqual(job.profile,PROFILE);
  assert.equal(job.space,'data-D1-20261003-v1');
  let writer,reader;
  try {
    await phase('guarded-connect'); writer=await openStore();
    await send({type:'completed',value:{type:'session',...writer.session}});
    const before=await writer.facts(); assert.equal(before.otherLabSessions,0);
    const initial=await writer.inventory(job.space);
    assert.deepEqual(initial,job.inventory,'D1 corpus/revision changed before D2');
    assert.equal(initial.state.seq,0,'do not replay D2 on an already changed corpus');
    reader=await openStore(); await send({type:'completed',value:{type:'session',...reader.session}});
    await phase('one-reference-preparation'); const began=performance.now();
    const input=makeMeasurementFixture({count:job.profile.count,seed:job.profile.seed});
    assert.equal(hash(input),job.fixtureSHA256);
    const reference=prepareOverlay(input), plan=mutationPlan(input);
    const referenceMs=performance.now()-began;
    const groups=[];
    for(let group=0;group<3;group++) {
      await phase(`group-${group}/stream-read-verify-restore`);
      const state=await writer.inventory(job.space); assert.deepEqual(corpus(state),corpus(initial));
      const revision=state.state.seq===0?state.state.initial:`${state.state.initial}/change-${state.state.seq}`;
      const start=performance.now();
      const result=await runChangeGroup({writer,reader,space:job.space,reference,plan,
        schedule:{writePeriodMs:100,readPeriodMs:1000,readCount:12},baseRevision:revision});
      assert.deepEqual(corpus(result.restored),corpus(initial),'restoration changed the D1 corpus');
      const value={group,elapsedMs:performance.now()-start,...result,memory:process.memoryUsage()};
      groups.push(value); await send({type:'completed',value:{type:'group',...value}});
    }
    await phase('final-corpus-and-journal');
    const restored=await writer.inventory(job.space); assert.deepEqual(corpus(restored),corpus(initial));
    const journal=await writer.journal(job.space);
    assert.equal(restored.state.seq,309); assert.equal(journal.length,309);
    return {space:job.space,fixtureSHA256:job.fixtureSHA256,referenceMs,before,after:await writer.facts(),
      initial,restored,journal,groups,sessions:[writer.session,reader.session],memory:process.memoryUsage()};
  } finally {
    await phase('confirmed-close');
    // Try both cleanup paths even if one connection has failed.
    const settled=await Promise.allSettled([reader?.close(),writer?.close()]);
    for(const result of settled) if(result.status==='rejected') throw result.reason;
  }
}
process.once('message',async job=>{
  try {await send({type:'result',value:await run(job)});}
  catch(error) {process.exitCode=1;await send({type:'failure',value:{name:error.name,message:error.message}});}
  finally {process.disconnect();}
});
