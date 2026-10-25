# Where Was I?

A menu bar app for your Mac. When you stop working on a project, it saves a **snapshot**: what you were about to do next (your note), which files you just edited, your git status, and your open browser tabs. When you come back, it tells you where you were, what changed since, and reopens your tabs and files in one click.

Everything stays on your Mac. The only time it uses the internet is the optional AI recap, and only after you add your own Claude API key.

---

## Install it (the normal way)

1. Open the `out/make/dmg/arm64` folder in Finder and double-click **Where Was I.dmg**.
2. Drag **Where Was I** into **Applications**.
3. **The first time only:** open Applications, **right-click** (or Control-click) Where Was I, choose **Open**, then click **Open** again.
   The app isn't signed with a paid Apple developer certificate, so a normal double-click shows "can't be opened because Apple cannot check it". Right-click → Open tells macOS you trust it. After the first time, it opens normally.
   If macOS still won't open it, go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to Where Was I.
4. A small clock-with-an-arrow icon appears in your menu bar (top right of the screen). There's no Dock icon. That's on purpose.

## First-time setup

1. Click the menu bar icon → **Settings…** → **Add a project folder…** and pick a coding folder. Add as many as you like.
2. The first time you save while Chrome, Arc or Safari is open, macOS asks **"Where Was I wants to control Google Chrome"**. Click **OK** so it can read your tab titles and addresses. (It never reads passwords, history, cookies or page contents.)
   If you clicked "Don't Allow" by mistake, the app shows a yellow banner with an **Open System Settings** button. Turn Where Was I on under **Privacy & Security → Automation**.

## Everyday use

| You want to… | Do this |
|---|---|
| Save where you are | Press **⌘⇧S** (Command + Shift + S), type what you were about to do next, press **Enter**. Esc cancels. |
| See where you were | Press **⌘⇧W**, or click the menu bar icon → **Where was I?** → pick a project. |
| Get your tabs and files back | In the recap, tick what you want under **Reopen** and click **Reopen selected** (up to 20 at a time). |
| Look at an older snapshot | Click it in the **Timeline**. |
| Delete a project's snapshots | Settings → Project folders → **Delete snapshots** (it asks to confirm). |

Note: ⌘⇧S and ⌘⇧W work from every app, so they replace those keys' normal job in other apps. For example, ⌘⇧W normally closes a whole Chrome window. You can change both shortcuts in Settings.

## Optional extras (all off by default, in Settings)

- **Automatic snapshots:** saves by itself when the screen locks, the Mac sleeps, or you've been idle 15 minutes. It only does this if a project file changed in the last hour, and at most once per project every 30 minutes.
- **Recent terminal commands:** includes your last few zsh commands, with passwords and tokens removed.
- **AI recap:** paste a Claude API key (from console.anthropic.com) and turn it on. Then **Ask Claude** appears on the recap. The first time, it shows exactly what will be sent. It sends file names, git status, tab titles and addresses, and your note, all with secrets removed. It never sends file contents. The default model is `claude-haiku-5-5`, which is fast and cheap. The key is stored encrypted in your Mac keychain. If anything fails, you still get the offline recap.

---

## For working on the code

You need Node.js. It's installed in `~/.local/node`, and new Terminal windows find it automatically.

Open **Terminal**, then:

```bash
cd ~/Documents/where-was-i
```

| Command | What it does |
|---|---|
| `npm start` | Runs the app from the code (a test copy). Close it with the menu bar icon → Quit. |
| `npm test` | Runs the automatic checks (111 tests: privacy, password scrubbing, saving, recap…). |
| `npm run typecheck` | Checks the code for type mistakes. |
| `npm run make` | Builds a new **DMG** and **zip** into `out/make`. |
| `npm run icons` | Redraws the app icon and menu bar icon. |
| `npx where-was-i` | Opens the installed app (or the built test copy). |

### Where things are

- `src/main/` is the "background" part: collectors (`collectors/files.ts`, `git.ts`, `browsers.ts`, `shell.ts`), saving (`store.ts`), password scrubbing (`redact.ts`), recap (`recap/`), reopening (`restore.ts`), automatic saves (`autosnap.ts`), menu bar (`tray.ts`).
- `src/renderer/` holds the screens (React): `MainWindow.tsx`, `QuickSave.tsx`, `SettingsWindow.tsx`, `styles.css`.
- `src/preload.ts` is the only bridge between the screens and the background part.
- `tests/` holds the automatic checks. `tests/privacy.test.ts` fails if any file except `src/main/recap/ai.ts` tries to use the internet.
- Your snapshots are saved in `~/Library/Application Support/Where Was I/snapshots/<project>/<time>.json`.

### Security choices (in case your CS friend asks)

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Typed preload API via `contextBridge`. Every `ipcMain.handle` checks the sender and validates its input. Strict CSP (`connect-src 'none'` in the built app). `window.open`, navigation and webviews are blocked, and all permission requests are denied. Every external command goes through `execFile` with a timeout (never `exec` or a shell). The API key is kept with `safeStorage`. Electron fuses turn off `RunAsNode` and the Node CLI flags.

Development-only test switches (ignored by the installed app): `WWI_USER_DATA=<folder>` uses a separate data folder, and `WWI_CAPTURE_DIR=<folder>` saves screenshots of each window.
