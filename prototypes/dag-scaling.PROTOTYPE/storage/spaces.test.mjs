// Small correctness checks only, using the existing guarded source interface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openStore } from './source.mjs';
import { openSpaceControl } from './spaces.mjs';
import { inventoryOf } from './protocol.mjs';
import { createScanSource } from '../scan-source.mjs';
import { readNavigation as expectedRead } from '../navigation.mjs';
import { readNavigation as storedRead } from './navigation.mjs';
import { runPartitionedGroup } from './partitioned.mjs';
import { makeMeasurementFixture } from '../measurement-fixture.mjs';
import { mutationPlan } from './changes.mjs';
import { prepareOverlay } from './overlay.mjs';

test('partition and merge preserve complete local answers, held snapshots and monotonic history', {timeout:30000}, async()=>{
  const clients=[];
  try {
    const reader=await openStore();clients.push(reader);
    const control=await openSpaceControl();clients.push(control);
    const base='test-'+randomUUID();
    const input={revision:'known-base',items:Array.from({length:20},(_,i)=>({id:'item-'+i,tags:['shared','tag-'+i%10]})),
      nodes:Array.from({length:10},(_,i)=>({id:'node-'+i,name:'Known '+i,tags:['tag-'+i]}))};
    await reader.load(base,input);
    const parts=Array.from({length:10},(_,i)=>{
      const fixture={revision:'known-'+i,items:[input.items[i],input.items[i+10]],nodes:[input.nodes[i]]};
      return {id:base+'-'+i,revision:fixture.revision,fixture,inventory:inventoryOf(fixture)};
    });
    const request={tags:[],mode:'free',offset:0,limit:20};
    let receipt;
    await reader.withSnapshot(base,async source=>{
      assert.equal((await source.count([[]])).value[0].count,20);
      receipt=await control.partition({base,expected:inventoryOf(input),parts});
      assert.deepEqual(await storedRead(source,request),expectedRead(createScanSource(input),request));
    });
    for(const part of parts) {
      assert.equal((await reader.inventory(part.id)).items.count,2);
      assert.deepEqual(await reader.read(part.id,request),expectedRead(createScanSource(part.fixture),request));
    }
    assert.equal((await reader.inventory(base)).items.count,0);
    await control.merge(receipt);
    const restored=await reader.inventory(base);
    assert.deepEqual(restored.items,inventoryOf(input).items);
    assert.deepEqual(restored.nodes,inventoryOf(input).nodes);
    assert.equal(restored.state.seq,2);
    assert.equal((await reader.journal(base)).length,2);
    assert.equal((await reader.read(base,request)).revision,'known-base/change-2');
    for(const part of parts) {
      assert.equal((await reader.inventory(part.id)).items.count,0);
      assert.equal((await reader.inventory(part.id)).state.seq,1);
    }
  } finally {
    const settled=await Promise.allSettled(clients.map(c=>c.close()));
    for(const value of settled)if(value.status==='rejected')throw value.reason;
  }
});

test('routed concurrent readers see complete local revisions and every space is restored', {timeout:30000}, async()=>{
  const clients=[];
  try {
    const readers=[];
    for(let i=0;i<4;i++){const reader=await openStore();readers.push(reader);clients.push(reader);}
    const control=await openSpaceControl();clients.push(control);
    const base='test-'+randomUUID(),input=makeMeasurementFixture({count:100});
    await readers[0].load(base,input);
    const parts=Array.from({length:10},(_,i)=>{
      const fixture={revision:'routed-'+i,items:input.items.filter((_,j)=>j%10===i),nodes:input.nodes.filter((_,j)=>j%10===i)};
      return {id:base+'-'+i,revision:fixture.revision,inventory:inventoryOf(fixture),fixture};
    });
    const receipt=await control.partition({base,expected:inventoryOf(input),parts});
    const result=await runPartitionedGroup({control,readers,parts,
      references:parts.map(p=>prepareOverlay(p.fixture)),plan:mutationPlan(input,20,10),
      baseRevisions:parts.map(p=>p.revision),schedule:{writePeriodMs:5,readPeriodMs:15,readCount:8}});
    assert.equal(result.writes.length,21);
    assert.equal(Object.keys(result.writes.at(-1).revisions).length,10);
    assert.equal(result.fullAnswerChecks,46);
    assert.equal(result.catchUp.length,10);
    assert.equal(result.maxReadInFlight,4);
    assert.ok(result.reads.every(r=>r.hash===r.expectedHash));
    for(const [i,value]of result.restoration.inventories.entries()) {
      assert.deepEqual(value.items,parts[i].inventory.items);
      assert.deepEqual(value.nodes,parts[i].inventory.nodes);
      assert.equal(value.state.seq,4);
      assert.equal((await readers[0].journal(parts[i].id)).length,4);
    }
    const restored=await control.merge(receipt);
    assert.deepEqual(restored.items,inventoryOf(input).items);
    assert.equal(restored.state.seq,2);
  } finally {
    const settled=await Promise.allSettled(clients.map(c=>c.close()));
    for(const value of settled)if(value.status==='rejected')throw value.reason;
  }
});

test('a failing multi-space batch leaves every document, revision and journal unchanged', {timeout:30000}, async()=>{
  const clients=[];
  try {
    const reader=await openStore();clients.push(reader);
    const control=await openSpaceControl();clients.push(control);
    const base='test-'+randomUUID(),a=base+'-0',b=base+'-1';
    const first={revision:'first',items:[{id:'item-0',tags:['before']}],nodes:[]};
    const second={revision:'second',items:[],nodes:[{id:'node-1',name:'A',tags:['a']},{id:'node-2',name:'B',tags:['b']}]};
    await reader.load(a,first);await reader.load(b,second);
    await assert.rejects(control.changeAcross([
      {space:a,operations:[{kind:'item',action:'put',record:{id:'item-0',tags:['after']}}]},
      {space:b,operations:[{kind:'node',action:'put',record:{id:'node-2',name:'B',tags:['a']}}]},
    ]),/duplicate key/);
    assert.deepEqual(await reader.inventory(a),inventoryOf(first));
    assert.deepEqual(await reader.inventory(b),inventoryOf(second));
    assert.deepEqual(await reader.journal(a),[]);assert.deepEqual(await reader.journal(b),[]);
  } finally {
    const settled=await Promise.allSettled(clients.map(c=>c.close()));
    for(const value of settled)if(value.status==='rejected')throw value.reason;
  }
});
