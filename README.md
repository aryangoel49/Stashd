<p align="center">
  <img src="assets/brand/stashd-hero.svg" alt="Stashd: put your work away, pick it up right where you left off" width="100%">
</p>

<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20silicon-111114?style=flat-square&logo=apple&logoColor=white">
  <img alt="Local first" src="https://img.shields.io/badge/data-stays%20on%20your%20Mac-111114?style=flat-square">
  <img alt="Briefs" src="https://img.shields.io/badge/briefs-Claude%20%C2%B7%20Apple%20Intelligence-111114?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-111114?style=flat-square">
</p>

**Stashd** is a menu bar app for your Mac. Press **⌃S** and it stashes the work you're in the middle of: your open tabs, documents and apps, plus a quick note. When you come back, pick the job from the menu bar. A short brief tells you where you left off, and one click reopens what you need.

Everything stays on your Mac. The only time it goes online is to write Claude briefs, and only after you connect your own Claude key.

---

## How it works

| | |
|---|---|
| **1 · Stash** | Press **⌃S**. Stashd sees what's open and ticks what belongs to this job. Add a note for the robot 🤖 if you like, then press **Enter**. |
| **2 · Tidy (optional)** | Turn on **Tidy up after saving** and your windows fly into the menu bar icon. **Undo** brings them back for 10 seconds. |
| **3 · Pick up** | Click the menu bar icon or press **⌃W**, then choose a job. Read the brief, then hit **Pick up where I left off**. |

## Install

Needs a Mac with Apple silicon (M1 or later).

1. **[Download Stashd.dmg](https://github.com/aryangoel49/Stashd/releases/latest/download/Stashd.dmg)** from the latest release.
2. Open it and drag **Stashd** into **Applications**. If it asks, click **Replace** to update an older version.
3. **First launch only:** open Stashd. macOS says it can't check it for malware, because the app isn't signed with a paid Apple developer certificate yet. Click **Done**, go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**, then confirm.
4. The Stashd folder appears in your menu bar. There's no Dock icon, on purpose.

<details>
<summary>Prefer the Terminal for step 3?</summary>

```bash
xattr -dr com.apple.quarantine /Applications/Stashd.app
```
</details>

> [!TIP]
> The first time you stash with Chrome, Safari, Word and so on open, macOS asks for permission to control that app (once per app). Click **OK**. That's how Stashd reads tab addresses and which files are open. If you clicked "Don't Allow", the save box shows a button that opens the right System Settings page.

## Everyday use

| You want to… | Do this |
|---|---|
| Stash what you're working on | **⌃S**, optional note, **Enter** |
| Clear your screen too | Tick **Tidy up after saving** |
| See where you were | Click the menu bar icon, or **⌃W** |
| Get back to work | **Pick up where I left off** (just what you need) or **All** |
| Fix what's in a job | **All jobs**: remove items with ✕, or drag them onto another job |
| Rename, finish or delete a job | In the job's brief, click **…** |

**It learns as you go.** Everyday apps and sites (Spotify, Messages, Gmail…) are never part of a job and are never closed. If you keep leaving something out, it stops suggesting it. If you keep adding something, it starts ticking it for you.

## Briefs

Each brief is written by the first of these that's available:

1. **Claude**, if you connected it (Settings → Claude). Costs about $0.0003 per brief. It gets file names, tab titles and addresses with secrets removed, plus your note. It never sees what's inside your files.
2. **Apple Intelligence** on your Mac, if it's turned on. Free and offline.
3. A **basic brief** from a template, so there's always something.

The bottom of each brief says which one wrote it. Click **No** under "Helpful?" to say what was wrong, and the next brief for that job takes it into account.

## Privacy

- Jobs live on disk in `~/Library/Application Support/Stashd/jobs/`.
- Your Claude key is stored encrypted in the macOS keychain.
- `tests/privacy.test.ts` fails the build if anything except `src/main/brief/claude.ts` tries to use the internet.

---

## Development

Requires Node.js and Xcode command line tools (for the small Swift helper).

```bash
git clone https://github.com/aryangoel49/Stashd.git
cd Stashd
npm install
npm start
```

| Command | What it does |
|---|---|
| `npm start` | Runs a dev copy (builds the Swift helper and embedder first) |
| `npm test` | Runs the test suite |
| `npm run typecheck` | Type-checks the code |
| `npm run lint` | Lints and checks formatting |
| `npm run make` | Builds `Stashd.dmg` and a zip into `out/make` |
| `npm run icons` | Rebuilds the app and menu bar icons from the brand SVGs |

### Releasing

`.github/workflows/release.yml` builds the DMG on a GitHub Mac runner. Bump `version` in `package.json`, then:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

That publishes a GitHub Release with `Stashd.dmg` attached, which the download link above always points to. Running the workflow by hand from the Actions tab builds the DMG without publishing.

### Project map

```
src/main/capture/      what's open: apps and window order (helper), documents (AppleScript), tabs (collectors/browsers.ts)
src/main/jobs/         what belongs to which job (match.ts, relevance.ts) and learning from corrections
src/main/meaning/      on-device meaning model for job sorting
src/main/brief/        the three brief writers, and exactly what is sent (prompt.ts)
src/main/tidy*.ts      closing safely, naming untitled files, the fly-in animation and Undo
src/main/store.ts      jobs on disk
src/main/legacy.ts     one-time move of data from the old Where Was I folder
src/renderer/          the screens: Panel, Save, Tidy, Main, SettingsView
native/wwi-helper.swift  window order, app icons, Apple Intelligence
```

`PLAN.md` is the product plan. `design/` has the mockups, the build prompt and the brand page.

### Dev-only switches

The installed app ignores these.

| Variable | Effect |
|---|---|
| `WWI_USER_DATA=<folder>` | Separate data folder, so a dev copy can run next to the installed app |
| `WWI_FAKE_CAPTURE=<file.json>` | Fake "what's open", so tests never touch your real apps |
| `WWI_CAPTURE_DIR=<folder>` | Saves a picture of each window |
| `WWI_DEMO_TIDY=1` | Shows the tidy-up screens with demo data |

## Brand

<img src="assets/brand/stashd-icon.svg" alt="Stashd icon" width="96" align="right">

A sleepy white folder on a butter-yellow tile: your work, tucked away and resting until you come back for it. The menu bar version is a simple folder outline so it stays clear at 16px.

- `assets/brand/stashd-icon.svg`: the app icon, a sleepy folder on a butter-yellow tile (vector)
- `assets/brand/stashd-mark.svg`: the folder as a line drawing, black in light mode and white in dark mode
- `assets/brand/stashd-tray.svg`: the menu bar icon source
- `assets/brand/stashd-hero.svg`: the animated banner above
- `design/brand.html`: the icon brought to life. Its eyes close when work is stashed and open, look around and blink when you pick it up. Open it in a browser.
- `scripts/make-icons.mjs`: renders those SVGs into `icon.icns` and the menu bar template (via `scripts/render-svg.swift`)

Colours: butter yellow `#F2CD5C` tile, white `#FFFFFF` and cream `#FBEFC6` folder, ink `#1C1D22` eyes.

## License

MIT. See [LICENSE](LICENSE).
