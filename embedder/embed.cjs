// Runs the small meaning model (all-MiniLM-L6-v2, Apache-2.0) on token ids and returns one
// 384-number "meaning vector" per text. Texts about similar things get similar vectors.
// No network: the model and runtime are local files.

const path = require('node:path');
const ort = require('onnxruntime-node');

async function load(modelDir) {
  return ort.InferenceSession.create(path.join(modelDir, 'model.onnx'), { intraOpNumThreads: 1, graphOptimizationLevel: 'all' });
}

/** batch: token id lists (with [CLS] and [SEP]). Returns normalised mean-pooled vectors. */
async function embed(session, batch) {
  const n = batch.length;
  const len = Math.max(...batch.map((b) => b.length));
  const ids = new BigInt64Array(n * len);
  const mask = new BigInt64Array(n * len);
  batch.forEach((b, i) => b.forEach((id, j) => {
    ids[i * len + j] = BigInt(id);
    mask[i * len + j] = 1n;
  }));
  const shape = [n, len];
  const all = {
    input_ids: new ort.Tensor('int64', ids, shape),
    attention_mask: new ort.Tensor('int64', mask, shape),
    token_type_ids: new ort.Tensor('int64', new BigInt64Array(n * len), shape),
  };
  const feeds = Object.fromEntries(session.inputNames.map((k) => [k, all[k]]));
  const out = await session.run(feeds);
  const hidden = out[session.outputNames[0]];
  const dim = hidden.dims[2];
  const data = hidden.data;
  const vectors = [];
  for (let i = 0; i < n; i++) {
    const v = new Array(dim).fill(0);
    const count = batch[i].length;
    for (let j = 0; j < count; j++) for (let d = 0; d < dim; d++) v[d] += data[(i * len + j) * dim + d];
    let norm = 0;
    for (let d = 0; d < dim; d++) norm += (v[d] /= count) ** 2;
    norm = Math.sqrt(norm) || 1;
    vectors.push(v.map((x) => Math.round((x / norm) * 1e5) / 1e5));
  }
  return vectors;
}

module.exports = { load, embed };
