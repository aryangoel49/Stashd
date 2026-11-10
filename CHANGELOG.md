# Changelog

What changed in each version of Stashd, for people using it. Versions follow semantic versioning:
a new feature moves the middle number (1.4.0), a release of only bug fixes moves the last (1.4.1).

## Unreleased

### Added
- Smart Tidy all. Before closing, each piece of work you have open is saved: into its folder, or a new folder of its own, which a small card then lets you rename. Stray tabs, error pages and front pages just close. With Stashd AI on, Claude does the sorting and naming (a sparkle on the switch shows it); otherwise your Mac does. Turn it on or off with the Smart switch on the Tidy all button.

### Changed
- The Tidy all button looks like a button now, with its Smart switch attached.
- Unpack has a new, calmer animation. With window places on, see-through shapes of your windows glide out to where each one opens; otherwise your apps' icons glide into the tray. Either way they stay until everything has opened.

## 1.11.1 (2026-11-09)

### Fixed
- Tidy all closes Finder windows too. A Finder window that belonged to no folder was left open, so Tidy all could say "Already tidy" with a folder window still on your desk.

## 1.11.0 (2026-11-09)

### Added
- **⌃S has its own swoop.** When you save, what you picked arcs into the folder in the save box, a beat apart, and the folder bounces as it lands. Pack up, Tidy all and Unpack keep their fly-in to the menu bar. Reduce Motion skips it.

## 1.10.0 (2026-11-09)

### Changed
- **Adding the Chrome helper is much easier.** Add to Chrome (in the welcome or Settings) opens Chrome's extensions page with a small card beside it that keeps the steps on screen. You drag the helper's folder straight from the card onto the page, with no hunting through Chrome's file picker, and the card ticks itself off when Chrome has added it.

## 1.9.0 (2026-11-09)

### Added
- **New sounds.** Short recorded sounds when you stash, pack up, unpack and tidy all, when Stashd names a new folder, when something doesn't come back after Unpack, and for your very first save. Everything else stays quiet. Turn them off with Sounds in Settings.
- **Unpack uses the window you have open.** A folder's tabs go into your open browser window instead of a new one each time.
- **Put windows back exactly where they were** (Settings → Unpack, off unless you turn it on). Unpack then moves and resizes your windows to the places they had when you saved: your open browser window takes the shape of the saved one, a folder saved across several browser windows gets them back, and documents' and apps' windows return too (full screen stays full screen). A screen that's no longer plugged in sends its windows to your main screen. Apps other than browsers need Accessibility, which Stashd asks for when you turn it on.
- **What didn't come back.** After Unpack, a card lists anything that couldn't reopen and why. A file that moved can be found again by name (the folder then remembers its new place), anything else can be tried again, and anything can be taken out of the folder.
- **Tidy all with your trackpad.** Turn it on in Settings → Keyboard shortcuts, then tap the trackpad twice with four fingers to tidy, like the shortcut.

### Fixed
- Unpack no longer opens tabs twice. When Chrome was slow to start Stashd's helper (in a new window, say), Stashd took it for missing and opened every tab again; now it waits for the helper, and anything it tries a second time is checked against what's already open first.
- A folder where nothing could reopen no longer shows as "Open now".

## 1.8.1 (2026-11-09)

### Changed
- Tidy all's Desk clear card is a little show: what you closed lines up beside the Stashd folder (the real app icons, then sites), each one arcs into it and the folder bounces as it lands, then the memory freed rolls up where they were. One short line and Undo below, and it's gone after 5 seconds (pointing at it holds it).

## 1.8.0 (2026-11-09)

### Added
- **Tidy all shows the memory it gives back.** Before you tidy, the desk shows a bar of your Mac's memory with the part the quitting apps are using marked ("About 2.1 GB to free", each app's share listed when you look closer), and the button says how much. Afterwards the Desk clear card rolls up how much was actually freed (measured before and after, the same Memory Used figure as Activity Monitor), the bar drains to what's in use now, and it keeps a running total of everything Tidy all has freed.

### Fixed
- Tidy all's desk shows every app's real icon (Spotify, Figma and others showed a letter), and a tab whose site has no logo shows its browser's icon.
- Tidy all's desk says what it'll quit and close, in two short lines ("Quits Chrome, Slack and 5 more apps", "Closes Hacker News and 4 more tabs"); point at any icon to see its name.

## 1.7.0 (2026-11-09)

### Changed
- **Tidy all shows your desk first.** Pressing it opens a calm summary: what's going (as a fan of icons), how many things, where they go, and one **Tidy up** button (or Return). **See what's going** shows the piles (into each folder, the Break shelf, closing, apps quitting, staying open), and any pile opens to every tab, with **Keep open** on each. Afterwards a **Desk clear** card says how much memory it freed, where things went and what's ready next time, with Undo. The shortcut still tidies straight away.

## 1.6.0 (2026-11-08)

### Added
- **Add any app or site to Your places.** On the Break page, Add now searches as you type: "spo" finds Spotify, the app on your Mac and the website. Pick one with a click or the arrow keys and Return, or type any web address. An app place opens the app.

### Fixed
- Ask Stashd follow-ups remember the question before: "and what's next there?" now knows which folder you mean.
- Ask Stashd changes: if one fails you can press it again (it no longer says it expired), Cancel waits while a change runs, and Undo shows when it's working or can't undo.
- Starting a new chat while Ask Stashd is still thinking no longer adds the late answer to the old chat.
- The welcome no longer turns on Stashd AI when you press Return through the steps (that one needs a click), and its "Try it" step only celebrates a folder you really just saved.
- An error in the menu bar panel or a folder page goes away once things work again, instead of staying until you restart.
- The panel's Ask Stashd answer stays when you open a folder from it and come back; Escape clears it first, and it's gone the next time you open the panel.
- When every folder is finished, the panel says so instead of showing an empty space.
- Pressing Return twice on "Taking a break?" puts the videos away once, and videos you unticked last time start ticked again.
- Adding a name to a project no longer clears what you typed when it didn't work.
- Forget my history works when you only have Ask Stashd chats to clear.
- Ask Stashd's suggested questions no longer keep naming the same folder: they take turns across all your folders and never name one twice in a row.
- Adding a 13th place no longer silently does nothing: Stashd says the limit is 12 and the Add button steps aside until you remove one.

## 1.5.0 (2026-11-08)

### Added
- **A welcome for new people.** The first time Stashd opens, five short steps: what it does, the permissions it needs (all at once, each with its reason and whether it's already allowed), Stashd AI (a plain yes or no, saying what it sends), the Chrome helper, and a first ⌃S. Any step can be skipped, and Settings → Startup shows it again.
- **Stashd updates itself.** It quietly downloads new versions and installs them the next time it starts; when one is ready, the menu bar panel shows **Restart to update**. Settings has an Updates section with **Check now**. It only asks GitHub which version is the latest, and only installs a version signed by Stashd.
- Tidy all asks one quick question in a small menu: **Keep what you're on** (the tab, document or app in front, like Claude, which stays open) or **Close everything**. Your last choice is marked, Return picks it, and the shortcut uses it.
- Stashd learns which sites are for breaks, even ones it has never heard of: your Mac's own model reads the page title (so a streaming site like 1Flex goes to Continue watching, not your work folder). Sites it can't tell go to Stashd AI if you turned it on, just the site and a few page titles. Forget my history clears what it learned.
- Ask Stashd keeps your chats: past chats are listed on the Ask Stashd page, open again with every question and answer, and you can carry on or delete them. New chat starts fresh. They stay on this Mac, and Forget my history clears them.
- Ask Stashd has a bit of personality: under each answer, a short friendly line from Stashd (in italics, so the facts stay easy to spot).
- **Ask Stashd**: ask about your own work in plain words: what you were doing on a folder, where you saved something, what you worked on this week, or change a folder ("add this tab to Stashd project", rename, pin, move, unpack). Answers point at your real folders and tabs; changes run only when you press the button, and can be undone. In the Stashd window (Ask Stashd) and in the menu bar panel (press /). Uses Stashd AI.
- **Automatic saving**: Stashd saves your work by itself when you move on to something else (without asking; a small card says so, with a quiet Pack up if you're done), and when your Mac sleeps, locks or shuts down, or you walk away (it saves first and tells you when you're back, with Remove). After a restart it offers to bring your work back. It never closes anything, keeps only the latest automatic save per folder, and learns which cards you don't want. Settings → General → Automatic saving.
- **Stashd's memory**: Stashd now remembers when you saved and what was open (titles and sites, never page contents), on this Mac only, so it can learn your habits. Settings → Privacy shows how much it remembers and has **Forget my history**.
- Stashd now runs on Intel Macs, with their own download, Stashd-Intel.dmg. It opens on macOS 13 and later; sorting tabs by meaning needs macOS 14 on Apple silicon and 13.4 on Intel, and older Macs sort by words.
- Brave, Microsoft Edge and Vivaldi work like Chrome: Stashd saves, closes and reopens their tabs. Each has a switch in Settings → Privacy.
- Your saves are safer: Stashd copies them before an update changes anything (it keeps the last 5), and repairs a damaged save from its last good copy instead of losing it. The menu bar tells you when it has.
- **Stashd AI** (Settings → Briefs): AI briefs and folder names for everyone, free with a daily limit, no Claude key needed. It's off until you turn it on, and Settings says exactly what it sends.
- Tidy all has a shortcut: ⌃⇧S (change it in Settings).
- Continue watching: streams (Twitch, Kick, and YouTube streams that are live) get a red Live tag.
- Websites you add to Your places on the Break page show their own logo instead of a letter.
- Break page: in Edit, pick up a place's logo and drag it where you like, like the iPhone Home Screen: it lifts, the others slide aside, and it settles into its spot (arrow keys work too). The remove badge is a small frosted minus.
- Break page: Edit next to Your places (or right-click a place) lets you rename places by typing over their names, or remove them with the − badge. Done finishes.

### Changed
- Ask Stashd in the menu bar panel is one slim row now: the Stashd folder asks you a question to try, a different one every few seconds (some to make you smile), using your own folder names. Return asks it, Tab lets you edit it, or type your own. The folder watches you type, wonders while it thinks, and smiles when the answer comes.
- Pack up and Tidy all now look and feel the same: the windows go into one tray, dip, and arc into the menu bar icon, which winks as they land with a burst of sparks and a soft two-note chime. Every app Tidy all quits is part of it (nothing vanishes on its own), and the toast counts up what was put away.
- Continue watching shows there's more to the side: the next video peeks in, the edge fades only where there's more, round arrows page through it, the count sits next to the title, and the first time the row nudges sideways to show it scrolls.
- Tidy all and Pack up look calmer and more polished: your apps settle into one frosted tray (one icon per app with a count, like Chrome 8), gather into a stack, sweep in a curve into the menu bar icon and land with a soft ripple. Unpacking plays it in reverse.
- Deleting a folder also removes what Stashd's memory held about it.
- Apple silicon and Intel Macs sort your tabs the same way.
- Briefs are written the same way on every Mac: Apple Intelligence no longer writes them. Your own Claude key is now an optional extra.
- Tidy all is quicker and calmer: the panel gets out of the way at once, the menu bar says "Tidying…" until it's done, and a Chrome window whose tabs all go closes in one step instead of tab by tab.
- Stashd no longer opens a quick hidden tab in Chrome to see how far into a video you got or which tab group a tab is in: the Chrome extension tells it directly (restart Chrome once after updating).
- Continue watching only shows things you can carry on with (a video, an episode, a stream, a song); home pages like YouTube's or Netflix's front page stay in your places instead.
- Break page: hovering a place lifts its icon gently instead of showing a bright white box.
- A little more room between the Stashd logo and the Work / Break switch.
- Hovering a folder: the pin and trash buttons slide in smoothly instead of snapping in.
- Break page: your places are bigger tiles at the top, and Continue watching is a row of video thumbnails you scroll sideways, showing how far you got and how much is left.

### Fixed
- Typing in Ask Stashd in the menu bar panel looks cleaner: a long question wraps onto a second line instead of scrolling out of sight, a round send button appears once you type, and the box's outline is softer.
- Packing up or tidying a folder no longer leaves another copy of its Chrome tab group in your bookmarks bar each time: Stashd takes the tabs out of the group before closing them, so Chrome lets the group go.
- YouTube Studio, Twitch's developer console, TikTok Ads Manager and other work parts of break sites stay with your work instead of counting as breaks.
- A folder named after a tab no longer ends with a stray colon.
- Tidy all no longer skips the next Chrome window (and leaves its tabs open) after closing a whole window.
- How far into a video you got now reaches Stashd even if you leave the tab open, and YouTube's hover previews on its home page are no longer counted as watching.
- The Break page no longer shows a "no such file or directory" error when two changes are saved at the same moment.
- Watching a video full screen in Chrome no longer drops you out of full screen when you close another video.

## 1.4.0 (2026-11-04)

### Added
- **Break**: a Work / Break switch in the menu bar panel. Tidy all puts what you were watching on your Break shelf (episodes of a show together), next to your places (YouTube, Netflix, Spotify, or your own). It asks once which browser to open them in.
- Continue watching knows when you finished a video (with Stashd's Chrome extension) and leaves it out.
- **Continue watching** on the Break side: videos you close (or Tidy all puts away) land there, the latest one up top with Resume. Remove anything with one click; one-off clips you never came back to fade after a week, shows and things you reopen stay a month.
- ⌃S with only videos or shows open (no work) offers "Taking a break?": Enter puts them on Continue watching and closes the tabs.
- ⌃S keeps break tabs (a Shark Tank episode, a game score) out of your work, unless they're about the project, like a tutorial.
- A gentle nudge to Tidy all when apps have sat open unused for a while.
- **Tidy all**, in the menu bar panel: saves the folders you're working in, adds a stray tab to another folder only when it clearly belongs there, closes everything else and quits every app except Claude. Anything unsaved still asks first.
- **Recently closed**: what Tidy all closed stays for 10 minutes, in the menu bar panel and as a page in the Stashd window, with Reopen for each item or all of them.
- **Pin a folder**, and press **⌃O** to open it. With nothing pinned, ⌃O opens the folder you opened last.
- **"You were working on this"**: open a tab or file from a packed folder yourself, and Stashd offers to Unpack the rest.
- **Chrome tab groups**: Unpack puts a folder's Chrome tabs in a group named after the folder (needs Stashd's Chrome extension, Settings > Privacy).
- **Rename in the menu bar panel**: double-click a folder's name.
- **Merge look-alike folders** from the menu bar panel: Stashd spots two folders that are the same work and offers to merge them, keeping the one you pinned or named.
- **Open one thing**: under What's inside, click a tab's or file's name to open just that one (the tick still chooses what Unpack brings back).
- **Remove things from a folder**: hover over an item under What's inside and click the trash, with Undo. A removed tab also leaves the folder's Chrome tab group.
- Save the Claude or ChatGPT chat you're in, and reopen that exact Claude chat on Unpack.
- Unpack by type (files, tabs, apps, chats) or item by item, with Open everything beside it.
- Real Mac icons for files, apps and browser tabs.

### Changed
- Break page: YouTube Shorts, Instagram and Facebook Reels and TikToks no longer show up in Continue watching; only longer videos do.
- Break page: Your places are now at the top. Continue watching shows your last three videos with a round play button; "See all" next to the heading opens the rest in a short list and "Show less" closes it. Keeps at most 12.
- **Project cards**: each folder knows what its project is about across all its saves (names, websites, places on your Mac), and ⌃S matches new things against that. See and edit it on the folder's page in the Stashd window.
- Smarter ⌃S: Stashd reads a page's site and web address (not only its title), and a Chrome tab in a folder's tab group counts as that folder's. A new folder takes the name of the tab group its tabs share.
- Briefs are structured and plain: a headline, then Last on, So far and Next.
- A folder's tabs open together in a new window of the browser they came from, and never twice.
- Pack up quits the folder's apps like ⌘Q; Claude and ChatGPT are only hidden.
- Folder rows are calmer: pin and delete appear on hover, the pinned folder is highlighted, and finished folders live in the Stashd window.

### Fixed
- Typing in Ask Stashd in the menu bar panel looks cleaner: a long question wraps onto a second line instead of scrolling out of sight, a round send button appears once you type, and the box's outline is softer.
- Packing up or tidying a folder no longer leaves another copy of its Chrome tab group in your bookmarks bar each time: Stashd takes the tabs out of the group before closing them, so Chrome lets the group go.
- Pressing ⌃S while watching a video no longer makes a new folder out of it when nothing else belongs with it; it offers to put the video on your Break shelf, with "Save as a folder instead" when the video is work.
- ⌃S picks the right folder when the tab you're on clearly belongs to it (same site, its name), even with lots of unrelated tabs open next to it. Before, it offered a new folder.
- A Claude or ChatGPT chat open on its own no longer makes ⌃S guess a folder, and unticking a chat is remembered straight away.
- Enter in the save box works wherever the focus is.
- Something you left out of a folder before is no longer hidden for good: it's offered unticked, under "looks related" when it clearly fits.
- Tabs that redirect after Unpack (sign-in pages) still count as the folder's, so Pack up closes them.
- Finished folders you open again can be packed up.

## 1.3.36 (2026-10-26)

First version shared on GitHub.
