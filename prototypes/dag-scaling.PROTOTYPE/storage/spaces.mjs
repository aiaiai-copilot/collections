// Research control only: atomic relocation in the existing marked DB. No product API.
import assert from 'node:assert/strict';
import { connect,sqlText,sqlValue,sqlTags } from './client.mjs';
import { TARGET } from './target.mjs';
import { snapshot } from '../contract.mjs';
const space=id=>{assert.match(id,/^(test|data)-[a-zA-Z0-9-]{1,80}$/);return sqlText(id);};
const corpus=x=>({items:x.items,nodes:x.nodes});
const revision=state=>state.seq?`${state.initial}/change-${state.seq}`:state.initial;
const orderKey=id=>Buffer.from(id,'utf16le').swap16().toString('hex');
export const shardOf=id=>{assert.match(id,/^(item|node)-[0-9]+$/);return Number(id.split('-').at(-1))%10;};

export async function openSpaceControl() {
  const client=await connect();let active=false;
  try {
    const [owners]=await client.query('SELECT json_agg(owner) FROM dag_lab_owner;');
    assert.deepEqual(owners,[TARGET.owner],'control refuses foreign database');
  } catch(error){await client.close();throw error;}
  const tx=async run=>{
    assert.equal(active,false);active=true;
    try {await client.query('BEGIN;');const result=await run();await client.query('COMMIT;');return result;}
    catch(error){await client.query('ROLLBACK;').catch(()=>{});throw error;}
    finally{active=false;}
  };
  const inventory=async id=>{
    const s=space(id);
    const [value]=await client.query(`SELECT json_build_object(
      'state',(SELECT json_build_object('initial',initial_revision,'seq',seq) FROM spaces WHERE id=${s}),
      'items',(SELECT json_build_object('count',count(*),'digest',md5(COALESCE(string_agg(md5(document::text),'' ORDER BY order_key),''))) FROM items WHERE space_id=${s}),
      'nodes',(SELECT json_build_object('count',count(*),'digest',md5(COALESCE(string_agg(md5(document::text),'' ORDER BY order_key),''))) FROM nodes WHERE space_id=${s}));`);
    return value;
  };
  const lock=async ids=>{
    const [rows]=await client.query(`SELECT COALESCE(json_agg(id),'[]') FROM
      (SELECT id FROM spaces WHERE id=ANY(ARRAY[${ids.map(space)}]::text[]) ORDER BY id FOR UPDATE) q;`);
    assert.deepEqual(rows,[...ids].sort(),'unknown space or duplicate control ID');
  };
  const advance=async(id,operations)=>{
    const [state]=await client.query(`UPDATE spaces SET seq=seq+1 WHERE id=${space(id)}
      RETURNING json_build_object('initial',initial_revision,'seq',seq);`);
    assert.ok(state);
    await client.query(`INSERT INTO changes(space_id,seq,operations) VALUES (${space(id)},${state.seq},${sqlValue(operations)});`);
    return revision(state);
  };
  return {
    async partition({base,expected,parts}) {
      assert.equal(parts.length,10);assert.equal(new Set([base,...parts.map(p=>p.id)]).size,11);
      const targets=parts.map(({id,revision:initial,inventory:want})=>{
        space(id);assert.equal(want.state.initial,initial);assert.equal(want.state.seq,0);
        return {id,revision:initial,inventory:want};
      });
      for(const kind of ['items','nodes'])assert.equal(targets.reduce((n,p)=>n+p.inventory[kind].count,0),expected[kind].count);
      return tx(async()=>{
        await lock([base]);assert.deepEqual(await inventory(base),expected,'unexpected base corpus/revision');
        const [occupied]=await client.query(`SELECT count(*) FROM spaces WHERE id=ANY(ARRAY[${targets.map(p=>space(p.id))}]::text[]);`);
        assert.equal(occupied,0,'refuse reuse of destination spaces');
        for(const p of targets)await client.query(`INSERT INTO spaces(id,initial_revision) VALUES (${space(p.id)},${sqlText(p.revision)});`);
        for(const kind of ['items','nodes']) {
          const prefix=kind==='items'?'item':'node';
          const [bad]=await client.query(`SELECT count(*) FROM ${kind} WHERE space_id=${space(base)} AND id !~ '^${prefix}-[0-9]+$';`);
          assert.equal(bad,0,'relocation requires the fixed synthetic ID scheme');
          await client.query(`UPDATE ${kind} SET space_id=(ARRAY[${targets.map(p=>space(p.id))}]::text[])[(substring(id from '[0-9]+$')::bigint%10)::int+1] WHERE space_id=${space(base)};`);
        }
        for(const p of targets)assert.deepEqual(await inventory(p.id),p.inventory,'partition must preserve all original documents');
        await advance(base,[{kind:'lab-transfer',action:'partition',spaces:targets.map(p=>p.id),rule:'numeric-id-modulo-10'}]);
        return {base,original:expected,parts:targets,baseAfter:await inventory(base)};
      });
    },
    async merge(receipt) {
      const {base,original,parts,baseAfter}=receipt;
      assert.equal(parts.length,10);assert.equal(new Set([base,...parts.map(p=>p.id)]).size,11);
      return tx(async()=>{
        await lock([base,...parts.map(p=>p.id)]);
        assert.deepEqual(await inventory(base),baseAfter,'base changed since partition; refuse overwrite');
        for(const p of parts) {
          const actual=await inventory(p.id);
          assert.equal(actual.state.initial,p.revision);
          assert.deepEqual(corpus(actual),corpus(p.inventory),'merge requires verified originals, not changed/foreign rows');
        }
        for(const kind of ['items','nodes'])await client.query(`UPDATE ${kind} SET space_id=${space(base)} WHERE space_id=ANY(ARRAY[${parts.map(p=>space(p.id))}]::text[]);`);
        assert.deepEqual(corpus(await inventory(base)),corpus(original),'merge corpus differs');
        for(const p of parts)await advance(p.id,[{kind:'lab-transfer',action:'merge',destination:base}]);
        await advance(base,[{kind:'lab-transfer',action:'merge',spaces:parts.map(p=>p.id)}]);
        return inventory(base);
      });
    },
    async changeAcross(entries) {
      assert.ok(entries.length>0&&entries.length<=10);assert.equal(new Set(entries.map(e=>e.space)).size,entries.length);
      const normalized=entries.map(e=>{
        space(e.space);assert.ok(e.operations.length>0&&e.operations.length<=100);
        return {...e,operations:e.operations.map(op=>{
          assert.ok(['item','node'].includes(op.kind)&&['put','delete'].includes(op.action));
          if(op.action==='delete'){assert.ok(typeof op.id==='string'&&op.id.length);return op;}
          const data=snapshot({revision:'validate',items:op.kind==='item'?[op.record]:[],nodes:op.kind==='node'?[op.record]:[]});
          return {...op,record:data[op.kind==='item'?'items':'nodes'][0]};
        })};
      }).sort((a,b)=>a.space<b.space?-1:1);
      assert.ok(normalized.reduce((n,e)=>n+e.operations.length,0)<=100,'bounded aggregate batch');
      return tx(async()=>{
        await lock(normalized.map(e=>e.space));const revisions={};
        for(const e of normalized) {
          for(const op of e.operations) {
            const table=op.kind==='item'?'items':'nodes';
            if(op.action==='delete')await client.query(`DELETE FROM ${table} WHERE space_id=${space(e.space)} AND id=${sqlText(op.id)};`);
            else {const r=op.record;await client.query(`INSERT INTO ${table}(space_id,id,order_key,tags,document)
              VALUES (${space(e.space)},${sqlText(r.id)},${sqlText(orderKey(r.id))},${sqlTags(r.tags)},${sqlValue(r)})
              ON CONFLICT(space_id,id) DO UPDATE SET order_key=EXCLUDED.order_key,tags=EXCLUDED.tags,document=EXCLUDED.document;`);}
          }
          revisions[e.space]=await advance(e.space,e.operations);
        }
        return revisions;
      });
    },
    session:{identity:client.identity,target:client.target},
    abort:()=>client.abort(),close:()=>client.close(),
  };
}
