import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTarget, TARGET } from './target.mjs';

test('storage target rejects foreign or externally reachable containers before connecting', () => {
  const owned = {
    endpoint: TARGET.endpoint,
    container: { Id: 'a'.repeat(64), Name: '/' + TARGET.name, Image: TARGET.image,
      Config: { Labels: { [TARGET.label]: TARGET.owner } },
      HostConfig: { NetworkMode: 'none', PortBindings: {}, Privileged: false,
        PidMode: '', IpcMode: 'private', Memory: 3 * 1024 ** 3, NanoCpus: 2e9, PidsLimit: 128 },
      State: { Running: true }, NetworkSettings: { Ports: {} },
      Mounts: [{ Type: 'volume', Name: TARGET.volume, Destination: '/var/lib/postgresql/data', RW: true }],
    },
    volume: { Name: TARGET.volume, Driver: 'local', Options: null,
      Labels: { [TARGET.label]: TARGET.owner } },
  };
  assert.equal(verifyTarget(owned).containerId, 'a'.repeat(64));
  for (const change of [
    x => { x.endpoint = 'tcp://example.com:2375'; },
    x => { x.container.Image = 'unknown-image'; },
    x => { x.container.Name = '/production'; },
    x => { x.container.Config.Labels = {}; },
    x => { x.container.HostConfig.NetworkMode = 'bridge'; },
    x => { x.container.HostConfig.PortBindings = { '5432/tcp': [{ HostPort: '5432' }] }; },
    x => { x.container.Mounts[0].Type = 'bind'; },
    x => { x.container.Mounts[0].Name = 'foreign-data'; },
    x => { x.container.Mounts.push({ Type: 'bind', Source: '/Users' }); },
    x => { x.volume.Options = { type: 'nfs', device: 'remote' }; },
    x => { x.container.HostConfig.Privileged = true; },
    x => { x.container.HostConfig.Memory = 0; },
    x => { x.container.State.Running = false; },
  ]) {
    const changed = structuredClone(owned); change(changed);
    assert.throws(() => verifyTarget(changed), /isolated storage target/);
  }
});
