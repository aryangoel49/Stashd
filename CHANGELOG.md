# Changelog

What changed in each version of Stashd, for people using it. Versions follow semantic versioning:
a new feature moves the middle number (1.4.0), a release of only bug fixes moves the last (1.4.1).

## Unreleased (1.4.0)

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
- Break page: Your places are now at the top. Continue watching shows your last three videos with a round play button; "See all" next to the heading opens the rest in a short list and "Show less" closes it. Keeps at most 12.
- **Project cards**: each folder knows what its project is about across all its saves (names, websites, places on your Mac), and ⌃S matches new things against that. See and edit it on the folder's page in the Stashd window.
- Smarter ⌃S: Stashd reads a page's site and web address (not only its title), and a Chrome tab in a folder's tab group counts as that folder's. A new folder takes the name of the tab group its tabs share.
- Briefs are structured and plain: a headline, then Last on, So far and Next.
- A folder's tabs open together in a new window of the browser they came from, and never twice.
- Pack up quits the folder's apps like ⌘Q; Claude and ChatGPT are only hidden.
- Folder rows are calmer: pin and delete appear on hover, the pinned folder is highlighted, and finished folders live in the Stashd window.

### Fixed
- Pressing ⌃S while watching a video no longer makes a new folder out of it when nothing else belongs with it; it offers to put the video on your Break shelf, with "Save as a folder instead" when the video is work.
- ⌃S picks the right folder when the tab you're on clearly belongs to it (same site, its name), even with lots of unrelated tabs open next to it. Before, it offered a new folder.
- A Claude or ChatGPT chat open on its own no longer makes ⌃S guess a folder, and unticking a chat is remembered straight away.
- Enter in the save box works wherever the focus is.
- Something you left out of a folder before is no longer hidden for good: it's offered unticked, under "looks related" when it clearly fits.
- Tabs that redirect after Unpack (sign-in pages) still count as the folder's, so Pack up closes them.
- Finished folders you open again can be packed up.

## 1.3.36 (2026-10-26)

First version shared on GitHub.
