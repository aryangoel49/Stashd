// Gets the on-device meaning model ready to ship: installs the ONNX runtime for one chip only
// (this Mac's, or the one named: prepare-embedder.mjs x64), strips everything it doesn't need at run
// time, and checks the model file. Run by `npm run embedder`, before `npm start`, and by the build for
// the chip it's building (the prePackage hook in forge.config.mts).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', 'embedder');
const modules = path.join(dir, 'node_modules');
const MODEL = path.join(dir, 'model', 'model.onnx');
const MODEL_URL = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx';
const MODEL_SHA256 = 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1';

const targetArch = process.argv[2] ?? process.arch;
if (!['arm64', 'x64'].includes(targetArch)) throw new Error(`No meaning model runtime for ${targetArch}.`);

const INTEL_RUNTIME = '1.23.2';
const INTEL_SHA256 = {
  'libonnxruntime.1.23.2.dylib': '0576e3f8dd16833c291fddd037444672ae20cdc6797db00928cc7527541c5a4a',
  'onnxruntime_binding.node': 'b9f2fad0f4c81fc79a1e990e47efbffe6275db72e6d8cabdb620e70e2bdff720',
};

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

if (!existsSync(MODEL)) {
  console.log('Downloading the meaning model (23 MB)…');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  writeFileSync(MODEL, Buffer.from(await res.arrayBuffer()));
}
if (sha(MODEL) !== MODEL_SHA256) throw new Error('The meaning model file does not match the expected checksum.');

const ort = path.join(modules, 'onnxruntime-node');
const bins = path.join(ort, 'bin', 'napi-v6');
const installedVersion = () => {
  try {
    return JSON.parse(readFileSync(path.join(ort, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
};
// Apple silicon uses the version in embedder/package.json. Intel stays on the last version with Intel files.
const version = targetArch === 'x64' ? INTEL_RUNTIME : JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies['onnxruntime-node'];
// What's there may have been stripped for the other chip, or be another version: start again.
if (installedVersion() !== version || !existsSync(path.join(bins, process.platform, targetArch))) {
  rmSync(modules, { recursive: true, force: true });
  const intel = targetArch === 'x64' ? ['--no-save', '--no-package-lock', `onnxruntime-node@${INTEL_RUNTIME}`] : [];
  // --ignore-scripts: the runtime's install script only downloads GPU extras for Linux.
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', ...intel], { cwd: dir, stdio: 'inherit' });
}

// Only onnxruntime-node and onnxruntime-common are used at run time; the rest is for its installer.
for (const name of readdirSync(modules)) {
  if (!['onnxruntime-node', 'onnxruntime-common', '.package-lock.json'].includes(name)) rmSync(path.join(modules, name), { recursive: true, force: true });
}
for (const sub of ['script', 'lib', 'README.md']) rmSync(path.join(ort, sub), { recursive: true, force: true });
for (const platform of readdirSync(bins)) {
  for (const arch of readdirSync(path.join(bins, platform))) {
    if (platform !== process.platform || arch !== targetArch) rmSync(path.join(bins, platform, arch), { recursive: true, force: true });
  }
  if (readdirSync(path.join(bins, platform)).length === 0) rmSync(path.join(bins, platform), { recursive: true, force: true });
}
// Some versions ship libonnxruntime.1.dylib, which the binding loads, plus a versioned duplicate. Others
// ship only the versioned one, which the binding then needs.
const shipped = path.join(bins, process.platform, targetArch);
const files = readdirSync(shipped);
if (files.includes('libonnxruntime.1.dylib')) {
  for (const f of files) {
    if (/^libonnxruntime\.\d+\.\d+\.\d+\.dylib$/.test(f)) rmSync(path.join(shipped, f));
  }
}
// The Intel version has no lockfile to check it, so its files are checked here.
if (targetArch === 'x64') {
  for (const [f, want] of Object.entries(INTEL_SHA256)) {
    if (sha(path.join(shipped, f)) !== want) throw new Error(`The Intel runtime's ${f} does not match the expected checksum.`);
  }
}
console.log(`Meaning model ready (${targetArch}).`);
