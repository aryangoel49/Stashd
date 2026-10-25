# On-device meaning model

Lets Where Was I? tell that "Watch Real Madrid at Barcelona" belongs with "Soccer Streams" even though
they share no words. Runs entirely on the Mac: free, offline, private.

- `model/model.onnx`: all-MiniLM-L6-v2 (sentence-transformers, Apache-2.0), 8-bit ONNX export from
  `Xenova/all-MiniLM-L6-v2`. Downloaded and checksum-checked by `npm run embedder` (not in git).
- `model/vocab.txt`: its word-piece vocabulary (tokenizer is `src/main/meaning/tokenizer.ts`).
- `onnxruntime-node` (MIT) runs it. `npm run embedder` installs it for this Mac only and strips the rest.
- `worker.cjs` runs in an Electron utility process, so a crash can't take the app down; the app falls
  back to word matching if the model is unavailable.
