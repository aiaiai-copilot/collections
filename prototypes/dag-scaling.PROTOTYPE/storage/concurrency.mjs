// PROTOTYPE: same store/requests/mutations/oracle; independent bounded reader queues.
// D2's measured modules stay byte-identical. Only multi-reader scheduling is new.
import assert from 'node:assert/strict';
import { readNavigation } from '../navigation.mjs';
import { measurementRequests } from '../measurement-fixture.mjs';
import { hash } from './protocol.mjs';
const until=async due=>{const delay=due-performance.now();if(delay>0)await new Promise(r=>setTimeout(r,delay));};
const settledOrThrow=async tasks=>{
  const settled=await Promise.allSettled(tasks);
  for(const value of settled) if(value.status==='rejected')throw value.reason;
  return settled.map(value=>value.value);
};
export async function runConcurrentGroup({writer,readers,space,reference,plan,schedule,baseRevision}) {
  assert.equal(readers.length,4); assert.equal(new Set(readers).size,4);
  assert.ok(Number.isInteger(schedule.readCount)&&schedule.readCount>0&&schedule.readCount<=12);
  assert.ok(schedule.writePeriodMs>0&&schedule.writePeriodMs<=100&&schedule.readPeriodMs>0&&schedule.readPeriodMs<=1000);
  const available=new Map(measurementRequests().map(q=>[q.name,q.request]));
  const names=['nodes/all','free/all','nodes/ten-percent','free/ten-percent'];
  const baselineStart=performance.now();
  const baselines=await settledOrThrow(readers.map(async(reader,readerId)=>{
    const answer=await reader.read(space,available.get('free/ten-percent'));
    const expected=readNavigation(reference.at(baseRevision,[]),available.get('free/ten-percent'));
    assert.deepEqual(answer,expected);return {readerId,hash:hash(answer),expectedHash:hash(expected)};
  }));
  const baselineMs=performance.now()-baselineStart;
  const beforeJournal=await writer.journal(space), writes=[],reads=[],captured=[];
  const start=performance.now();let stopped=false,stopMs,burstRevision,active=0,maxReadInFlight=0,restoration;
  const reading=async(readerId,name,dueMs,probe=false)=>{
    await until(start+dueMs);if(stopped)return;
    const began=performance.now();active++;maxReadInFlight=Math.max(maxReadInFlight,active);
    try {
      const answer=await readers[readerId].read(space,available.get(name));
      const end=performance.now();assert.equal(answer.status,'ok');
      const value={readerId,name,dueMs,startMs:began-start,endMs:end-start,
        queueMs:Math.max(0,began-start-dueMs),readMs:end-began,revision:answer.revision,hash:hash(answer),probe};
      reads.push(value);captured.push({value,answer});
    } finally {active--;}
  };
  try {
    const writeLoop=async()=>{
      for(let i=0;i<=plan.stream.length;i++) {
        const dueMs=i*schedule.writePeriodMs;await until(start+dueMs);if(stopped)return;
        const operations=i===plan.stream.length?plan.burst:plan.stream[i], began=performance.now();
        const revision=await writer.change(space,operations),end=performance.now();
        writes.push({kind:i===plan.stream.length?'burst':'stream',dueMs,startMs:began-start,endMs:end-start,
          queueMs:Math.max(0,began-start-dueMs),writeMs:end-began,revision,operations});
      }
      burstRevision=writes.at(-1).revision;stopMs=writes.at(-1).endMs;
    };
    const guarded=fn=>fn().catch(e=>{stopped=true;throw e;});
    await settledOrThrow([guarded(writeLoop),...readers.map((_,readerId)=>guarded(async()=>{
      for(let i=0;i<schedule.readCount;i++)await reading(readerId,names[i%names.length],i*schedule.readPeriodMs);
    }))]);
    // No barrier between reader queues during the schedule. Probes are outside it.
    const probeDue=performance.now()-start;
    await settledOrThrow(readers.map((_,id)=>guarded(()=>reading(id,'free/all',probeDue,true))));
    const verificationStart=performance.now(), journal=await writer.journal(space);
    assert.deepEqual(journal.slice(beforeJournal.length).map(e=>e.operations),[...plan.stream,plan.burst]);
    const versions=new Map([[baseRevision,[]]]);let operations=[];
    for(const write of writes){operations=[...operations,...write.operations];versions.set(write.revision,operations);}
    for(const {value,answer} of captured) {
      assert.ok(versions.has(value.revision),'read revision has no independently recorded commit');
      const expected=readNavigation(reference.at(value.revision,versions.get(value.revision)),available.get(value.name));
      assert.deepEqual(answer,expected,'mixed or incorrect complete concurrent answer');
      value.expectedHash=hash(expected);
      const newer=writes.filter(w=>w.endMs<=value.endMs);
      value.newerCommitsAtCompletion=Math.max(0,newer.length-writes.findIndex(w=>w.revision===value.revision)-1);
    }
    const catchUp=readers.map((_,readerId)=>{
      const caught=reads.find(r=>r.readerId===readerId&&r.endMs>=stopMs&&r.revision===burstRevision);
      assert.ok(caught,'reader did not observe final revision after writes stopped');
      return {readerId,revision:caught.revision,afterStopMs:caught.endMs-stopMs,readMs:caught.readMs,viaProbe:caught.probe};
    });
    return {baseRevision,baselines,baselineMs,writes,reads,stopMs,catchUp,maxReadInFlight,
      fullAnswerChecks:captured.length+baselines.length,verificationMs:performance.now()-verificationStart,
      get restoration(){return restoration;}};
  } finally {
    const began=performance.now();let transactions=0;
    if(writes.length)for(let i=0;i<plan.restore.length;i+=100){await writer.change(space,plan.restore.slice(i,i+100));transactions++;}
    const changeMs=performance.now()-began,inventoryStart=performance.now();
    const inventory=await writer.inventory(space);
    restoration={transactions,changeMs,inventoryMs:performance.now()-inventoryStart,inventory};
  }
}
