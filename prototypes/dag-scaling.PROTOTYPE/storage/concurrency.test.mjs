// Correctness only: independent real readers, on the guarded synthetic DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runConcurrentGroup } from './concurrency.mjs';
import { mutationPlan } from './changes.mjs';
import { prepareOverlay } from './overlay.mjs';
import { openStore } from './source.mjs';
import { makeMeasurementFixture } from '../measurement-fixture.mjs';
import { inventoryOf } from './protocol.mjs';
test('four independent readers preserve complete revision-specific answers during writes and restoration', {timeout:30000}, async()=>{
  const clients=[];
  try {
    const writer=await openStore(); clients.push(writer);
    const readers=[];
    for(let i=0;i<4;i++) {const reader=await openStore();readers.push(reader);clients.push(reader);}
    const input=makeMeasurementFixture({count:100}), space='test-'+randomUUID();
    await writer.load(space,input);
    const result=await runConcurrentGroup({writer,readers,space,reference:prepareOverlay(input),plan:mutationPlan(input,4,2),
      schedule:{writePeriodMs:10,readPeriodMs:15,readCount:8},baseRevision:input.revision});
    assert.equal(result.writes.length,5);
    assert.equal(result.fullAnswerChecks,40); // Four × (baseline + eight reads + probe).
    assert.equal(result.reads.length,36); assert.equal(result.baselines.length,4);
    for(let id=0;id<4;id++) {
      assert.equal(result.reads.filter(r=>r.readerId===id).length,9);
      assert.equal(result.catchUp[id].revision,result.writes.at(-1).revision);
    }
    assert.equal(result.maxReadInFlight,4);
    assert.ok(result.reads.every(r=>r.hash===r.expectedHash));
    assert.deepEqual(result.restoration.inventory.items,inventoryOf(input).items);
    assert.deepEqual(result.restoration.inventory.nodes,inventoryOf(input).nodes);
    assert.equal(result.restoration.inventory.state.seq,6);
    assert.deepEqual((await writer.journal(space)).map(e=>e.operations),[...mutationPlan(input,4,2).stream,mutationPlan(input,4,2).burst,mutationPlan(input,4,2).restore]);
  } finally {
    const outcomes=await Promise.allSettled(clients.map(c=>c.close()));
    for(const outcome of outcomes) if(outcome.status==='rejected') throw outcome.reason;
  }
});
