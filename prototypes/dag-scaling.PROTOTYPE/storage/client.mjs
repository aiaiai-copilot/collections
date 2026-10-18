// PROTOTYPE: persistent local psql, one bounded command at a time. No DSN input.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { TARGET, verifyTarget } from './target.mjs';

const docker = '/usr/local/bin/docker';
const environment = { PATH: '/usr/local/bin:/usr/bin:/bin' };
const prefix = ['--host', TARGET.endpoint];
const exec = promisify(execFile);
export const sqlValue = value => `convert_from(decode('${Buffer.from(JSON.stringify(value)).toString('base64')}','base64'),'UTF8')::json`;
export const sqlText = value => `(${sqlValue(value)} #>> '{}')`;
export const sqlTags = value => `ARRAY(SELECT json_array_elements_text(${sqlValue(value)}))`;

export async function connect() {
  const inspect = args => JSON.parse(execFileSync(docker, [...prefix, ...args],
    { env: environment, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 ** 2 }))[0];
  const target = verifyTarget({ endpoint: TARGET.endpoint,
    container: inspect(['inspect', TARGET.name]), volume: inspect(['volume', 'inspect', TARGET.volume]) });
  const child = spawn(docker, [...prefix, 'exec', '-i', target.containerId,
    'env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'PGAPPNAME=dag-storage-v1',
    'psql', '-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off',
    '-h', '/var/run/postgresql', '-U', target.user, '-d', target.database],
  { env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', errors = '', pending = null, dead = false, identity, aborting;
  const exited = new Promise(resolve => child.once('close', (code, signal) => {
    dead = true;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`psql closed (${code}/${signal}): ${errors.slice(-1500)}`)); pending = null; }
    resolve({ code, signal });
  }));
  const failed = error => {
    dead = true;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); pending = null; }
  };
  child.on('error', failed);
  child.stdin.on('error', failed);
  const control = async sql => {
    // Recheck the same ID before the cancellation connection, never another DSN.
    const current = verifyTarget({ endpoint: TARGET.endpoint,
      container: inspect(['inspect', target.containerId]), volume: inspect(['volume', 'inspect', TARGET.volume]) });
    if (current.containerId !== target.containerId) throw new Error('changed cancellation target');
    const { stdout } = await exec(docker, [...prefix, 'exec', target.containerId,
      'env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'PGAPPNAME=dag-storage-v1-control',
      'psql', '-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1', '-h', '/var/run/postgresql',
      '-U', target.user, '-d', target.database, '-c', sql],
    { env: environment, encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
    return JSON.parse(stdout.trim());
  };
  const predicate = () => {
    if (!identity) throw new Error('backend termination unconfirmed: identity unavailable');
    return `pid=${identity.pid} AND datname=${sqlText(identity.db)} AND usename=${sqlText(identity.user)}
      AND application_name='dag-storage-v1' AND backend_start::text=${sqlText(identity.started)}`;
  };
  const gone = async () => {
    if (await control(`SELECT to_json(NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${predicate()}));`) !== true)
      throw new Error('backend termination unconfirmed: owned session remains');
    return { backendGone: true, pid: identity.pid };
  };
  const abort = () => aborting ??= (async () => {
    dead = true; child.kill('SIGKILL');
    // PID + backend_start + role/database/app protect against terminating a reused PID.
    await control(`SELECT to_json(COALESCE((SELECT pg_terminate_backend(pid,2000)
      FROM pg_stat_activity WHERE ${predicate()}),true));`);
    return gone();
  })();
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stderr.on('data', s => { errors = (errors + s).slice(-8192); });
  child.stdout.on('data', s => {
    buffer += s;
    if (buffer.length > 10 * 1024 ** 2) {
      failed(new Error('psql output limit')); abort().catch(() => {}); return;
    }
    let i;
    while ((i = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
      if (!pending || !line) continue;
      if (line === pending.marker) {
        const p = pending; pending = null; clearTimeout(p.timer);
        try { p.resolve(p.lines.map(line => JSON.parse(line))); } catch (error) { p.reject(error); }
      } else {
        pending.bytes += Buffer.byteLength(line);
        if (pending.bytes > 10 * 1024 ** 2) { failed(new Error('psql output limit')); abort().catch(() => {}); return; }
        pending.lines.push(line);
      }
    }
  });
  const query = sql => {
    if (dead) return Promise.reject(new Error('closed storage connection'));
    if (pending) return Promise.reject(new Error('overlapping commands on one storage connection'));
    if (Buffer.byteLength(sql) > 4 * 1024 ** 2) return Promise.reject(new Error('psql input limit'));
    return new Promise((resolve, reject) => {
      const marker = 'dag_end_' + randomUUID().replaceAll('-', '');
      const timer = setTimeout(() => {
        failed(new Error('storage client deadline')); abort().catch(() => {});
      }, 35000);
      pending = { marker, lines: [], bytes: 0, resolve, reject, timer };
      child.stdin.write(sql + '\n\\echo ' + marker + '\n');
    });
  };
  const close = async () => {
    if (!dead) child.stdin.end('\\q\n');
    let timer;
    try {
      const end = await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve(null), 5000); })]);
      if (aborting) return await aborting;
      if (!end || end.signal) return await abort();
      if (identity) return await gone();
    } finally { clearTimeout(timer); }
  };
  try {
    [identity] = await query(`SELECT json_build_object('db',current_database(),'user',current_user,'pid',pg_backend_pid(),
      'started',(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()));`);
    if (identity.db !== TARGET.database || identity.user !== TARGET.user) throw new Error('foreign storage database');
    return { query, close, abort, identity, target };
  } catch (error) { await close(); throw error; }
}

// Supervisor cleanup after a killed worker. Never target a session by PID alone.
export async function stopOwnedSession({ identity, target }) {
  assert.ok(Number.isSafeInteger(identity?.pid) && identity.pid > 0);
  assert.equal(identity.db, TARGET.database); assert.equal(identity.user, TARGET.user);
  assert.ok(typeof identity.started === 'string' && identity.started.length > 10);
  const client = await connect();
  try {
    assert.deepEqual(client.target, target, 'changed cleanup target');
    assert.notEqual(client.identity.pid, identity.pid);
    const [owners] = await client.query('SELECT json_agg(owner) FROM dag_lab_owner;');
    assert.deepEqual(owners, [TARGET.owner]);
    const where = `pid=${identity.pid} AND datname=${sqlText(identity.db)} AND usename=${sqlText(identity.user)}
      AND application_name='dag-storage-v1' AND backend_start::text=${sqlText(identity.started)}`;
    await client.query(`SELECT to_json(COALESCE((SELECT pg_terminate_backend(pid,2000) FROM pg_stat_activity WHERE ${where}),true));`);
    const [gone] = await client.query(`SELECT pg_stat_clear_snapshot(); SELECT to_json(NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${where}));`);
    assert.equal(gone, true, 'backend termination unconfirmed');
    return { backendGone: true, pid: identity.pid };
  } finally { await client.close(); }
}
