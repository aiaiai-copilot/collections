// PROTOTYPE: bounded absolute schedules, one sequential reader and writer.
import assert from 'node:assert/strict';
import { canonicalTags } from '../contract.mjs';
import { readNavigation } from '../navigation.mjs';
import { measurementRequests } from '../measurement-fixture.mjs';
import { hash } from './protocol.mjs';
const until = async due => { const delay=due-performance.now(); if(delay>0) await new Promise(r=>setTimeout(r,delay)); };
export function mutationPlan(input, streamCount=100, burstItems=20) {
  assert.ok(streamCount>0 && streamCount<=100 && burstItems>0 && burstItems<=20 && input.items.length>=streamCount+burstItems);
  const pool=new Set(); for(const row of input.items) for(const tag of row.tags) pool.add(tag);
  const vocabulary=[...pool].sort(), originals=input.items.slice(0,streamCount+burstItems);
  const updated=originals.map((row,i)=>{
    const control=`тег_${i%2 ? '0001' : '0000'}`;
    const removed=row.tags.includes(control)?control:row.tags[0];
    const added=vocabulary.find(t=>!row.tags.includes(t)); assert.ok(added);
    const tags=canonicalTags([...row.tags.filter(t=>t!==removed),added]);
    assert.equal(tags.length,row.tags.length);
    return {kind:'item',action:'put',record:{...row,tags}};
  });
  const node=input.nodes[0]; assert.ok(node);
  return {stream:updated.slice(0,streamCount).map(op=>[op]),
    burst:[...updated.slice(streamCount),{kind:'node',action:'put',record:{...node,name:node.name+' [D2]'}}],
    restore:[...originals.map(record=>({kind:'item',action:'put',record})),{kind:'node',action:'put',record:node}]};
}
export async function runChangeGroup({writer,reader,space,reference,plan,schedule,baseRevision}) {
  assert.ok(Number.isInteger(schedule.readCount) && schedule.readCount>0 && schedule.readCount<=12);
  assert.ok(schedule.writePeriodMs>0 && schedule.writePeriodMs<=100 && schedule.readPeriodMs>0 && schedule.readPeriodMs<=1000);
  const available=new Map(measurementRequests().map(q=>[q.name,q.request]));
  const names=['nodes/all','free/all','nodes/ten-percent','free/ten-percent'];
  const baseline=await reader.read(space,available.get('free/ten-percent'));
  assert.deepEqual(baseline,readNavigation(reference.at(baseRevision,[]),available.get('free/ten-percent')));
  const beforeJournal=await writer.journal(space), writes=[], reads=[], captured=[];
  const start=performance.now(); let stopped=false, burstRevision, stopMs, restoration;
  const reading=async (name,dueMs,probe=false)=>{
    await until(start+dueMs); if(stopped) return;
    const began=performance.now(), cpu=process.cpuUsage();
    const answer=await reader.read(space,available.get(name));
    const end=performance.now(); assert.equal(answer.status,'ok');
    const value={name,dueMs,startMs:began-start,endMs:end-start,queueMs:Math.max(0,began-start-dueMs),
      readMs:end-began,cpuUs:process.cpuUsage(cpu),revision:answer.revision,hash:hash(answer),probe};
    reads.push(value); captured.push({value,answer});
  };
  try {
    const writeLoop=async()=>{
      for(let i=0;i<=plan.stream.length;i++) {
        const dueMs=i*schedule.writePeriodMs; await until(start+dueMs); if(stopped) return;
        const operations=i===plan.stream.length?plan.burst:plan.stream[i], began=performance.now();
        const revision=await writer.change(space,operations), end=performance.now();
        writes.push({kind:i===plan.stream.length?'burst':'stream',dueMs,startMs:began-start,endMs:end-start,
          queueMs:Math.max(0,began-start-dueMs),writeMs:end-began,revision,operations});
      }
      burstRevision=writes.at(-1).revision; stopMs=writes.at(-1).endMs;
    };
    const readLoop=async()=>{ for(let i=0;i<schedule.readCount;i++) await reading(names[i%names.length],i*schedule.readPeriodMs); };
    const outcomes=await Promise.allSettled([writeLoop().catch(e=>{stopped=true;throw e;}),readLoop().catch(e=>{stopped=true;throw e;})]);
    for(const outcome of outcomes) if(outcome.status==='rejected') throw outcome.reason;
    // A bounded final probe confirms catch-up; it is not a live UI notification.
    await reading('free/all',performance.now()-start,true);
    const journal=await writer.journal(space);
    assert.deepEqual(journal.slice(beforeJournal.length).map(e=>e.operations),[...plan.stream,plan.burst]);
    const versions=new Map([[baseRevision,[]]]); let operations=[];
    for(const write of writes) { operations=[...operations,...write.operations]; versions.set(write.revision,operations); }
    for(const {value,answer} of captured) {
      assert.ok(versions.has(value.revision),'read revision has no independently recorded commit');
      const expected=readNavigation(reference.at(value.revision,versions.get(value.revision)),available.get(value.name));
      assert.deepEqual(answer,expected,'mixed or incorrect full answer during writes');
      value.expectedHash=hash(expected);
      const atEnd=writes.filter(w=>w.endMs<=value.endMs);
      value.newerCommitsAtCompletion=Math.max(0,atEnd.length-writes.findIndex(w=>w.revision===value.revision)-1);
    }
    const caught=reads.find(r=>r.endMs>=stopMs && r.revision===burstRevision);
    assert.ok(caught,'final committed revision was not observed after writes stopped');
    return {baseRevision,baselineHash:hash(baseline),writes,reads,stopMs,
      fullAnswerChecks:captured.length+1,
      catchUp:{revision:caught.revision,afterStopMs:caught.endMs-stopMs,readMs:caught.readMs,viaProbe:caught.probe},
      get restored(){return restoration;}};
  } finally {
    // Explicit original records only; restoring data is itself journalled, never rewind seq.
    if(writes.length) for(let i=0;i<plan.restore.length;i+=100) await writer.change(space,plan.restore.slice(i,i+100));
    restoration=await writer.inventory(space);
  }
}
