// PROTOTYPE: deliberately one explicit local target, never an inherited DSN.
import assert from 'node:assert/strict';

export const TARGET = Object.freeze({
  endpoint: 'unix:///Users/alexanderlapygin/.orbstack/run/docker.sock',
  name: 'collections-dag-storage-v1', volume: 'collections-dag-storage-v1-data',
  image: 'sha256:10a2036535720770e9c54a2d1ad1410a9fcb5c85bb280e2230f2e74315499a64',
  label: 'org.collections.experiment', owner: 'dag-storage-v1',
  database: 'dag_lab', user: 'dag_lab',
});

export function verifyTarget({ endpoint, container: c, volume: v }) {
  const fail = 'refusing non-isolated storage target';
  assert.equal(endpoint, TARGET.endpoint, fail);
  assert.match(c?.Id ?? '', /^[0-9a-f]{64}$/, fail);
  assert.equal(c.Name, '/' + TARGET.name, fail);
  assert.equal(c.Image, TARGET.image, fail);
  assert.equal(c.Config?.Labels?.[TARGET.label], TARGET.owner, fail);
  assert.equal(c.State?.Running, true, fail);
  const h = c.HostConfig;
  assert.equal(h?.NetworkMode, 'none', fail);
  assert.deepEqual(h.PortBindings ?? {}, {}, fail);
  assert.deepEqual(c.NetworkSettings?.Ports ?? {}, {}, fail);
  assert.equal(h.Privileged, false, fail);
  assert.equal(h.PidMode, '', fail);
  assert.equal(h.IpcMode, 'private', fail);
  assert.equal(h.Memory, 3 * 1024 ** 3, fail);
  assert.equal(h.NanoCpus, 2e9, fail);
  assert.equal(h.PidsLimit, 128, fail);
  assert.equal(c.Mounts?.length, 1, fail);
  const m = c.Mounts[0];
  assert.equal(m.Type, 'volume', fail);
  assert.equal(m.Name, TARGET.volume, fail);
  assert.equal(m.Destination, '/var/lib/postgresql/data', fail);
  assert.equal(m.RW, true, fail);
  assert.equal(v?.Name, TARGET.volume, fail);
  assert.equal(v.Driver, 'local', fail);
  assert.ok(v.Options === null || Object.keys(v.Options ?? {}).length === 0, fail);
  assert.equal(v.Labels?.[TARGET.label], TARGET.owner, fail);
  return Object.freeze({ containerId: c.Id, database: TARGET.database, user: TARGET.user });
}
