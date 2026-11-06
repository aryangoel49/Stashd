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

## 🚀 Launch plan (6 Nov 2026, reworked)

**Goal:** anyone on macOS 13 or later, Intel or Apple silicon, can install Stashd and get **the same app and the same AI brief as everyone else**, with no Claude key needed.

**The big change from the first draft:** get real people using it in about 2 weeks, learn from them, then launch widely. The first draft had about 60 boxes to tick before anyone outside could try it. The biggest unknown isn't Intel support or pricing. It's **whether people come back to Stashd after the first week.** Only real users can answer that.

### Decided (Aryan)
- **Stashd AI for everyone.** Every brief goes through Stashd's server to Claude, so everyone gets the same brief, on any Mac. People agree once at first launch.
  - The server only receives names, titles, cleaned addresses and the user's note. It never receives file contents, and it stores nothing.
  - If there's no internet, the plain template brief is used.
- **Free with a daily cap** to start. Nothing free is ever taken away later.
- **Two downloads**, and the website shows only the one that fits the visitor's Mac.
- **The same everywhere:** same features, look and brief on every supported Mac.
- **No Apple Developer Program for now.** People will see Apple's warning once, at install (see "Installing without the $99 account").
- Chrome Web Store account and a domain: yes.
- A full marketing research phase before the public launch.
- **No launch date.** We launch when the checklist is done, not to meet Arc's closing day. The Arc Spaces idea stays a nice-to-have.

### Installing without the $99 account (what it really means)
- **Stashd is a Mac app, not a web app.** It has to be: a website can't see your tabs, files or apps.
- **First install:** Apple shows *"Apple could not verify Stashd is free of malware"*.
  - On macOS 13–14: right-click the app, then Open.
  - On macOS 15 and later: System Settings → Privacy & Security → Open Anyway, then your password.
  - Developers are used to this. Students and non-technical people often stop there.
- **The fix we use: a one-line install command** for the website (`curl -fsSL https://<domain>/install | bash`). Files downloaded this way don't get Apple's "downloaded from the internet" flag, so there's no warning. Tools like Homebrew and Bun install this way.
  - The DMG stays available for people who prefer it, with a short picture guide to "Open Anyway".
- **Homebrew is out:** it no longer accepts apps without Apple's check.
- **Updates (important):** Electron's standard auto-updater needs an Apple-signed app.
  - Plan: sign every release with one self-made "Stashd" certificate that we back up and keep for good. That keeps macOS's "Stashd may control Chrome" permissions across updates; with a different signature every time, people would have to approve every app again after each update.
  - Then build Stashd's own updater: it checks GitHub Releases, downloads, swaps the app and restarts.
  - First test whether the standard updater accepts the self-made certificate. If it does, use that instead.
- **When to revisit the $99:** when we aim at students and non-technical people, when paid plans start (it pays for itself), or if beta testers drop off at install.

### Installing, updating and permissions (Aryan, 6 Nov)
- **Three ways to install, all on the website:**
  1. the DMG;
  2. a one-line Terminal command (`curl … | bash`);
  3. **`npx stashd`** for people who have Node. The npm name `stashd` is free today; publishing needs a free npm account (Aryan).
  - All three put Stashd in Applications and open it. The two Terminal ways skip Apple's warning.
- **Every update reaches everyone:**
  - Stashd checks GitHub Releases when it starts and every few hours.
  - When there's a new version, it shows **"Stashd 1.6 is ready: what's new · Install and restart"**. One click: it downloads, swaps itself and reopens. "Later" asks again the next day.
  - No Terminal and no DMG for updates.
- **Permissions once, at the start:**
  - The first-run setup lists the apps Stashd can work with that are on this Mac (Chrome, Safari, Word…) and asks for access to all of them in one go. People click OK a few times, once.
  - Each one comes with a plain line saying why ("so Stashd can save and reopen your tabs").
  - Because every release is signed with the same kept Stashd certificate, macOS remembers these and **never asks again after updates**.
  - Anything someone said no to can be fixed later from one button in Settings.
- **Transparency:** what Stashd reads, what it sends (only for AI briefs) and what it never touches go on one plain page on the website. Terms only if we need them.

### Your Claude key, explained simply
- The key in your Stashd today lives in **your Mac's keychain**. It pays for **your** briefs only. Other people's Macs can't see it, so it can't power their briefs.
- **Why not put your key inside the app?** Anyone could pull it out (the code is public on GitHub) and run up your bill.
- **So:** the key lives on a small server (Vercel, where the website already is).
  - The app sends the brief data to the server.
  - The server adds the key and asks Claude.
  - The brief comes back.
  - The key never leaves the server.
- **What you do:** in the Anthropic Console, make a **new key just for the server**, in a workspace with its own monthly spend limit. Same account, separate key, so you can see its cost and switch it off on its own. Put it in Vercel's settings yourself.
- **Is a server the best way?** Yes. The alternatives:

| Option | Why not |
|---|---|
| Your key inside the app | Can be stolen; costs unlimited |
| Each person brings a key | Most people don't have one; that's the problem today |
| Apple Intelligence only | Not on Intel or macOS below 26, so briefs would differ |
| A small AI model inside the app | About 2 GB more, slow on Intel (10–30 s), weaker briefs |
| Apple's cloud AI for apps | Needs Apple's approval and the $99 account; new Macs only |
| **Stashd's server + Claude Haiku 5.5** | **Same brief for all, about $0.0005 each, fast** |

- **Honest risk:** because the app is open source, anyone can see how it talks to the server and could call it directly.
  - Protection: a daily cap per install, a limit per internet address, a daily budget on the whole server, and the spend limit in the Anthropic Console.
  - Worst case, someone burns that day's budget. No one can run up your bill beyond the limit you set.
- **Small print:** Vercel's free plan is for non-commercial use. Fine while Stashd is free; paid plans mean Vercel Pro ($20 a month).

### Bonus: counting users without tracking
Each brief request carries the anonymous install ID, so the server can count how many installs make a brief each week. That's enough to see whether people come back, the most important number, without any extra tracking. The privacy page will say so in plain words.

---

### Stage 1: ready for a private beta (about 2 weeks)
**Build:**
- [x] Stashd AI server (`api/brief.ts`, live at getstashd.vercel.app/api/brief), with per-install, per-address and daily-total caps. It stays switched off until the key is added. Optional: connect Upstash Redis in Vercel so the counters are shared and the weekly count works.
- [x] Brief writers in order: your own key (optional), then Stashd AI, then the template. Apple Intelligence removed, so briefs are the same everywhere.
- [ ] Consent screen at first launch
- [x] Privacy test (Stashd AI may only talk to Stashd's server) and README
- [ ] Website wording about Stashd AI, once it's switched on
- [x] Intel build: Swift helper for macOS 13 on both chips, onnxruntime 1.23.2 for Intel and the default (1.30) on Apple silicon, the same matching results on both because both run the model with `basic` optimization (`npm run check:chips`). `npm run make:intel` builds Stashd-Intel.dmg. Minimum for the meaning model: macOS 14 on Apple silicon, 13.4 on Intel; older Macs (down to 13.0, Electron's limit) still run with word matching.
- [ ] Release signing with the kept Stashd certificate, plus Stashd's own updater, automatic like Chrome or Slack: it downloads new versions quietly and installs them the next time Stashd or the Mac restarts. A small "Restart to update" in the panel lets people do it now.
- [x] **Memory database** (`src/main/memory.ts`, one SQLite file on the Mac): moments, snapshots, prompts, saves, patterns, meanings, rule books; numbered upgrade steps with a copy first; damaged file set aside; detail kept 90 days, moments a year; Forget my history. Records your ⌃S saves today.
- [x] **Automatic stashing, first version (7 Nov):** drift asks "Save it?"; sleep, lock, shutdown and away save first and ask on return (Remove); after a restart "Bring it back"; one automatic save per folder; cards learn from your answers (memory + rules.ts). Still to come: calls, Loose ends for work that fits no folder, Focus and full-screen silence, remote rule book.
- [ ] ~~Automatic stashing (moved up from Later, 6 Nov).~~ The research's biggest lever: people shouldn't have to remember ⌃S. Stashd saves quietly, into the folder the work matches, at moments that already happen:
  - the lid closes or the Mac goes to sleep or locks;
  - a shutdown, a restart or a macOS update;
  - you've been away a while (for example 20 minutes);
  - a call starts (Zoom, Meet, Teams opening);
  - you switch to another folder's work (the matching model already notices this).
  - Rules: it never closes or quits anything on its own, it says "Saved automatically" in the menu bar, and each moment can be switched off in Settings. Coming back shows the brief.
  - Later, it learns each person's habits (when their day ends, which moments they use) and tunes itself.
- [ ] Installers: DMG (with the "Open Anyway" picture guide), the one-line command, and `npx stashd`
- [ ] First-run permissions step: ask for every installed app at once, with a reason for each
- [x] **Brave, Edge and Vivaldi support.** They work like Chrome, so it's cheap, and many developers use Brave. Tested on the real browsers (Brave 1.99, Edge 157, Vivaldi 8.3) with `tests/browsers-live.test.ts`, and Edge and Vivaldi through the whole save, Pack up and Unpack flow. Still open: after Pack up closed a whole window, Unpack showed each Vivaldi tab twice; and Brave's whole flow hasn't been run.
  - Firefox and Zen can't share their tabs with other apps on a Mac; the website says so plainly.
- [x] Never lose a save: back up before any change to how saves are stored (`src/main/safety.ts`, last 5 kept), recover from a damaged file
- [ ] Show what didn't reopen
- [ ] "Send feedback" button (email with the app and macOS version filled in)

**Check:**
- [x] This Mac
- [x] The Intel build through Rosetta
- [ ] A macOS 14 virtual machine (UTM), the oldest version with every feature on Apple silicon
- [ ] A real Intel Mac
- [ ] A brand-new Mac user account: the whole install and first run

### Stage 2: private beta (2–3 weeks, 20–50 people)
- [ ] Mix of testers: developers, students, freelancers; at least 2 Intel Macs and 2 on macOS 14–15
- [ ] **Brief research on real use.** With testers' OK, collect sample saves and their briefs.
  - Test models blind: Haiku 5.5 vs Sonnet 5.5.
  - Test the brief's shape: length; headings; next step first; underlines; font, size and weight; bullets or sentences.
  - Pick the version people act on fastest.
  - Efficiency: prompt caching, reusing summaries, sending only the relevant items; under 2 seconds.
- [ ] Watch weekly returns (server count). After 2 weeks, run the "how disappointed would you be?" survey; the target is 40% "very disappointed".
- [ ] Fix the top 5 complaints every week; ship through the updater

### Stage 3: public launch
- [ ] First run for strangers:
  - 3 steps: what it does, permissions when needed, try ⌃S;
  - a "Don't Allow" fix-it button;
  - the Chrome extension.
- [ ] Polish and worst cases:
  - dark mode, Reduce Motion, VoiceOver, keyboard-only use;
  - 100+ tabs, long names, more than one display;
  - the menu bar icon hidden by the notch;
  - shortcut clashes.
- [ ] Domain, email (hello@…), website on the domain:
  - the right download per Mac, plus the install command;
  - privacy and terms pages in plain words;
  - an FAQ.
- [ ] Chrome Web Store listing (submit 2 weeks ahead; review takes days)
- [ ] The marketing phase below, then launch week

### Marketing phase (Marketing chat; research before posting anything)
**Positioning:**
- Who exactly: developers and technical freelancers juggling AI chats, and students.
- The one-line promise, and the "open source, your stuff stays on your Mac" angle.

**The timely hook: Arc closes on 22 Dec 2026.**
- Arc users lose their Spaces and are hunting for alternatives right now.
- Idea (check it works first): **"Move your Arc Spaces out before it closes"**. Stash every Arc Space into a Stashd folder and reopen it in Chrome, Brave or Safari.
- Launching before 22 Dec would catch that wave. If we want it, it's the one reason to set a date.

**Channels to research.** For each one, check the self-promotion rules, what format works, the best day and time, and past Mac app launches that did well:
- **Reddit:**
  - r/macapps (the main one for Mac apps), r/MacOS, r/apple (strict);
  - r/productivity, r/SideProject, r/opensource, r/ArcBrowser (Arc refugees, but read the rules);
  - student subs such as r/GetStudying;
  - r/ADHD usually bans promotion: be useful there, don't advertise.
- **Hacker News "Show HN":** open source and local-first go down well. Expect "Electron is heavy" comments; the app is about 355 MB, mostly Electron itself, so have an honest answer ready.
- **Product Hunt:** prepare the assets, launch at 12:01 am Pacific, rally the beta testers.
- **X:** build in public from now, with short clips. The Tidy all fly-in and the pixel mascot are made for video.
- **TikTok, Reels, Shorts:** "40 tabs gone in one keypress" videos.
- **Listings and press:** AlternativeTo ("Arc alternative", "OneTab alternative"), Indie Hackers, Mac newsletters and blogs.

**Content:**
- a 60–90 second demo;
- GIFs;
- launch-post copy for each channel;
- an "Arc alternative / save your Arc Spaces" guide page for search.

**Measure:** downloads, installs making briefs (server count), week-2 returns, and the 40% survey.

### Later (only once free use is growing)
- [ ] Paid plan (Pro) and pricing research (Raycast, Cove, CleanShot, Granola); payments through Lemon Squeezy or Paddle
- [ ] Login (email code or Sign in with Apple), only when paid plans need it
- [ ] Ask Stashd (AI); automatic save at shutdown, updates and lid close (the research's biggest must-have lever, first after launch)
- [ ] Apple Developer Program (see the triggers above)
- [ ] **Screen switch** (demo: claude.ai/artifact/PpCArvPdPxS1GF1ZKXY565): ⌃⇧→ / ⌃⇧← glide the window you're in to the next screen with a small "Moved to …" pill and a bump at the edge; ⌃⇧↑ opens a picker (this window, just this tab, swap screens). Parked by Aryan on 6 Nov until after launch.

### Who does what
- **Build chat (Aryan's):** the updater with "Install and restart", the installers (DMG guide, one-line command, `npx stashd`), the first-run setup (permissions in one go, Stashd AI consent), the "Send feedback" button, then the beta checks.
- **Vansh (his own Claude):**
  1. Intel and macOS 13: the Swift helper for both chips at macOS 13 (Apple Intelligence code removed), onnxruntime 1.23 for Intel, a separate Intel build, the same matching results on both, a test through Rosetta.
  2. Brave, Edge and Vivaldi: read, close and reopen their tabs like Chrome, with Settings switches.
  - Vansh owns `native/`, `scripts/prepare-embedder.mjs`, the build config's chip settings and the browser code. The Build chat stays out of those until his work lands.
- **Design chat:** the look of the first-run setup and the brief tests.
- **Marketing chat:** the marketing phase, website copy, launch week.
- **Aryan:**
  - the Anthropic server key with a spend limit, added to Vercel (and Upstash Redis from the Vercel Marketplace);
  - a free npm account for `npx stashd`;
  - a backup of the "Stashd Local Signing" certificate (every release is signed with it; if it's lost, everyone approves permissions again once);
  - the Chrome Web Store account and the domain;
  - beta testers, including Intel Macs.
