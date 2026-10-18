// PROTOTYPE: a PostgreSQL snapshot adapter; no product/API contract implied.
import assert from 'node:assert/strict';
import { connect, sqlValue, sqlText, sqlTags } from './client.mjs';
import { TARGET } from './target.mjs';
import { canonicalTags, snapshot, pageWindow } from '../contract.mjs';
import { readNavigation } from './navigation.mjs';

const orderKey = id => Buffer.from(id, 'utf16le').swap16().toString('hex');
const validSpace = id => { assert.match(id, /^(test|data)-[a-zA-Z0-9-]{1,80}$/, 'explicit synthetic space required'); return sqlText(id); };

async function initialize(client) {
  const [exists] = await client.query(`SELECT to_json(to_regclass('public.dag_lab_owner') IS NOT NULL);`);
  if (!exists) {
    const [count] = await client.query(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v','m','S','f','p');`);
    assert.equal(count, 0, 'refuse bootstrap of nonempty foreign database');
    await client.query(`BEGIN;
      CREATE TABLE dag_lab_owner (owner text PRIMARY KEY);
      INSERT INTO dag_lab_owner VALUES (${sqlText(TARGET.owner)});
      CREATE TABLE spaces (id text PRIMARY KEY, initial_revision text NOT NULL, seq bigint NOT NULL DEFAULT 0 CHECK(seq>=0));
      CREATE TABLE items (space_id text REFERENCES spaces(id), id text, order_key text COLLATE "C" NOT NULL,
        tags text[] NOT NULL, document json NOT NULL, PRIMARY KEY(space_id,id));
      CREATE INDEX items_tags ON items USING gin(tags);
      CREATE INDEX items_order ON items(space_id,order_key);
      CREATE TABLE nodes (space_id text REFERENCES spaces(id), id text, order_key text COLLATE "C" NOT NULL,
        tags text[] NOT NULL, document json NOT NULL, PRIMARY KEY(space_id,id), UNIQUE(space_id,tags));
      COMMIT;`);
  }
  const [owners] = await client.query(`SELECT json_agg(owner) FROM dag_lab_owner;`);
  assert.deepEqual(owners, [TARGET.owner], 'foreign storage ownership marker');
  await client.query(`CREATE TABLE IF NOT EXISTS changes (
    space_id text REFERENCES spaces(id), seq bigint, operations json NOT NULL, PRIMARY KEY(space_id,seq));`);
}

export async function openStore() {
  const client = await connect();
  try { await initialize(client); } catch (error) { await client.close(); throw error; }
  let active = false;
  const transaction = async (begin, run) => {
    assert.equal(active, false, 'one transaction per store connection'); active = true;
    try {
      await client.query(begin);
      const value = await run();
      await client.query('COMMIT;'); return value;
    } catch (error) {
      // ON_ERROR_STOP closes psql on a SQL failure; disconnection rolls back.
      // If it is still connected (e.g. validation failure), explicitly roll back.
      await client.query('ROLLBACK;').catch(() => {}); throw error;
    } finally { active = false; }
  };
  const sourceFor = (space, revision) => {
    let usable = true;
    const read = async (requestedRevision, sql) => {
      assert.ok(usable, 'snapshot already closed');
      if (requestedRevision !== revision) return { status: 'revision-unavailable', requestedRevision };
      const [value] = await client.query(sql);
      return { status: 'ok', revision, value };
    };
    const source = {
      revision,
      async collection(id, r = revision) {
        const answer = await read(r, `SELECT COALESCE((SELECT document FROM nodes WHERE space_id=${space} AND id=${sqlText(id)}),'null'::json);`);
        return answer.status === 'ok' && answer.value === null ? { status: 'collection-unavailable', revision, collectionId: id } : answer;
      },
      async related(input, r = revision) {
        const tags = sqlTags(canonicalTags(input));
        return read(r, `SELECT json_build_object(
          'equal',(SELECT document FROM nodes WHERE space_id=${space} AND tags=${tags}),
          'wider',COALESCE((SELECT json_agg(document ORDER BY order_key) FROM nodes WHERE space_id=${space} AND tags <@ ${tags} AND tags<>${tags}),'[]'),
          'narrower',COALESCE((SELECT json_agg(document ORDER BY order_key) FROM nodes WHERE space_id=${space} AND tags @> ${tags} AND tags<>${tags}),'[]'));`);
      },
      async count(sets, r = revision) {
        const normalized = sets.map(canonicalTags);
        return read(r, `SELECT COALESCE(json_agg(json_build_object('tags',q.tags,'count',
          (SELECT count(*) FROM items WHERE space_id=${space} AND tags @> q.tags)) ORDER BY q.ord),'[]')
          FROM (SELECT ord,ARRAY(SELECT json_array_elements_text(v)) AS tags
          FROM json_array_elements(${sqlValue(normalized)}) WITH ORDINALITY AS j(v,ord)) q;`);
      },
      async extraTags(input, r = revision) {
        const tags = canonicalTags(input);
        const answer = await read(r, `SELECT COALESCE(json_agg(json_build_object('tag',tag,'count',n)),'[]') FROM
          (SELECT t.tag,count(*) AS n FROM items CROSS JOIN LATERAL unnest(tags) AS t(tag)
          WHERE space_id=${space} AND tags @> ${sqlTags(tags)} AND NOT (t.tag=ANY(${sqlTags(tags)})) GROUP BY t.tag) q;`);
        if (answer.status === 'ok') answer.value.sort((a,b)=>a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
        return answer;
      },
      async page(input, options, r = revision) {
        const { offset, limit } = pageWindow(options), tags = sqlTags(canonicalTags(input));
        return read(r, `SELECT json_build_object('total',(SELECT count(*) FROM items WHERE space_id=${space} AND tags @> ${tags}),
          'offset',${offset},'limit',${limit},'items',COALESCE((SELECT json_agg(document ORDER BY order_key) FROM
            (SELECT document,order_key FROM items WHERE space_id=${space} AND tags @> ${tags} ORDER BY order_key LIMIT ${limit} OFFSET ${offset}) p),'[]'));`);
      },
    };
    return { source, invalidate: () => { usable = false; } };
  };
  const withSnapshot = async (id, run) => {
    const space = validSpace(id);
    return transaction('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', async () => {
      const [state] = await client.query(`SELECT (SELECT json_build_object('initial',initial_revision,'seq',seq) FROM spaces WHERE id=${space});`);
      assert.ok(state, 'unknown synthetic space');
      const revision = state.seq === 0 ? state.initial : `${state.initial}/change-${state.seq}`;
      const held = sourceFor(space, revision);
      try { return await run(held.source); } finally { held.invalidate(); }
    });
  };
  return {
    async load(id, input, { batchRows = 1000, onBatch = async () => {} } = {}) {
      assert.ok(Number.isSafeInteger(batchRows) && batchRows > 0 && batchRows <= 1000, 'bounded load batch required');
      const space = validSpace(id), data = snapshot(input);
      return transaction('BEGIN;', async () => {
        await client.query(`INSERT INTO spaces(id,initial_revision) VALUES (${space},${sqlText(data.revision)});`);
        for (const table of ['items', 'nodes']) {
          for (let offset = 0; offset < data[table].length; offset += batchRows) {
            const rows = data[table].slice(offset, offset + batchRows).map(document => ({ document, key: orderKey(document.id) }));
            await client.query(`INSERT INTO ${table}(space_id,id,order_key,tags,document)
              SELECT ${space},v->'document'->>'id',v->>'key',ARRAY(SELECT json_array_elements_text(v->'document'->'tags')),v->'document'
              FROM json_array_elements(${sqlValue(rows)}) AS j(v);`);
            await onBatch({ table, loaded: Math.min(offset + batchRows, data[table].length), total: data[table].length });
          }
        }
      });
    },
    async change(id, operations) {
      const space = validSpace(id);
      assert.ok(Array.isArray(operations) && operations.length > 0 && operations.length <= 100, 'bounded change batch required');
      const changes = operations.map(op => {
        assert.ok(['item','node'].includes(op.kind) && ['put','delete'].includes(op.action), 'invalid change');
        if (op.action === 'delete') {
          assert.ok(typeof op.id === 'string' && op.id.length, 'change id required'); return op;
        }
        const data = snapshot({ revision: 'validate', items: op.kind === 'item' ? [op.record] : [], nodes: op.kind === 'node' ? [op.record] : [] });
        return { ...op, record: data[op.kind === 'item' ? 'items' : 'nodes'][0] };
      });
      return transaction('BEGIN;', async () => {
        // First row lock serializes writers only within this space, not globally.
        const [state] = await client.query(`UPDATE spaces SET seq=seq+1 WHERE id=${space}
          RETURNING json_build_object('initial',initial_revision,'seq',seq);`);
        assert.ok(state, 'unknown synthetic space');
        for (const op of changes) {
          const table = op.kind === 'item' ? 'items' : 'nodes';
          if (op.action === 'delete') await client.query(`DELETE FROM ${table} WHERE space_id=${space} AND id=${sqlText(op.id)};`);
          else {
            const r = op.record;
            await client.query(`INSERT INTO ${table}(space_id,id,order_key,tags,document)
              VALUES (${space},${sqlText(r.id)},${sqlText(orderKey(r.id))},${sqlTags(r.tags)},${sqlValue(r)})
              ON CONFLICT(space_id,id) DO UPDATE SET order_key=EXCLUDED.order_key,tags=EXCLUDED.tags,document=EXCLUDED.document;`);
          }
        }
        await client.query(`INSERT INTO changes(space_id,seq,operations) VALUES (${space},${state.seq},${sqlValue(changes)});`);
        return `${state.initial}/change-${state.seq}`;
      });
    },
    async journal(id) {
      const space = validSpace(id);
      return transaction('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', async () => {
        const [entries] = await client.query(`SELECT COALESCE(json_agg(json_build_object('seq',seq,'operations',operations) ORDER BY seq),'[]') FROM changes WHERE space_id=${space};`);
        return entries;
      });
    },
    async inventory(id) {
      const space = validSpace(id);
      return transaction('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', async () => {
        const [value] = await client.query(`SELECT json_build_object(
          'state',(SELECT json_build_object('initial',initial_revision,'seq',seq) FROM spaces WHERE id=${space}),
          'items',(SELECT json_build_object('count',count(*),'digest',md5(COALESCE(string_agg(md5(document::text),'' ORDER BY order_key),''))) FROM items WHERE space_id=${space}),
          'nodes',(SELECT json_build_object('count',count(*),'digest',md5(COALESCE(string_agg(md5(document::text),'' ORDER BY order_key),''))) FROM nodes WHERE space_id=${space}));`);
        return value;
      });
    },
    async analyze() {
      assert.equal(active, false);
      await client.query('ANALYZE items; ANALYZE nodes;');
    },
    async facts() {
      const [value] = await client.query(`SELECT json_build_object('version',current_setting('server_version'),
        'databaseBytes',pg_database_size(current_database()),'relationsBytes',
        (SELECT COALESCE(sum(pg_total_relation_size(c.oid)),0) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
        'ginBytes',pg_total_relation_size('items_tags'), 'fsync',current_setting('fsync'),
        'synchronousCommit',current_setting('synchronous_commit'),'fuzzyLimit',current_setting('gin_fuzzy_search_limit'),
        'statementTimeout',current_setting('statement_timeout'),'transactionTimeout',current_setting('transaction_timeout'),
        'otherLabSessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name='dag-storage-v1' AND pid<>pg_backend_pid()));`);
      return value;
    },
    session: { identity: client.identity, target: client.target },
    abort: () => client.abort(),
    withSnapshot,
    read: (id, request) => withSnapshot(id, source => readNavigation(source, request)),
    close: () => client.close(),
  };
}
