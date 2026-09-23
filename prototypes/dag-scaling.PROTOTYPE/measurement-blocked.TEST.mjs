// Harmless local watchdog fixture. No files, network, descendants or memory growth.
process.once('message', () => {
  process.send({ type: 'phase', name: 'blocked' }, () => { while (true) { /* synchronous work */ } });
});
