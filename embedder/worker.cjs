// Runs in its own process (Electron utilityProcess), so a problem here can never take the app down.
// Message in: { id, batch: number[][] }. Message out: { id, vectors } or { id, error }.

const { load, embed } = require('./embed.cjs');

const session = load(process.argv[2] ?? `${__dirname}/model`);

process.parentPort.on('message', async (e) => {
  const { id, batch } = e.data;
  try {
    process.parentPort.postMessage({ id, vectors: await embed(await session, batch) });
  } catch (err) {
    process.parentPort.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
});
