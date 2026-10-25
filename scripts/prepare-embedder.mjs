// Gets the on-device meaning model ready to ship: installs the ONNX runtime for this Mac only,
// strips everything it doesn't need at run time, and checks the model file.
// Run by `npm run embedder` (also before start and make).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', 'embedder');
const modules = path.join(dir, 'node_modules');
const MODEL = path.join(dir, 'model', 'model.onnx');
const MODEL_URL = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx';
const MODEL_SHA256 = 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1';

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

if (!existsSync(MODEL)) {
  console.log('Downloading the meaning model (23 MB)…');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  writeFileSync(MODEL, Buffer.from(await res.arrayBuffer()));
}
if (sha(MODEL) !== MODEL_SHA256) throw new Error('The meaning model file does not match the expected checksum.');

const ort = path.join(modules, 'onnxruntime-node');
if (!existsSync(path.join(ort, 'package.json'))) {
  // --ignore-scripts: the runtime's install script only downloads GPU extras for Linux.
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev'], { cwd: dir, stdio: 'inherit' });
}

// Only onnxruntime-node and onnxruntime-common are used at run time; the rest is for its installer.
for (const name of readdirSync(modules)) {
  if (!['onnxruntime-node', 'onnxruntime-common', '.package-lock.json'].includes(name)) rmSync(path.join(modules, name), { recursive: true, force: true });
}
for (const sub of ['script', 'lib', 'README.md']) rmSync(path.join(ort, sub), { recursive: true, force: true });
const bins = path.join(ort, 'bin', 'napi-v6');
for (const platform of readdirSync(bins)) {
  for (const arch of readdirSync(path.join(bins, platform))) {
    if (platform !== process.platform || arch !== process.arch) rmSync(path.join(bins, platform, arch), { recursive: true, force: true });
  }
  if (readdirSync(path.join(bins, platform)).length === 0) rmSync(path.join(bins, platform), { recursive: true, force: true });
}
// The binding loads libonnxruntime.1.dylib; the versioned copy is an identical duplicate.
for (const f of readdirSync(path.join(bins, process.platform, process.arch))) {
  if (/^libonnxruntime\.\d+\.\d+\.\d+\.dylib$/.test(f)) rmSync(path.join(bins, process.platform, process.arch, f));
}
console.log('Meaning model ready.');
