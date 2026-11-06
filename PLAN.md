# Stashd (formerly Where Was I): the plan

A living document. We add to it as we decide things, and build step by step once it's settled.
Last updated: 24 Oct 2026 (evening).

## The idea in one line
Press one shortcut to put away the work you're doing. Later, open it again, and a short AI brief tells you exactly where you left off.

It's for anyone (students, job hunters, people planning trips), not just coders. It lives in the menu bar. The app window is just a bigger version of the menu bar dropdown.

---

## ✅ Decided

### Jobs are drawers
- Each piece of work is a **job** (Climate essay, Toronto trip, Resume).
- You put your work in it, close it, and open it again later.
- The menu bar lists your jobs, newest first.

### Saving: ⌃S → Enter
The save box has:
- **Name**, pre-filled with a guess (for example from the Word file's name). Edit it or press Enter.
- **"Context for the robot 🤖"**: an optional note the AI reads. The placeholder text rotates through examples like "halfway through paragraph 3…".
- **☐ Tidy up after saving**: **off by default**. When ticked, the job's windows close and fly into the menu bar icon.
- **One Save button.** No Save / Pack up / Finish choice. "Mark as done" lives in the menu next to each job instead.

### Tidying up
- An animation: windows shrink and fly into the menu bar icon, the icon bounces, and it shows "Climate essay · 9 items packed". Unpacking plays it in reverse.
- It uses app icons and window shapes. It doesn't need the Screen Recording permission.
- **Undo:** for 10 seconds after tidying, an "Undo, bring it back" button appears.
- **Unsaved work is never lost.** Untitled files ("Document1") get a pre-filled name (*"Climate essay – outline"*), and you press Enter to save. **Skip** leaves that window open.
- **Everyday apps stay open** (Spotify, Music, Messages, Mail, Slack, WhatsApp to start). The app learns more over time.

### Deciding what belongs to a job
At save time, each open tab, app and document is checked against the job, strongest clue first:
1. The app reopened it as part of this job (near-certain)
2. It's in the same browser window as the job's tabs
3. Same website and similar title to tabs this job had before
4. It matches the job name or your note
5. The AI's opinion, if connected (it reads titles only)

The save box shows:
- **Sure items**, ticked automatically
- **"Not sure about these"**: a short list, unticked, with one click to add
- **Everything else** (Gmail, Spotify, random tabs) is hidden

It learns from corrections. Untick or add something twice and it does that by itself next time. You can also drag items between jobs later in the app window.

### Apps used both ways (Notion, Google Docs, Figma, Slack…)
- It works out the difference by itself, with no pop-up question.
- **For work:** a page whose title matches the job, or that keeps showing up with it, becomes part of the job. Only **that page** reopens.
- **Everyday:** if it's open during every job with unrelated pages, it's treated like Spotify and left alone.
- **Unsure:** it goes in the "Not sure" list.
- ⚠️ Needs testing: Notion's **desktop app** may not expose the exact page link. Notion in Chrome definitely works.

### The AI brief
- **Who writes it:** your Claude (via an API key from console.anthropic.com, about $0.0003 per brief), otherwise **Apple Intelligence** on your Mac (free, offline, private), otherwise a basic written summary. A small label shows which one wrote it.
- **"Connect Claude"** is a guided step: open the console, create a key, paste it, see "Connected ✓". The key is stored encrypted in the Mac keychain.
- **Format (first draft, still being explored):** three short lines, always in the same order, in everyday words:
  > **You were:** writing paragraph 3 of your essay.
  > **Still to do:** find 2 more sources on sea levels.
  > **Start with:** your essay, then the 2 JSTOR tabs you hadn't read.
- **Accuracy rules:** only facts it actually saw, plus your note. When unsure, it says less instead of guessing.
- **Buttons under the brief:** **Open what I need** (just the "Start with" items) and **Open everything**.
- **Adapts to how you work** over time: it skips things you always ignore, points out tabs you never read, remembers your usual session length, and adds a catch-up line after a long break.
- **👍 / 👎** on each brief. A 👎 asks "What was wrong?" and uses the answer next time.
- **What was "last":** taken from the order of windows on screen at save time (front to back) and the active tab in each browser window. It never watches in the background.

### Saving a job that's already open
- Saving again **updates the same job** and keeps older versions in its **history**. The menu shows one entry per job.
- The brief can then say what changed since last time.
- If you didn't open a job from the app, saving makes a new job. If it looks like an existing one, the box offers "Add to Climate essay?" or "Make a new job".

### Coming back
1. Click the menu bar icon and hover over a job. A card slides out with the brief.
2. Click **Open what I need** or **Open everything**. Items fly out of the icon, and the thing you were on last comes to the front.
3. Tabs that are already open are switched to, not opened twice.

### Privacy (unchanged from version 0)
- It looks only when you press the shortcut. No background watching.
- It never reads page contents, document text, passwords, cookies, history or private windows.
- Everything is stored on your Mac. The only network use is the Claude brief, and only if you connect it.
- Secrets in addresses and notes are scrubbed before anything is saved or sent.

---

## Prototype 1: built (25 Oct)
All five phases of `design/BUILD-PROMPT-v1.md` are done and committed (git log shows one save per phase). Still to try on a real Mac: the macOS permission prompts, closing real windows with Tidy up, naming an untitled Word file, a real Claude brief, and Apple Intelligence once it's turned on.

## Prototype 1 defaults (25 Oct)
The build prompt is in `design/BUILD-PROMPT-v1.md`. Until we decide otherwise, prototype 1 uses: the save box **B1** (floating bar), brief shape **C1** (one sentence plus next step), accent **indigo** (teal and coral selectable in Settings), and the glass look from `design/mockups-v2.html`. "Where you stopped" is not in prototype 1.

## ❓ Still to decide
1. **The brief's shape:** "You were / Still to do / Start with" is a good start but doesn't feel right yet. Other shapes are being explored in design/mockups-v2.html.
2. **"Where you stopped":** let it ask Word, Pages and similar apps for the cursor position ("paragraph 3 of 7") without reading the text? It would be a setting, off by default.

## 🗄 Later (not in version 1)
- **Switching jobs:** click another job to pack the current one and unpack the other, like changing desks. We want to make the "how" better before building it.
- **Chrome extension:** knows which tab was opened from which and reads Chrome tab groups, for near-perfect matching.
- Automatic save when the laptop closes.
- Putting windows back exactly where they were on screen.
- **Ask Stashd to change a folder:** in the Ask Stashd chat (the "Soon" item in the Stashd window), say things like "add the GitHub repo and the Vercel dashboard to my Stashd folder" or "take the ESPN tab out of Japan trip". Stashd finds the right folder and the real addresses (from your open tabs, history of saves, or the web) and adds them as a new save, so nothing is lost.

---

## What already exists (version 0, built 17 Oct)
The first version in this folder was built around coding "project folders". It already handles the hard parts we'll reuse: reading browser tabs (Chrome, Arc, Safari), scrubbing secrets, saving snapshots safely, reopening tabs and files, the menu bar icon, the shortcuts, the Claude connection, and 111 automatic tests. The new plan replaces project folders with jobs and adds open apps and documents, the tidy-up animation, Apple Intelligence and the new brief.

## Build order (draft, to confirm once the open questions are settled)
1. Jobs instead of project folders; capture open apps and documents, plus window order
2. The new save box (name, context for the robot, Sure / Not sure lists)
3. Brief v1: Claude, Apple Intelligence and the basic fallback, plus Open what I need / Open everything
4. Tidy up, the animation, Undo, and naming untitled files
5. Learning: everyday apps, tab-to-job matching, Notion-style apps
6. 👍 / 👎 feedback and briefs that adapt to how you work

---

## 🚀 Launch plan (6 Nov 2026)

**Goal:** anyone with a Mac from about 2017 onwards can download Stashd, open it with no warnings, and get AI briefs without a Claude key of their own.

### Where things stand
- **macOS:** the app needs **macOS 13 (Ventura) or later**. Electron, which Stashd is built on, requires it. The README's "macOS 12" is wrong; the fix is to say 13. Going lower would mean an old, unpatched Electron, which isn't worth it.
- **Chip:** the download is Apple silicon only. Two things block Intel:
  - the Swift helper is built for one chip;
  - the matching model's runtime (onnxruntime) stopped shipping Intel Mac files after version 1.23.
- **AI briefs:** they come from Claude only if you paste your own key, and from Apple Intelligence only on macOS 26+ with Apple silicon. Everyone else gets the plain template brief.
- **Opening it:** the app isn't signed with an Apple Developer ID. Since macOS 15, people have to dig into System Settings and click "Open Anyway". Most people give up there.
- **Updates:** there's no auto-update, so launch-week fixes would never reach users.

### The plan, in order

**1. Signed, notarized download (blocks launch)**
- Join the Apple Developer Program ($99 a year).
- Build with a Developer ID certificate, the hardened runtime and Apple's notarization, so it opens like any normal app.
- This also keeps macOS's "Stashd can control Chrome" permissions across updates.

**2. Intel Macs and macOS 13–25**
- Make two downloads, "Apple silicon" and "Intel". The website suggests the right one.
- The Intel build pins onnxruntime 1.23, the last version with Intel files.
- The Swift helper is built for macOS 13 on both chips. Apple Intelligence stays switched off below macOS 26, as it is today.
- Testing:
  - Intel: run the Intel build on this Mac through Rosetta, then on a real Intel Mac (a friend's).
  - macOS 13: a free macOS 13 virtual machine (UTM).

**3. AI briefs with no key: "Stashd AI"**
- A small server on Stashd's existing Vercel account holds the Claude key. The app sends the same scrubbed data a brief uses today: names, titles, cleaned addresses and your note, never file contents. The server asks Claude Haiku 5.5 and sends the brief back. Nothing is stored.
- **Cost:** about $0.0005 a brief (Haiku 5.5 costs $0.10 per million tokens in and $0.50 out). 1,000 people writing 10 briefs a day comes to about $150 a month.
- **Abuse limits:** each install gets an anonymous ID with a daily cap (for example 30 briefs). The server keeps a per-ID counter and nothing else.
- **Who writes the brief:** your own Claude key, if you added one, then Stashd AI, then Apple Intelligence, then the plain template. Stashd AI only runs once you've agreed to it (one clear screen at first launch), and Settings can turn it off.
- **What changes in the code:** the privacy test allows the new brief module to use the network, and the website and README privacy text are updated.

**4. Auto-update**
- Use Electron's free update service (update.electronjs.org). It works with a public GitHub repo and signed builds.
- Stashd checks quietly and installs on the next restart.

**5. First run that works for strangers**
- Check the onboarding on a fresh account:
  - permissions (one Automation prompt per app);
  - the Chrome extension;
  - the Stashd AI consent screen;
  - what happens if someone clicks "Don't Allow".
- Add a "Send feedback" button that writes an email. No hidden tracking.

**6. Launch week (Marketing chat)**
- Publish the Chrome extension on the Chrome Web Store ($5 one-time; review can take days, so submit early).
- Website changes:
  - two download buttons;
  - a privacy page that explains Stashd AI;
  - "Requires macOS 13 or later".
- Product Hunt and socials.

### Roadmap
| When | What |
|---|---|
| Week 1 | Apple Developer account approved; signing + notarization; Intel + macOS 13 builds; README fix |
| Week 2 | Stashd AI server + consent screen; auto-update; test on Intel (Rosetta, then real) and macOS 13 |
| Week 3 | Fresh-account onboarding pass; Chrome Web Store submission; website download + privacy pages |
| Week 4 | Private beta with 10–20 people; fix what they hit; then public launch |

### What Aryan does
1. **Join the Apple Developer Program** as an individual at developer.apple.com/programs ($99 a year; approval usually takes 1–2 days). Then create a "Developer ID Application" certificate (I'll walk you through it), and an app-specific password for notarization.
2. **Anthropic account for Stashd AI:**
   - create an API key at platform.claude.com, under an organization that is Stashd's, not your personal key;
   - add billing;
   - set a monthly spend limit (for example $50).
   - Then add the key to Vercel's environment settings. Never paste it into chat.
3. **Chrome Web Store developer account** ($5 one-time).
4. **Find 1–2 people with an Intel Mac**, and 10–20 beta testers.

### Decisions needed from Aryan
1. **Briefs through Stashd's server.** Is it OK for brief data to go through Stashd's server to Claude (scrubbed, never stored), as long as people agree first? This changes "stays on your Mac" into "stays on your Mac, except briefs if you turn on Stashd AI".
2. **Price.** Free for everyone with a daily cap, or a free cap plus a paid tier later? Never take away what was free.
3. **Downloads.** Two downloads (Apple silicon / Intel) or one bigger download for both chips? Two is simpler and smaller.
4. **Launch date.** It decides how much of steps 5–6 fits.
