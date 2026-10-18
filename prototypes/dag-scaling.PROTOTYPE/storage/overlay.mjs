// PROTOTYPE oracle: one immutable index + a small delta, no SQL or index rebuild.
import { snapshot, canonicalTags, pageWindow } from '../contract.mjs';
import { createIndexSource } from '../index-source.mjs';
const matches = (row, tags) => !!row && tags.every(tag => row.tags.includes(tag));
const ordered = rows => rows.sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function prepareOverlay(input) {
  const base = snapshot(input), index = createIndexSource(base);
  const items = new Map(base.items.map(row=>[row.id,row])), baseNodes = new Map(base.nodes.map(row=>[row.id,row]));
  const counts = new Map(), extras = new Map();
  const baseCount = tags => {
    const key = JSON.stringify(tags);
    if (!counts.has(key)) counts.set(key, index.count([tags]).value[0].count);
    return counts.get(key);
  };
  return { at(revision, operations) {
    const changes = new Map(), nodes = new Map(baseNodes);
    for (const op of operations) {
      const map = op.kind === 'item' ? changes : nodes;
      const id = op.action === 'put' ? op.record.id : op.id;
      const value = op.action === 'delete' ? null : { ...op.record, tags: canonicalTags(op.record.tags) };
      if (op.kind === 'node' && value === null) map.delete(id); else map.set(id, value);
    }
    const delta = [...changes].map(([id, after])=>[items.get(id) ?? null, after]);
    const catalog = ordered([...nodes.values()]);
    const read = (r, fn) => r !== revision ? { status: 'revision-unavailable', requestedRevision: r }
      : { status: 'ok', revision, value: structuredClone(fn()) };
    const count = tags => baseCount(tags) + delta.reduce((n,[before,after])=>n + Number(matches(after,tags)) - Number(matches(before,tags)),0);
    return {
      revision,
      collection(id, r=revision) {
        const answer = read(r,()=>nodes.get(id) ?? null);
        return answer.status === 'ok' && answer.value === null ? { status: 'collection-unavailable', revision, collectionId: id } : answer;
      },
      related(input,r=revision) {
        const tags = canonicalTags(input);
        return read(r,()=>({ equal: catalog.find(n=>n.tags.length===tags.length && matches(n,tags)) ?? null,
          wider: catalog.filter(n=>n.tags.length<tags.length && n.tags.every(t=>tags.includes(t))),
          narrower: catalog.filter(n=>n.tags.length>tags.length && matches(n,tags)) }));
      },
      count(sets,r=revision) { return read(r,()=>sets.map(input=>{ const tags=canonicalTags(input); return { tags,count:count(tags) }; })); },
      extraTags(input,r=revision) {
        const tags = canonicalTags(input), key = JSON.stringify(tags);
        return read(r,()=>{
          if (!extras.has(key)) extras.set(key,index.extraTags(tags).value);
          const values = new Map(extras.get(key).map(t=>[t.tag,t.count]));
          for (const [before,after] of delta) for (const [row,sign] of [[before,-1],[after,1]])
            if (matches(row,tags)) for (const tag of row.tags) if (!tags.includes(tag)) values.set(tag,(values.get(tag)??0)+sign);
          return [...values].filter(([,n])=>n>0).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([tag,count])=>({tag,count}));
        });
      },
      page(input,options,r=revision) {
        const tags=canonicalTags(input), {offset,limit}=pageWindow(options);
        return read(r,()=>{
          const prefix=index.page(tags,{offset:0,limit:offset+limit+changes.size}).value.items.filter(row=>!changes.has(row.id));
          const candidates=ordered([...prefix,...[...changes.values()].filter(row=>matches(row,tags))]);
          return {total:count(tags),offset,limit,items:candidates.slice(offset,offset+limit)};
        });
      },
    };
  } };
}
