// Diagnostic only: own tiny child finishing near a 250 ms RSS poll boundary.
process.once('message', job => {
  process.send({ type: 'phase', name: 'wait', memory: process.memoryUsage() });
  setTimeout(() => {
    process.send({ type: 'phase', name: 'done', memory: process.memoryUsage() });
    process.send({ type: 'result', value: { completed: true } }, () => process.disconnect());
  }, job.delay);
});
