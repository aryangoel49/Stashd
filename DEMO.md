# Demoing Stashd

The example folders in the app are named for what they show: **Unpack ·**, **Brief ·**, **Ctrl+S ·** and **Finished ·**. Each one below says what to do, what to point out, and why it matters. The live demos at the end need no folder, only the right tabs open.

Before you start: close unrelated tabs, so the screen is easy to follow. Make sure Stashd has the Accessibility permission (for the Claude chat demo) and that a Claude key is connected (for the briefs).

## The 5-minute run

Before the demo, click each folder once so Claude writes its brief (a couple of seconds each). Then go in this order. Each step builds on the last.

1. **The problem (live, 1 min).** Open a TV show's tabs plus one stock search, as in "Two projects in one window" below. Press Ctrl+S: only the show goes in. Click **Pack up** and watch the tabs fly into the menu bar.
2. **Coming back (1 min).** Open **Unpack · Everything comes back** and read the brief out loud. Click **Unpack**: pages, essay and PDF return, with the essay in front.
3. **It knows your work (1 min).** Open the 3 Lisbon tabs and press Ctrl+S: "Your folder". Then show **Ctrl+S · Learned what you leave out**.
4. **Beyond tabs (1 min).** **Unpack · Apps reopen**, then **Unpack · Back to the exact Claude chat**.
5. **It's honest (30 s).** **Unpack · A file went missing**.
6. **Close (30 s).** Point at **Finished · Toronto trip**: done work stays out of the way. Everything is stored on this Mac.

## Example folders

### Unpack · Everything comes back
**Do:** open the folder from the menu bar and click **Unpack**.
**Point out:** three web pages, a Word-style essay and a PDF all open together, and the essay ends up in front, because it's what you were on last. The brief picks up the note "finish the counterargument paragraph".
**Why it matters:** one click gets you back to work, in the right order.

### Unpack · A file went missing
**Do:** Unpack it.
**Point out:** the web page opens, and Stashd says plainly that "Grant budget v3.xlsx" couldn't be found (it was moved or deleted). Nothing crashes, and nothing else is held up.
**Why it matters:** real files get moved. Stashd tells you what's missing instead of failing silently.

### Unpack · Apps reopen
**Do:** Unpack it. Calculator and Chess open. Then click **Pack up** on the same folder.
**Point out:** Pack up quits both apps, like ⌘Q. An app with unsaved work would still ask to save. Unpack brings them back.
**Why it matters:** a folder isn't only tabs. A project can be a set of apps (Terminal, Figma, Notion).

### Unpack · Back to the exact Claude chat
**Do:** Unpack it.
**Point out:** the Claude app opens on the exact chat, not just the app's home screen. The brief also knows what the chat was about.
**Why it matters:** people forget which chat they were in. Stashd remembers it for them.

### Brief · What changed since last time
**Do:** open the folder and read the brief.
**Point out:** this folder was saved twice. The brief knows a PDF and a World Bank page were added since the first save, and that the note moved from "outline done" to "intro drafted, need 2 more sources".
**Why it matters:** the brief tells you where you are now, not just what's in the folder.

### Ctrl+S · Recognises your folder
**Do:** open these three tabs, then press **Ctrl+S**:
- https://www.google.com/travel/flights?q=flights+to+lisbon
- https://www.airbnb.com/s/Alfama--Lisbon--Portugal/homes
- https://www.tripadvisor.com/Attractions-g189158-Activities-Lisbon_Lisbon_District_Central_Portugal.html

**Point out:** the box says **Your folder · saved 2 days ago** in yellow and "Picking up where you left off", not "New folder". Press Enter and it saves straight into the trip.
**Why it matters:** Stashd tells new work apart from work you're coming back to.

### Ctrl+S · Learned what you leave out
**Do:** open the Runner's World plan (https://www.runnersworld.com/training/a20812270/marathon-training-plan/) and any YouTube running video, press **Ctrl+S**, and pick this folder in the dropdown.
**Point out:** the YouTube tab is left unticked, and hovering it says "you usually leave out youtube.com". This folder learned that from past saves.
**Why it matters:** Stashd gets better the more you use it, with no settings to fiddle with.

### Finished · Toronto trip
**Do:** open the folder list.
**Point out:** finished work is kept but moved out of the way, so the main list shows only what's active.
**Why it matters:** your history stays, and the clutter doesn't.

## Live demos (no folder needed)

### Two projects in one window
**Set up:** open three tabs about a TV show (IMDb page, Netflix page, a Google search for it) and one Google search for a stock, like "tsm". Click the IMDb tab, press **Ctrl+S**.
**Point out:** the show's tabs are ticked. The stock search sits under "Probably something else". Hover any item to see why.

### Last app wasn't a browser
**Set up:** same tabs as above, but click into Notion or Terminal before pressing **Ctrl+S**.
**Point out:** Stashd still starts from the tab you were reading, and doesn't throw every tab in.

### Same topic, no shared words
**Set up:** open "Carbon tax - Wikipedia" and the Paris Agreement page from UNFCCC, plus a Nike shoe page. Click the Wikipedia tab, press **Ctrl+S**.
**Point out:** Paris Agreement goes in although the titles share no words. The on-device model knows they're the same topic. Nike stays out.

### Everyday apps stay out
**Set up:** have Spotify, Mail or Messages open while you stash.
**Point out:** the line "Left out 3 everyday things, like music and email". These are never saved and never closed by Pack up.

### Unsaved document
**Set up:** open a new TextEdit document, type a line, don't save it. Press **Ctrl+S**, then **Pack up**.
**Point out:** Stashd ticks it automatically, then asks for a name and saves it before closing. Nothing unsaved is lost.

### Private windows are ignored
**Set up:** open a Chrome Incognito window next to a normal one, then stash and Pack up.
**Point out:** the Incognito tabs never appear and are never closed.

### Changed your mind
**Set up:** press **Ctrl+S**, then press **Esc** or click **Cancel**. Or click **Pack up**, then **Undo** within 2 seconds.
**Point out:** nothing is saved, or everything comes straight back.

### Nothing to stash
**Set up:** close everything except everyday apps, press **Ctrl+S**.
**Point out:** a friendly "Nothing open to stash right now" instead of an empty folder.
