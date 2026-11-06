# On-device meaning model

Lets Stashd tell that "Watch Real Madrid at Barcelona" belongs with "Soccer Streams" even though
they share no words. Runs entirely on the Mac: free, offline, private.

- `model/model.onnx`: all-MiniLM-L6-v2 (sentence-transformers, Apache-2.0), 8-bit ONNX export from
  `Xenova/all-MiniLM-L6-v2`. Downloaded and checksum-checked by `npm run embedder` (not in git).
- `model/vocab.txt`: its word-piece vocabulary (tokenizer is `src/main/meaning/tokenizer.ts`).
- `onnxruntime-node` (MIT) runs it. `npm run embedder` installs it for one chip only and strips the rest.
  Pinned at 1.23.2 on both chips: later versions have no Intel files, and from 1.30 the Apple silicon files
  need macOS 14. It needs macOS 13.4; below that, Stashd falls back to word matching.
- `worker.cjs` runs in an Electron utility process, so a crash can't take the app down; the app falls
  back to word matching if the model is unavailable.
