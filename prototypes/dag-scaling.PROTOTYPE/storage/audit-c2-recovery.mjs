// Recovery/audit only, not a second C2 measurement or automatic resume.
import assert from 'node:assert/strict';
import { readFileSync,openSync,writeSync,closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeMeasurementFixture } from '../measurement-fixture.mjs';
import { mutationPlan } from './changes.mjs';
import { hash,inventoryOf } from './protocol.mjs';
import { openStore } from './source.mjs';
import { openSpaceControl } from './spaces.mjs';
import { containerResources } from './resources.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const here=new URL('./',import.meta.url),root=new URL('../results/',here);
const runBytes=readFileSync(new URL('storage-C2-20261003-v1.jsonl',root));
const rows=runBytes.toString().trim().split('\n').map(JSON.parse),run=rows.find(r=>r.type==='partitioned');
assert.equal(run.status,'step-timeout');assert.equal(run.phase,'group-0/routed-readers-writes-verify-restore');
assert.equal(run.completed.filter(c=>c.type==='group').length,0);
assert.equal(run.cleanup.length,5);assert.ok(run.cleanup.every(c=>c.status==='fulfilled'&&c.result.backendGone));
const receipt=run.completed.find(c=>c.type==='partition').receipt;
const prior=readFileSync(new URL('storage-C1-20261003-v1.jsonl',root)).toString().trim().split('\n').map(JSON.parse).find(r=>r.type==='concurrent').result;
const input=makeMeasurementFixture({count:100000,seed:23});assert.equal(hash(input),prior.fixtureSHA256);
const plan=mutationPlan(input),parts=receipt.parts;
const shard=id=>Number(id.split('-').at(-1))%10;
const local=parts.map((p,i)=>({revision:p.revision,items:input.items.filter(r=>shard(r.id)===i),nodes:input.nodes.filter(r=>shard(r.id)===i)}));
const expectedJournals=parts.map((_,i)=>[...plan.stream,plan.burst].map(batch=>batch.filter(op=>shard(op.record.id)===i)).filter(b=>b.length));
const fd=openSync(new URL('storage-C2-20261003-v1.recovery.jsonl',root),'wx');
const record=value=>{writeSync(fd,JSON.stringify({at:new Date().toISOString(),...value})+'\n');console.log(value.type);};
const clients=[];
try {
  const reader=await openStore();clients.push(reader);const facts=await reader.facts();assert.equal(facts.otherLabSessions,0);
  const control=await openSpaceControl();clients.push(control);
  const originalJournal=await reader.journal(receipt.base),base=await reader.inventory(receipt.base);
  assert.deepEqual(base,receipt.baseAfter);assert.deepEqual(originalJournal.slice(0,618),prior.journal);assert.equal(originalJournal.length,619);
  const before=[],journals=[];
  for(const [i,p]of parts.entries()) {
    const actual=await reader.inventory(p.id),journal=await reader.journal(p.id);
    assert.equal(actual.state.seq,11);assert.equal(journal.length,11);assert.deepEqual(journal.map(e=>e.operations),expectedJournals[i]);
    assert.deepEqual(journal.map(e=>e.seq),Array.from({length:11},(_,j)=>j+1));
    const updated={revision:p.revision,items:new Map(local[i].items.map(r=>[r.id,r])),nodes:new Map(local[i].nodes.map(r=>[r.id,r]))};
    for(const batch of expectedJournals[i])for(const op of batch)updated[op.kind==='item'?'items':'nodes'].set(op.record.id,op.record);
    const expected=inventoryOf({revision:p.revision,items:[...updated.items.values()],nodes:[...updated.nodes.values()]});expected.state.seq=11;
    assert.deepEqual(actual,expected,'refuse recovery of unaccounted current data');
    before.push(actual);journals.push(journal);
  }
  record({type:'verified-before-recovery',runSHA256:digest(runBytes),codeSHA256:digest(readFileSync(new URL(import.meta.url))),
    target:reader.session.target,facts,resources:await containerResources(reader.session.target.containerId),base,before,journals});
  const restoreStart=performance.now(),restorations=[];
  for(const [i,p]of parts.entries()) {
    const operations=plan.restore.filter(op=>shard(op.record.id)===i);
    const revisions=await control.changeAcross([{space:p.id,operations}]);
    const state=await reader.inventory(p.id),expected=inventoryOf(local[i]);expected.state.seq=12;assert.deepEqual(state,expected);
    const journal=await reader.journal(p.id);assert.deepEqual(journal.at(-1),{seq:12,operations});
    assert.deepEqual(journal.slice(0,11),journals[i]);restorations.push({space:p.id,revisions,state});
    record({type:'local-restoration',space:p.id,revisions,state});
  }
  const restorationMs=performance.now()-restoreStart,mergeStart=performance.now(),restored=await control.merge(receipt),mergeMs=performance.now()-mergeStart;
  const expectedBase=structuredClone(receipt.original);expectedBase.state.seq=620;assert.deepEqual(restored,expectedBase);
  const journal=await reader.journal(receipt.base);assert.equal(journal.length,620);assert.deepEqual(journal.slice(0,619),originalJournal);
  const empty=[],history=[];
  for(const [i,p]of parts.entries()) {
    const state=await reader.inventory(p.id),entries=await reader.journal(p.id);
    assert.equal(state.items.count,0);assert.equal(state.nodes.count,0);assert.equal(state.state.seq,13);assert.equal(entries.length,13);
    assert.deepEqual(entries.slice(0,11),journals[i]);assert.deepEqual(entries[11].operations,plan.restore.filter(op=>shard(op.record.id)===i));
    assert.deepEqual(entries[12],{seq:13,operations:[{kind:'lab-transfer',action:'merge',destination:receipt.base}]});
    empty.push(state);history.push(entries);
  }
  record({type:'verified-after-recovery',restorationMs,mergeMs,restored,mainJournalSHA256:hash(journal),localJournalSHA256:history.map(hash),
    empty,history,facts:await reader.facts(),resources:await containerResources(reader.session.target.containerId)});
}catch(error){record({type:'failed',name:error.name,message:error.message});process.exitCode=1;}
finally {
  const settled=await Promise.allSettled(clients.map(c=>c.close()));
  for(const value of settled)if(value.status==='rejected'){record({type:'close-failed',message:String(value.reason)});process.exitCode=1;}
  record({type:'closed',status:settled.every(v=>v.status==='fulfilled')?'ok':'attention'});closeSync(fd);
}
