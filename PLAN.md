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

**Goal:** anyone with a Mac running macOS 13 or later, Intel or Apple silicon, downloads Stashd, opens it with no warnings, and gets **the same app and the same AI brief as everyone else**, with no Claude key needed. No fixed date: we launch when this checklist is done.

### Decided (Aryan, 6 Nov)
- **Stashd AI for everyone.** Briefs go through Stashd's server to Claude, so every user gets the same quality brief no matter which Mac they have. People agree once at first launch.
  - The server only receives names, titles, cleaned addresses and the user's note. It never receives file contents, and it stores nothing.
  - Apple Intelligence stops being a separate brief writer. It's only used as a backup when there's no internet; otherwise the plain template brief is the backup.
- **Free with a daily cap** to start. Paid plans may come later, but nothing free is ever taken away.
- **Two downloads (Apple silicon / Intel).** The website shows only the one that fits the visitor's Mac. Chromium browsers report the chip; in Safari the graphics chip's name gives it away. There's a small "Other Mac?" link for anyone it guesses wrong.
- **The same everywhere.** Same features, look and brief on Intel, Apple silicon, macOS 13 and macOS 27. Anything that can't work somewhere (for example Apple Intelligence below macOS 26) must never change what people see.

### Facts that shape the plan
- **macOS:** Electron 44 needs **macOS 13 (Ventura) or later**, so 13 is the floor. The README says 12, which is wrong.
- **Intel:** macOS 26 is the last macOS for Intel Macs, so Intel users top out there.
- **Intel blockers:** the Swift helper is built for one chip, and the matching model's runtime (onnxruntime) last shipped Intel files in version 1.23.
- **Signing:** since macOS 15, apps that aren't Developer ID signed and notarized need "Open Anyway" in System Settings. Most people quit there. We need the Apple Developer Program ($99 a year).
- **Cost of Stashd AI:** Claude Haiku 5.5 costs $0.10 per million tokens in and $0.50 out, so a brief costs about $0.0005. 1,000 people writing 10 briefs a day comes to about $150 a month. Sonnet 5.5 costs about 20 times more.
- **Auto-update:** Electron's free update service works with a public GitHub repo and signed builds.

---

### Phase 1: a download anyone can open
- [ ] Apple Developer Program, plus a Developer ID certificate (Aryan)
- [ ] Sign the app with the hardened runtime and the right permissions (Apple Events, Electron's JIT), then notarize and staple it, for both the DMG and the ZIP
- [ ] Intel build:
  - [ ] build the Swift helper for macOS 13 on both chips
  - [ ] pin onnxruntime 1.23 for Intel
  - [ ] give the two downloads clear names (`Stashd-AppleSilicon.dmg`, `Stashd-Intel.dmg`)
- [ ] Make sure the Intel and Apple silicon apps give the same matching results (a test that runs the same saves through both)
- [ ] Fix the README and the website ("macOS 13 or later, Intel or Apple silicon")
- [ ] Test on:
  - [ ] this Mac
  - [ ] the Intel build through Rosetta
  - [ ] a macOS 13 virtual machine (UTM)
  - [ ] a real Intel Mac
  - [ ] a brand-new Mac user account
- [ ] Auto-update: check quietly, install on the next restart, show "Updated to 1.6: what's new"
- [ ] Release script: one command that builds both chips, signs, notarizes and publishes the GitHub release

### Phase 2: Stashd AI (the heart of the product)
**Research first (with the Design chat). We decide by testing, not guessing:**
- [ ] Build a test set of 30–50 real-looking saves: students, developers, trip planning, job hunting, and messy saves with 40 tabs
- [ ] Compare models side by side on the test set, blind: Haiku 5.5, Sonnet 5.5, and Apple's on-device model for reference. Compare quality, speed and cost.
- [ ] The brief's shape and look:
  - how long it should be;
  - headings or none;
  - is "next step" first;
  - do links need underlines;
  - font, size and weight;
  - plain sentences or bullets.
  Test 3–4 versions with real people and keep the one they act on fastest.
- [ ] Efficiency:
  - prompt caching for the fixed instructions;
  - a short summary per item that's reused between saves;
  - only the most relevant items, picked by the matching model;
  - a target of under 2 seconds.
- [ ] Write down the result in research/ and in the brief code, so the brief is the same for everyone

**Server:**
- [ ] A Vercel function holds the Anthropic key; the app sends only what a brief needs
- [ ] Anonymous install ID with a daily cap (for example 30 briefs and 30 names). When someone hits the cap, they're told kindly, and the template brief takes over.
- [ ] Spend protection:
  - a monthly limit on the Anthropic account;
  - a stop on the server if usage spikes.
- [ ] Security: never trust what the app sends (strict size limits); treat tab titles as text, not instructions (they could try to steer the AI); log nothing personal
- [ ] Offline or server down → template brief, with a note "AI brief when you're back online"
- [ ] Privacy test updated: only the brief module may use the network, and it may only reach Stashd's server

### Phase 3: accounts, payments and the legal basics
- [ ] **Login:** not needed at launch, since the free cap works on the anonymous install ID. Add sign-in (email code or Sign in with Apple) when paid plans arrive, so a plan follows you to a new Mac.
- [ ] **Pricing model** (decide before paid plans):
  - Free: everything plus N AI briefs a day.
  - Pro (for example $4–6 a month or about $40 a year): more briefs, a smarter model, Ask Stashd and sync later.
  - A one-time "lifetime" deal for launch supporters.
  Research how Raycast, Cove, CleanShot and Granola price.
- [ ] **Payments:** Lemon Squeezy or Paddle (they handle sales tax worldwide) rather than Stripe on its own
- [ ] **Privacy policy:** what stays on the Mac, what Stashd AI sends and to whom (Anthropic), what's stored (nothing but a counter), how to turn it off, and a contact email
- [ ] **Terms of use:** simple, plain-words terms; follow Anthropic's usage policy for an app built on Claude
- [ ] **Data:** "Delete my data" doesn't apply at launch because the server keeps nothing; say so in plain words. Settings gets "Export my folders" and "Delete everything".

### Phase 4: make the app better before strangers use it
**Trust (losing data is the top reason people quit tab tools):**
- [ ] Back up the data folder before any change to how saves are stored, and keep the last 5 backups
- [ ] Show what didn't reopen ("2 tabs couldn't open"), and never fail silently
- [ ] Keep Recently closed for days, not 10 minutes
- [ ] Recover from a damaged save file instead of starting empty

**First run:**
- [ ] Onboarding in 3 steps:
  1. what Stashd does;
  2. permissions, explained at the moment they're needed;
  3. try ⌃S once.
- [ ] A "Don't Allow" fix-it button for every app
- [ ] Chrome extension install inside onboarding
- [ ] The Stashd AI consent screen, short and honest

**Features:**
- [ ] **Ask Stashd** (AI): "what was I doing on the Toronto trip?", "add the Vercel dashboard to Stashd project". It's already in the plan's Later list; decide whether it's part of launch or Pro.
- [ ] Automatic save at moments that already happen: shutdown, a macOS update, closing the lid at night. This was the research's biggest lever for making Stashd a must-have.
- [ ] Dia support only if Dia grows (parked)

**Polish and the worst cases:**
- [ ] Dark mode
- [ ] Reduce Motion
- [ ] VoiceOver labels
- [ ] Keyboard-only use
- [ ] Very long names, 100+ tabs, empty states
- [ ] More than one display
- [ ] The menu bar icon hidden behind the notch (tell people how to find Stashd)
- [ ] Shortcut clashes (⌃S is used in some apps): show the clash and offer to change it
- [ ] Battery and memory: measure that Stashd stays idle when idle

**Support:**
- [ ] "Send feedback" in the app (writes an email, with the app version and macOS version filled in)
- [ ] A crash and error log on the Mac that people can choose to attach. No hidden tracking.
- [ ] Optional, opt-in usage numbers to check the must-have measure (how often saves are reopened), clearly explained, off by default

### Phase 5: launch
- [ ] Chrome Web Store listing for the extension ($5 one-time; review can take days, so submit 2 weeks before)
- [ ] Own domain (for example stashd.app), email (hello@…), website on it
- [ ] Website:
  - the right download per Mac;
  - privacy and terms pages;
  - pricing page (once there's Pro);
  - an FAQ with "Does it work on Intel?" and "What does Stashd AI send?";
  - share previews (OG images).
- [ ] Demo video (60–90 seconds) and a press kit (icon, screenshots, one paragraph)
- [ ] Private beta: 10–20 people, including 2+ Intel and 2+ macOS 13–14. Run the "how disappointed would you be?" survey after 2 weeks.
- [ ] Launch-day plan (Marketing chat): Product Hunt, Hacker News "Show HN", X and Reddit, plus a fix-and-ship-same-day routine

### What Aryan does
1. **Join the Apple Developer Program** as an individual at developer.apple.com/programs ($99 a year; approval usually takes 1–2 days). Then I'll walk you through the certificate and the notarization password.
2. **Anthropic account for Stashd AI:**
   - create an API key at platform.claude.com under a Stashd organization (not your personal key);
   - add billing;
   - set a monthly spend limit (for example $50).
   - Put the key in Vercel's environment settings yourself; never paste it in chat.
3. **Chrome Web Store developer account** ($5 one-time).
4. **Pick and buy a domain** (about $10–30 a year).
5. **Find testers:** 1–2 people with an Intel Mac, and 10–20 beta testers.
6. **Later:** choose Lemon Squeezy or Paddle when we do paid plans.

### Still to decide (not urgent)
- Pro price and what's in it; whether Ask Stashd is free or Pro
- Login method when paid plans arrive (email code vs Sign in with Apple)
- The brief's final look (decided by the Phase 2 tests)
