// Runs one shipped copy of the meaning model on token ids from stdin and prints the vectors as JSON.
// Used by tests/chips.test.ts, inside Electron's own Node so each chip runs what it ships with.
// Usage: ELECTRON_RUN_AS_NODE=1 <Electron> embed-dump.cjs <embedder folder>

const path = require('node:path');

const dir = path.resolve(process.argv[2]);
const { load, embed } = require(path.join(dir, 'embed.cjs'));

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', async () => {
  const session = await load(path.join(dir, 'model'));
  const vectors = [];
  for (const tokens of JSON.parse(input)) vectors.push(...(await embed(session, [tokens])));
  // No process.exit(): ending that way makes this runtime abort while it shuts down.
  process.stdout.write(JSON.stringify({ arch: process.arch, vectors }));
});
