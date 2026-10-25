# Where Was I: the plan

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

### Saving: ⌘⇧S → Enter
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
