# Where Was I?

A menu bar app for your Mac. Press **⇧⌘S** to save the work you're in the middle of: your open tabs, documents and apps, plus a quick note. Later, click the menu bar icon and pick the job. A short brief tells you where you left off, and one click reopens what you need.

Everything stays on your Mac. The only time it uses the internet is for Claude briefs, and only after you connect your own Claude key.

---

## Install it

1. In Finder, open `out/make/dmg/arm64` inside this folder and double-click **Where Was I.dmg**.
2. Drag **Where Was I** into **Applications**. If it asks, click **Replace** to update the older version.
3. **First time only:** in Applications, **right-click** Where Was I, choose **Open**, then click **Open** again.
   The app isn't signed with a paid Apple developer certificate, so a normal double-click is blocked the first time. If macOS still refuses, go to **System Settings → Privacy & Security** and click **Open Anyway**.
4. A small clock-with-an-arrow icon appears in your menu bar. There's no Dock icon, on purpose.

## Using it

| You want to… | Do this |
|---|---|
| Save what you're working on | Press **⇧⌘S**, add a note in "Context for the robot 🤖" if you like, press **Enter**. |
| Also clear your screen | Turn on **Tidy up after saving** in that box. Your tabs and files fly into the menu bar icon. **Undo** brings them back for 10 seconds. |
| See where you were | Click the menu bar icon and pick a job, or press **⇧⌘W**. |
| Get back to work | Click **Pick up where I left off** (just what you need) or **All**. |
| Fix what's in a job | Click **All jobs**. Remove items with ✕, or drag them onto another job. |
| Rename, finish or delete a job | In the job's brief, click **…** |

**The first time** you save with Chrome, Safari, Word and so on open, macOS asks *"Where Was I wants to control Google Chrome"* (once per app). Click **OK**. That's how it reads tab addresses and which files are open. If you clicked "Don't Allow", the save box shows a button that opens the right System Settings page.

**What it learns:** everyday apps and sites (Spotify, Messages, Gmail…) are never part of a job and are never closed. If you keep leaving something out, it stops suggesting it. If you keep adding something, it starts ticking it for you.

## Briefs

The brief is written by, in order:
1. **Claude**, if you connected it (Settings → Claude). It costs about $0.0003 a brief. It gets file names, tab titles and addresses with secrets removed, and your note. Never what's inside your files.
2. **Apple Intelligence** on your Mac, if it's turned on. Free and offline.
3. A **basic brief** written from a template, so there's always something.

The bottom of each brief says which one wrote it. Clicking **No** under "Helpful?" lets you say what was wrong, and the next brief for that job takes it into account.

---

## For working on the code

Node.js is in `~/.local/node`, and new Terminal windows find it automatically. Open Terminal:

```bash
cd ~/Documents/where-was-i
```

| Command | What it does |
|---|---|
| `npm start` | Runs a test copy from the code (it builds the small Swift helper first). |
| `npm test` | Runs the automatic checks. |
| `npm run typecheck` | Checks the code for type mistakes. |
| `npm run make` | Builds a new DMG and zip into `out/make`. |
| `npm run icons` | Redraws the app and menu bar icons. |

### Where things are
- `src/main/capture/`: what's open (apps and window order via the helper, documents via AppleScript, tabs via `collectors/browsers.ts`)
- `src/main/jobs/match.ts`: deciding what belongs to a job (Sure / Not sure / everyday) and learning
- `src/main/brief/`: the three brief writers and exactly what is sent (`prompt.ts`)
- `src/main/tidy.ts`, `tidyflow.ts`: closing safely, naming untitled files, the animation and Undo
- `src/main/store.ts`: jobs on disk, at `~/Library/Application Support/Where Was I/jobs/<job>/`
- `native/wwi-helper.swift`: the small Mac helper (window order, app icons, Apple Intelligence)
- `src/renderer/`: the screens (`Panel`, `Save`, `Tidy`, `Main`, `SettingsView`)
- `tests/privacy.test.ts` fails if anything except `src/main/brief/claude.ts` tries to use the internet.
- `PLAN.md` is the product plan; `design/` has the mockups and the build prompt.

### Development-only switches (ignored by the installed app)
- `WWI_USER_DATA=<folder>`: a separate data folder, so a test copy can run next to the installed app
- `WWI_FAKE_CAPTURE=<file.json>`: pretend "what's open", so testing never asks your real apps anything
- `WWI_CAPTURE_DIR=<folder>`: saves pictures of each window
- `WWI_DEMO_TIDY=1`: shows the tidy-up screens with pretend data
