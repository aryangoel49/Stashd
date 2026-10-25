# Build prompt: Where Was I, prototype 1

Paste everything below this line into a new Claude Code chat.

---

You're building the first prototype of **Where Was I**, a macOS menu bar app, in the existing project at `~/Documents/where-was-i`. Do all work in that folder.

## Who you're working with
I'm Aryan, a student with no app-building experience. Act as my tech person:
- Explain each step in plain language.
- Tell me exactly what to click or run.
- After each phase, show me how to try it.
- Never assume I know a term. Explain it in one short sentence the first time.

## Read these first
1. `PLAN.md`: the product spec we agreed on. It's the source of truth for behaviour.
2. `design/mockups-v2.html`: the look to match (glass, one accent colour, Apple-style). Open it in a browser to see it.
3. `README.md`: what version 0 does and how to run it.
4. The existing code in `src/` and `tests/`.

## What the app is
Press **⇧⌘S** and Where Was I saves the "job" you're working on: your open browser tabs, which apps are open, and which documents are open in them, plus a short note. It can optionally tidy those windows away. Later, click the menu bar icon and pick the job. A short AI brief tells you, in plain words, where you left off, and one click reopens what you need. It's for anyone (students, job hunters, people planning trips), not just coders.

## Where the code is now (version 0)
Version 0 was built around coding "project folders". **Reuse its hard parts, replace the project-folder idea with jobs.**
- **Stack:** Electron Forge 8 (Vite + TypeScript template), Electron 44, Vite 8, TypeScript 6, React 19, Vitest 5, `@anthropic-ai/sdk`.
- **Node:** v24 LTS is at `~/.local/node/bin` (not in `/usr/local`). Put it on PATH in your shell commands: `export PATH=~/.local/node/bin:$PATH`.
- **Build quirks:**
  - The main process builds to `.vite/build/main.cjs` and the preload to `preload.cjs`.
  - npm 11 blocks install scripts; `fs-xattr`, `macos-alias` and `fsevents` are already approved.
  - Electron's runtime is fetched with `npx install-electron`.
- **Keep and adapt:**
  - `src/main/collectors/browsers.ts`: Chrome, Arc and Safari tabs via `osascript`. Only asks running browsers and skips incognito.
  - `src/main/redact.ts`, `src/main/urls.ts`: secret scrubbing and excluded domains.
  - `src/main/exec.ts`: the only way to run programs (`execFile` with a timeout).
  - `src/main/store.ts`: atomic JSON writes.
  - `src/main/secrets.ts`: the API key in `safeStorage`.
  - `src/main/windows.ts`: window security hardening.
  - `src/main/recap/ai.ts`: the Claude call. Claude Haiku is the default model, with low effort.
  - `src/main/tray.ts`, `src/main/ipc.ts`: the pattern of checking the sender and validating input.
  - `src/preload.ts`: the typed bridge.
  - `scripts/make-icons.mjs` and the `forge.config.mts` packaging: DMG plus zip, Info.plist strings, `LSUIElement`.
  - The tests in `tests/`, especially `tests/privacy.test.ts` (only the Claude module may touch the network).
- **Remove or replace:** project folders, file and git collectors as job content, the coding-specific recap, and the old React screens.
- **Old data:** existing snapshots under `userData/snapshots/` can be left alone. Store jobs separately under `userData/jobs/`.
- **Dev-only test switches** already exist:
  - `WWI_USER_DATA=<folder>` uses a throwaway data folder.
  - `WWI_CAPTURE_DIR=<folder>` saves screenshots of each window so you can check the UI yourself.
  - Keep them working, ignored in the packaged app.

## Decided product behaviour (prototype 1)

### Jobs
- A **job** is a named drawer: Climate essay, Toronto trip.
- Saving a job that's already open (opened from the app) **updates that job** and keeps the previous versions as **history**.
- Saving when no job is open creates a new job. If it closely matches an existing job (same sites, files or similar name), the box offers "Add to Climate essay?" or "Make a new job".
- Storage: `userData/jobs/<jobId>/job.json` (name, created, updated, done flag, learned preferences) plus `userData/jobs/<jobId>/history/<ISO>.json` (each save). Keep the last 30 saves per job.

### What a save captures
- **Browser tabs:** the existing collector. Record each window's active tab and keep tab order.
- **Open apps:** regular apps the user can see (no background helpers).
- **Window order, front to back, plus the frontmost app:** this is how the brief knows "what you were on last". Get it from a small Swift helper (see "Apple helper" below) using `NSWorkspace.frontmostApplication` and `CGWindowListCopyWindowInfo`. Owner app names and order only; window titles need Screen Recording, so don't use them.
- **Open documents** via AppleScript, one small adapter per app, each with a timeout. A failing adapter records an error and never breaks the save:
  - Microsoft Word, Excel, PowerPoint: full paths of open documents
  - Pages, Numbers, Keynote: file paths
  - Preview: document paths
  - TextEdit: document paths
  - Finder: the folders of open Finder windows
  - Only ask apps that are already running. Never launch one.
- **The note** ("Context for the robot 🤖").
- **Never** read page contents, document text, cookies, history or passwords. Scrub secrets with `redact.ts`.

### What's in the job vs left alone
- **Lifestyle apps are never part of a job and never closed:** Spotify, Music, Messages, Mail, Slack, WhatsApp, Discord, Calendar, plus Where Was I itself. Lifestyle sites too: mail.google.com, calendar.google.com, youtube music, and the existing excluded-domain list.
- **New job:** every other tab, app and document is ticked.
- **Updating a job:**
  - **Sure** (ticked): items that were in the job before (same URL, same file, or same site and similar title), or that match the job name or the note.
  - **Not sure** (unticked, one click to add): other remaining items.
- **Learning (simple version):** remember per job which items the user unticks or adds. An item unticked twice in a row is hidden next time; one added twice becomes "Sure". A non-lifestyle app the user unticks from 3 different jobs is treated as lifestyle from then on. No pop-up questions.

### The save box (mockup B1)
- ⇧⌘S opens a floating glass bar in the middle of the screen.
- **Name:** pre-filled (the open job's name, or a guess from the frontmost document's file name or the front window's active tab title), editable.
- **"Context for the robot 🤖":** optional text box with rotating placeholder examples.
- **Tidy up toggle:** **off by default**, remembers the last choice.
- A summary like "2 docs · 7 tabs · 2 maybe". Clicking "2 maybe" expands the Sure / Not sure list as pills.
- Enter saves, Esc cancels. The whole thing should take under 5 seconds.

### Tidy up (only when the toggle is on)
- After saving, close the job's browser tabs and the job's documents. Ask each app to close its document normally, so unsaved changes get the app's own prompt. **Never force-quit, never discard unsaved work.**
- **Untitled documents** (Word "Document1", Pages "Untitled"): first show a small glass prompt with a pre-filled name ("Climate essay – outline") and save location (Documents). Enter saves via the app's AppleScript `save as`, then closes. Skip leaves that window open.
- **Animation:** a transparent, click-through full-screen overlay window. App icons (from `app.getFileIcon`) and small tab cards shrink and fly into the menu bar icon one after another. The icon bounces, and a small glass toast says "Climate essay · 9 items packed". No Screen Recording permission.
- **Undo:** for 10 seconds, the toast has "Undo, bring it back", which reopens exactly what was closed.

### The menu bar panel (mockup A)
- Clicking the tray icon opens a **custom glass panel** (a frameless, transparent BrowserWindow with macOS vibrancy, positioned under the icon, closes on blur), not a native menu.
- Contents:
  - Header: "Where Was I" with "⇧⌘S Save"
  - Job list, newest first. Each row: line icon, name, one-line hint (from the latest brief's first line), time ago.
  - The currently open job is highlighted in the accent colour with a small live dot.
  - Footer buttons: All jobs, Settings.
  - Right-click or a "…" on a row: Rename, Mark as done, Delete (asks first).
- Hovering or clicking a job slides out the **brief card**.

### The brief (mockup C1 as default)
- **Shape:** one or two plain sentences ("You were halfway through paragraph 3 of your essay. Next, find 2 more sources on sea levels.") with key words in the accent colour.
- **Buttons:** **Pick up where I left off** (opens only what's needed) and **All** (opens everything).
- **Footer:** "Brief by Claude / Apple Intelligence / Basic" and "Helpful? Yes · No". No asks "What was wrong?" (one line) and stores it with the job, to include in the next brief's prompt.
- **Writing rules:** everyday words, short sentences, no jargon, no em dashes. Only facts from the snapshot and the note. Say less rather than guess. Mention what was frontmost last. The "needed" items are the frontmost document, the active tabs, and anything the note mentions.
- **AI order:** Claude (if the user connected an API key) → Apple Intelligence (on-device) → basic template. Generate the brief right after saving (in the background) and cache it with that history entry, so opening the menu is instant. Regenerate if it's missing.
- **The Claude call:** send only names, titles, URLs (scrubbed) and the note, never file contents. Use structured output so the reply comes back as `{ sentence, needed: [itemKeys] }`. Handle errors and refusals by falling back to the next option.
- **"Connect Claude"** in Settings: a button opens console.anthropic.com's API keys page in the browser. The user pastes the key, the app makes one tiny test call and shows "Connected ✓". The key goes in `safeStorage`. Show the one-time "what gets sent" disclosure before the first Claude brief.

### Apple helper (on-device AI plus window order)
- A small Swift command-line tool in `native/` compiled with `swiftc` (Xcode is installed), and bundled with Forge `extraResource`.
- It talks JSON over stdin/stdout, with two commands:
  - `windows`: frontmost app and window owner order
  - `brief`: runs Apple's Foundation Models framework (`SystemLanguageModel.default`, check `availability` first) with the same rules and output shape as the Claude prompt
- If Apple Intelligence is unavailable or turned off, return a clear "unavailable" and fall back to the basic template.
- Called only through `exec.ts` with a timeout. Never makes network requests (the privacy test must still pass).
- If building it fails on this Mac, tell me in plain words and keep the rest working.

### Reopening
- Tabs open in the same browser they came from (existing restore code). **Tabs already open are skipped**; compare URLs and switch to them instead.
- Documents open with `open <path>`; apps with `open -a`. Missing files are reported, not errors.
- The item that was frontmost last ends up in front.
- The reverse animation (items fly out of the icon) is nice to have, not required.

### The app window (mockup D1, keep it simple)
- Sidebar of jobs (Done jobs in a collapsed section).
- On the right: brief, items as chips (remove, or drag to another job), and history as a row of dates.
- Settings is a page in this window: Connect Claude, accent colour (indigo #5e6ad2 default, teal #2a9d8f, coral #e07a5f), shortcuts, lifestyle apps list (editable), launch at login, delete all data (asks first).

### Look and feel
- Match `design/mockups-v2.html`:
  - Clear glass panels (vibrancy plus a light tint), a bright top rim, soft shadows, 22px corners
  - System font, one accent colour, neutral everything else, simple line icons, no emoji except 🤖
- Follow light/dark automatically.
- Copy is sentence case, friendly, short, with no em dashes.

## Not in this prototype (leave for later; see PLAN.md "Later")
Switching jobs, the Chrome extension, "where you stopped" (cursor position in documents), Notion and Google Docs page-level detection, automatic saving, and restoring window positions.

## Security (keep everything from version 0)
- **Windows:** `contextIsolation`, no `nodeIntegration`, `sandbox` on, a typed preload, every IPC input validated, sender checked, strict CSP (no network in the renderer), `window.open` and navigation blocked.
- **Programs:** only `execFile` with timeouts.
- **Network:** only the Claude module may touch it (keep `tests/privacy.test.ts` passing).
- **Permissions:** Automation for each controlled app is expected. Explain each macOS prompt to me before it appears. If one is denied, show a friendly glass banner with an "Open System Settings" button.

## Build order (stop after each phase, show me how to try it, then continue)
1. **Jobs and capture:** job storage and history, the app and document adapters, the Swift helper's `windows` command, frontmost tracking. Unit tests for storage, matching (Sure / Not sure), lifestyle filtering and learning.
2. **Save box and menu bar panel:** glass UI, ⇧⌘S, Enter saves.
3. **Brief:** Claude, then Apple helper `brief`, then the basic template. "Pick up where I left off" / "All", skipping already-open tabs. Connect Claude in Settings.
4. **Tidy up:** close safely, name untitled documents, the fly-in animation, Undo.
5. **App window:** jobs, items, history, settings. Then `npm run make` to build a fresh DMG.

## Checks for every phase
- `npx tsc --noEmit` and `npx vitest run` both pass.
- Run the app with `WWI_USER_DATA` and `WWI_CAPTURE_DIR` set, look at the screenshots yourself, and fix layout problems before showing me.
- Tell me honestly what you couldn't test (anything that needs me to click a macOS permission prompt, or Apple Intelligence being on).
- Make a git commit at the end of each phase with a clear message.

## Done means
I can install the new DMG, press ⇧⌘S with Chrome tabs and a Word doc open, type a note, and save. I can turn on Tidy up and watch everything fly into the menu bar icon (and Undo it). The next day I can click the icon, read a short plain-English brief that knows the Word doc was the last thing I was on, and click "Pick up where I left off" to get exactly that back. Spotify is never touched.
