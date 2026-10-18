// C2 scheduling only; old source/observer/oracle modules remain byte-identical.
import assert from 'node:assert/strict';
import { readNavigation } from '../navigation.mjs';
import { measurementRequests } from '../measurement-fixture.mjs';
import { shardOf } from './spaces.mjs';
import { hash } from './protocol.mjs';
const until=async due=>{const delay=due-performance.now();if(delay>0)await new Promise(r=>setTimeout(r,delay));};
const all=async tasks=>{const values=await Promise.allSettled(tasks);for(const v of values)if(v.status==='rejected')throw v.reason;return values.map(v=>v.value);};
export function routeOperations(operations,parts) {
  const grouped=parts.map(()=>[]);
  for(const op of operations)grouped[shardOf(op.action==='put'?op.record.id:op.id)].push(op);
  return parts.flatMap((p,i)=>grouped[i].length?[{space:p.id,operations:grouped[i]}]:[]);
}
export async function runPartitionedGroup({control,readers,parts,references,plan,baseRevisions,schedule}) {
  assert.equal(readers.length,4);assert.equal(new Set(readers).size,4);
  assert.equal(parts.length,10);assert.equal(references.length,10);assert.equal(baseRevisions.length,10);
  assert.ok(Number.isInteger(schedule.readCount)&&schedule.readCount>0&&schedule.readCount<=12);
  assert.ok(schedule.writePeriodMs>0&&schedule.writePeriodMs<=100&&schedule.readPeriodMs>0&&schedule.readPeriodMs<=1000);
  const available=new Map(measurementRequests().map(q=>[q.name,q.request]));
  const names=['nodes/all','free/all','nodes/ten-percent','free/ten-percent'];
  const beganBaseline=performance.now();
  const baselines=await all(readers.map(async(reader,readerId)=>{
    const answer=await reader.read(parts[readerId].id,available.get('free/ten-percent'));
    const expected=readNavigation(references[readerId].at(baseRevisions[readerId],[]),available.get('free/ten-percent'));
    assert.deepEqual(answer,expected);return {readerId,spaceIndex:readerId,hash:hash(answer),expectedHash:hash(expected)};
  }));
  const baselineMs=performance.now()-beganBaseline;
  const beforeJournal=[];for(const p of parts)beforeJournal.push(await readers[0].journal(p.id));
  const writes=[],reads=[],captured=[],start=performance.now();
  let stopped=false,active=0,maxReadInFlight=0,stopMs,finalRevisions,restoration,probeMs;
  const reading=async(readerId,spaceIndex,name,dueMs,probe=false)=>{
    await until(start+dueMs);if(stopped)return;
    const began=performance.now();active++;maxReadInFlight=Math.max(maxReadInFlight,active);
    try {
      const answer=await readers[readerId].read(parts[spaceIndex].id,available.get(name));
      const end=performance.now();assert.equal(answer.status,'ok');
      const value={readerId,spaceIndex,name,dueMs,startMs:began-start,endMs:end-start,
        queueMs:Math.max(0,began-start-dueMs),readMs:end-began,revision:answer.revision,hash:hash(answer),probe};
      reads.push(value);captured.push({value,answer});
    } finally {active--;}
  };
  const guarded=fn=>fn().catch(e=>{stopped=true;throw e;});
  try {
    const writeLoop=async()=>{
      for(let i=0;i<=plan.stream.length;i++) {
        const dueMs=i*schedule.writePeriodMs;await until(start+dueMs);if(stopped)return;
        const operations=i===plan.stream.length?plan.burst:plan.stream[i],entries=routeOperations(operations,parts),began=performance.now();
        const revisions=await control.changeAcross(entries),end=performance.now();
        writes.push({kind:i===plan.stream.length?'burst':'stream',dueMs,startMs:began-start,endMs:end-start,
          queueMs:Math.max(0,began-start-dueMs),writeMs:end-began,revisions,entries});
      }
      finalRevisions=writes.at(-1).revisions;stopMs=writes.at(-1).endMs;
    };
    await all([guarded(writeLoop),...readers.map((_,r)=>guarded(async()=>{
      for(let i=0;i<schedule.readCount;i++)await reading(r,(4*i+r)%10,names[i%4],i*schedule.readPeriodMs);
    }))]);
    const probeStart=performance.now(),probeDue=probeStart-start;
    await all(readers.map((_,r)=>guarded(async()=>{for(let s=r;s<10;s+=4)await reading(r,s,'free/all',probeDue,true);})));
    probeMs=performance.now()-probeStart;
    const verifyStart=performance.now(),versions=[],localWrites=[];
    for(const [i,p]of parts.entries()) {
      const routed=writes.filter(w=>Object.hasOwn(w.revisions,p.id));localWrites.push(routed);
      const journal=await readers[0].journal(p.id);
      assert.deepEqual(journal.slice(beforeJournal[i].length).map(e=>e.operations),routed.map(w=>w.entries.find(e=>e.space===p.id).operations));
      let ops=[];const states=new Map([[baseRevisions[i],[]]]);
      for(const w of routed){ops=[...ops,...w.entries.find(e=>e.space===p.id).operations];states.set(w.revisions[p.id],ops);}
      versions.push(states);
    }
    for(const {value,answer}of captured) {
      const i=value.spaceIndex,p=parts[i];assert.ok(versions[i].has(value.revision),'unrecorded local revision');
      const expected=readNavigation(references[i].at(value.revision,versions[i].get(value.revision)),available.get(value.name));
      assert.deepEqual(answer,expected,'mixed or incorrect full local answer');value.expectedHash=hash(expected);
      const newer=localWrites[i].filter(w=>w.endMs<=value.endMs);
      value.newerLocalCommitsAtCompletion=Math.max(0,newer.length-localWrites[i].findIndex(w=>w.revisions[p.id]===value.revision)-1);
    }
    const catchUp=parts.map((p,spaceIndex)=>{
      const caught=reads.find(r=>r.spaceIndex===spaceIndex&&r.endMs>=stopMs&&r.revision===finalRevisions[p.id]);
      assert.ok(caught,'space did not observe final revision');
      return {spaceIndex,readerId:caught.readerId,revision:caught.revision,afterStopMs:caught.endMs-stopMs,readMs:caught.readMs,viaProbe:caught.probe};
    });
    return {baseRevisions,baselines,baselineMs,writes,reads,stopMs,catchUp,maxReadInFlight,probeMs,
      fullAnswerChecks:captured.length+baselines.length,verificationMs:performance.now()-verifyStart,
      get restoration(){return restoration;}};
  } finally {
    const restoreStart=performance.now();let transactions=0;
    if(writes.length)for(const entry of routeOperations(plan.restore,parts)){await control.changeAcross([entry]);transactions++;}
    const changeMs=performance.now()-restoreStart,inventoryStart=performance.now(),inventories=[];
    for(const p of parts)inventories.push(await readers[0].inventory(p.id));
    restoration={transactions,changeMs,inventoryMs:performance.now()-inventoryStart,inventories};
  }
}
