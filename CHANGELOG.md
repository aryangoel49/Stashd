# Changelog

What changed in each version of Stashd, for people using it. Versions follow semantic versioning:
a new feature moves the middle number (1.4.0), a release of only bug fixes moves the last (1.4.1).

## Unreleased (1.4.0)

### Added
- **Tidy all**, in the menu bar panel: saves the folders you're working in, adds a stray tab to another folder only when it clearly belongs there, closes everything else and quits every app except Claude. Anything unsaved still asks first.
- **Recently closed**: what Tidy all closed stays for 10 minutes, in the menu bar panel and as a page in the Stashd window, with Reopen for each item or all of them.
- **Pin a folder**, and press **⌃O** to open it. With nothing pinned, ⌃O opens the folder you opened last.
- **"You were working on this"**: open a tab or file from a packed folder yourself, and Stashd offers to Unpack the rest.
- **Chrome tab groups**: Unpack puts a folder's Chrome tabs in a group named after the folder (needs Stashd's Chrome extension, Settings > Privacy).
- **Rename in the menu bar panel**: double-click a folder's name.
- **Merge look-alike folders** from the menu bar panel: Stashd spots two folders that are the same work and offers to merge them, keeping the one you pinned or named.
- **Remove things from a folder**: hover over an item under What's inside and click the trash, with Undo. A removed tab also leaves the folder's Chrome tab group.
- Save the Claude or ChatGPT chat you're in, and reopen that exact Claude chat on Unpack.
- Unpack by type (files, tabs, apps, chats) or item by item, with Open everything beside it.
- Real Mac icons for files, apps and browser tabs.

### Changed
- Briefs are structured and plain: a headline, then Last on, So far and Next.
- A folder's tabs open together in a new window of the browser they came from, and never twice.
- Pack up quits the folder's apps like ⌘Q; Claude and ChatGPT are only hidden.
- Folder rows are calmer: pin and delete appear on hover, the pinned folder is highlighted, and finished folders live in the Stashd window.

### Fixed
- Something you left out of a folder before is no longer hidden for good: it's offered unticked, under "looks related" when it clearly fits.
- Tabs that redirect after Unpack (sign-in pages) still count as the folder's, so Pack up closes them.
- Finished folders you open again can be packed up.

## 1.3.36 (2026-10-26)

First version shared on GitHub.
