// Tiny owned worker; exposes a deterministic OS exit/event-delivery gap to tests.
process.once('message', job => {
  const keepAlive = setInterval(() => {}, 1000);
  process.on('SIGUSR2', () => {
    clearInterval(keepAlive);
    process.exitCode = job.testExitCode ?? 0;
    process.disconnect();
  });
  process.send({ type: 'result', value: { completed: true } });
});
