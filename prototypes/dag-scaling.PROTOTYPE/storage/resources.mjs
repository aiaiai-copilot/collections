// Container memory charge includes its file cache; it is not PostgreSQL RSS.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TARGET } from './target.mjs';
const exec = promisify(execFile);
export async function containerResources(containerId) {
  assert.match(containerId, /^[a-f0-9]{64}$/);
  const { stdout } = await exec('/usr/local/bin/docker', ['--host', TARGET.endpoint, 'exec', containerId,
    'sh', '-c', 'cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/cpu.stat /sys/fs/cgroup/memory.events; du -sk /var/lib/postgresql/data'],
  { env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, timeout: 5000, maxBuffer: 65536 });
  const cpu = Object.fromEntries([...stdout.matchAll(/^([a-z_]+) ([0-9]+)$/gm)].map(m => [m[1], Number(m[2])]));
  const volume = stdout.match(/^([0-9]+)\s+\/var\/lib\/postgresql\/data$/m);
  assert.ok(volume && Number.isFinite(cpu.usage_usec) && Number.isFinite(cpu.oom_kill), 'unreadable container resources');
  return { at: new Date().toISOString(), memoryChargeBytes: Number(stdout.split('\n')[0]),
    cpuUsec: cpu.usage_usec, throttledUsec: cpu.throttled_usec, oomKills: cpu.oom_kill, volumeBytes: Number(volume[1]) * 1024 };
}
