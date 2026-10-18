// Correctness only, on the already guarded isolated DB; not a load profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runChangeGroup, mutationPlan } from './changes.mjs';
import { prepareOverlay } from './overlay.mjs';
import { openStore } from './source.mjs';
import { makeMeasurementFixture } from '../measurement-fixture.mjs';
import { inventoryOf } from './protocol.mjs';
test('scheduled changes, burst and stop preserve full answers and restore data without rewinding revision', {timeout:30000}, async()=>{
  const writer=await openStore(), reader=await openStore();
  try {
    const input=makeMeasurementFixture({count:100}), space='test-'+randomUUID();
    await writer.load(space,input);
    const reference=prepareOverlay(input), plan=mutationPlan(input,4,2);
    const result=await runChangeGroup({writer,reader,space,reference,plan,
      schedule:{writePeriodMs:10,readPeriodMs:15,readCount:8},baseRevision:input.revision});
    assert.equal(result.writes.length,5);
    assert.equal(result.reads.length,9); // Eight scheduled reads and one catch-up probe.
    assert.equal(result.fullAnswerChecks,10); // Plus the pre-stream baseline.
    assert.equal(result.catchUp.revision,result.writes.at(-1).revision);
    assert.deepEqual(result.restored.items,inventoryOf(input).items);
    assert.deepEqual(result.restored.nodes,inventoryOf(input).nodes);
    assert.equal(result.restored.state.seq,6);
    assert.deepEqual((await writer.journal(space)).map(e=>e.operations),
      [...plan.stream,plan.burst,plan.restore]);
    assert.ok(result.reads.every(r=>r.hash===r.expectedHash));
  } finally {await reader.close();await writer.close();}
});
