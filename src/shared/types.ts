// Types shared by the main process, the preload bridge and the React UI.

export type BrowserName = 'chrome' | 'brave' | 'edge' | 'vivaldi' | 'arc' | 'safari';
export type Accent = 'indigo' | 'teal' | 'coral';
export type Route = 'panel' | 'save' | 'main' | 'overlay' | 'naming' | 'toast' | 'welcome';

export interface Settings {
  browsers: Record<BrowserName, boolean>;
  /** Sites never saved at all (privacy). Entries with a dot are domains, others are keywords. */
  excludedDomains: string[];
  /** Sites that are never part of a job and never closed (Gmail, Calendar…). */
  lifestyleSites: string[];
  /** Apps that are never part of a job and never closed (Spotify, Messages…). */
  lifestyleApps: string[];
  keepQueryStrings: boolean;
  launchAtLogin: boolean;
  shortcutSave: string;
  shortcutRecap: string;
  /** Opens the pinned folder, or the one opened last. */
  shortcutOpen: string;
  /** Tidy all: save open folders and close everything. */
  shortcutTidy: string;
  accent: Accent;
  /** The last choice of the "Tidy up" toggle. Off until the user turns it on. */
  tidyUp: boolean;
  aiModel: string;
  aiDisclosureAccepted: boolean;
  /** Stashd AI writes briefs and folder names (through Stashd's server). Off until you agree. */
  stashdAi: boolean;
  /** Light glass by default; dark, or follow the Mac. */
  appearance: Appearance;
  /** The soft whoosh when windows fly into the menu bar. */
  sounds: boolean;
  /** Stashd saves your work by itself when you move on, close the lid, shut down or walk away. */
  autoSave: boolean;
  /** Helpful: short cards ("Save it?", "Saved before your Mac slept"). Quiet: save, never speak. */
  autoSaveTalk: 'helpful' | 'quiet';
  /** Tidy all: keep the tab (or window) you're on open, or close everything. The last choice is kept. */
  tidyKeep: TidyKeep;
  /** The welcome (first run) has been seen, or skipped. */
  welcomed: boolean;
}

export type TidyKeep = 'front' | 'all';

/** What Tidy all would leave open with "Keep this tab": the tab or window in front. */
export interface TidyFront {
  label: string;
  app: string;
  kind: Item['kind'];
  icon: string | null;
}

export type Appearance = 'light' | 'dark' | 'system';

/** Something a job can hold and reopen. */
export interface Item {
  /** Stable identity: "tab:<url>", "doc:<path>", "untitled:<app>:<name>", "folder:<path>", "app:<name>". */
  key: string;
  kind: 'tab' | 'doc' | 'folder' | 'app';
  /** What the user sees: a tab title, a file name, an app name. */
  label: string;
  /** Small grey detail: the site, the folder, the app. */
  detail: string;
  /** The app this lives in ("Google Chrome", "Microsoft Word"). */
  app: string;
  url?: string;
  path?: string;
  browser?: BrowserName;
  /** Browser window number, for tabs. */
  /** The Chrome tab group it's in right now (its title), if any. Only meaningful while it's open. */
  group?: string;
  window?: number;
  /** For tabs: the active tab of its window. For docs: the front document of its app. */
  active?: boolean;
  /** A document that has never been saved (Word "Document1"). */
  untitled?: boolean;
  /** Part of the job but not open when it was saved (closed by accident, say). Kept, not closed by Tidy up. */
  notOpen?: boolean;
  /** For a chat app (Claude, ChatGPT): the chat that was open. `url` names the exact chat when the app shows one;
   *  `excerpt` is the end of the conversation on screen (secrets removed), so the brief knows where it got to. */
  chat?: { title: string; url?: string; excerpt?: string };
  /** For tabs: where this address went after Unpack opened it (a login page, a redirect), as loose keys.
   *  The tab still counts as this item there, so Pack up closes it and the folder shows as open. */
  seenAs?: string[];
}

/** How Unpack groups things for "open by type". */
export type OpenKind = 'doc' | 'tab' | 'app' | 'chat';

export function openKindOf(item: Item): OpenKind {
  if (item.kind === 'tab') return 'tab';
  if (item.kind === 'app') return item.chat ? 'chat' : 'app';
  return 'doc';
}

export interface CollectorError {
  collector: string;
  message: string;
  permissionDenied?: boolean;
  /** A short technical reason, to help fix problems. */
  detail?: string;
}

/** Everything that was open at one moment. */
export interface Capture {
  at: string;
  /** App names from front to back (from window order). */
  appOrder: string[];
  frontApp: string | null;
  items: Item[];
  errors: CollectorError[];
}

export interface BriefSections {
  lastOn: string;
  soFar?: string;
  next?: string;
}

export interface Brief {
  source: 'claude' | 'apple' | 'basic';
  /** The headline: one short sentence (older briefs: one or two sentences, and no sections). */
  sentence: string;
  /** The structured part: what you were on last, how far it got, and what's next. */
  sections?: BriefSections;
  /** Short phrases inside the sentence to show in the accent colour. */
  highlights: string[];
  /** Item keys for "Pick up where I left off". */
  needed: string[];
  createdAt: string;
  /** Why the AI brief failed, when it fell back to a simpler one. */
  fallbackReason?: string;
}

export interface Feedback {
  helpful: boolean;
  comment?: string;
  at: string;
}

/** One save of a job (a history entry). */
export interface SaveEntry {
  version: 2;
  id: string;
  jobId: string;
  savedAt: string;
  note: string;
  items: Item[];
  /** The item that was in front when you saved: "what you were on last". */
  frontKey: string | null;
  /** App names front to back at save time. */
  appOrder: string[];
  tidied: boolean;
  /** Saved by Stashd itself (the lid closed, you moved on…). Each folder keeps only its latest automatic save. */
  auto?: boolean;
  errors: CollectorError[];
  brief?: Brief;
  feedback?: Feedback;
}

export interface LearnedPrefs {
  /** How many saves in a row the user unticked this item. */
  hide: Record<string, number>;
  /** How many times the user added this item from "Not sure". */
  add: Record<string, number>;
  /** Titles you left out of this job (newest last), so similar things start unticked. */
  leftOut?: string[];
  /** Sites you left out of this job, and how many saves in a row. */
  sitesOut?: Record<string, number>;
}

export interface Job {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  done: boolean;
  prefs: LearnedPrefs;
  /** You've given it a name yourself. */
  renamed?: boolean;
  /** Pinned: the folder ⌃O opens (only one at a time). */
  pinned?: boolean;
  /** When you last opened it (Unpack), for ⌃O when nothing is pinned. */
  openedAt?: string;
  /** What the project is about, rebuilt after each save (see jobs/card.ts). */
  card?: ProjectCard;
  /** Your changes to the card: names you added, and names, sites or places you took out. */
  cardEdits?: { add: string[]; hide: string[] };
}

/** A folder's project card: what Ctrl+S matches new things against, besides the latest save. */
export interface ProjectCard {
  /** Words that keep coming back in this project (and its name). */
  names: string[];
  /** Names you added yourself. */
  added: string[];
  sites: string[];
  /** Folders on your Mac the project's files live in. */
  places: string[];
}

export interface JobSummary {
  id: string;
  name: string;
  renamed: boolean;
  pinned: boolean;
  updatedAt: string;
  done: boolean;
  /** First words of the latest brief, for the menu. */
  hint: string;
  itemCount: number;
  current: boolean;
  /** What the job holds most of, for its icon. */
  icon: 'doc' | 'tab' | 'folder' | 'app' | 'stack';
  /** The first few things inside, for the little icon strip on folder cards. */
  preview: Item[];
  counts: { tabs: number; files: number; apps: number };
}

/** A proposal to tidy folders: two folders that are one piece of work, or something in the wrong folder. */
export type Suggestion =
  | { kind: 'merge'; id: string; from: string; fromName: string; into: string; intoName: string; score: number; why: string[] }
  | { kind: 'move'; id: string; itemKey: string; itemLabel: string; item: Item; from: string; fromName: string; to: string; toName: string; score: number; why: string[] };

/** How much of a folder is open right now (tabs and files; apps don't count). */
export interface OpenState {
  open: number;
  total: number;
}

/** Most of a folder's tabs and files are open right now (you opened them yourself, say), so it counts as open. */
export function mostlyOpen(state: OpenState | undefined): boolean {
  return !!state && state.total > 0 && state.open / state.total >= 0.6;
}

/** What the save box shows. */
export interface SavePreview {
  /** The job this save updates, if any (the open job, or a strong match). */
  jobId: string | null;
  jobName: string | null;
  /** True when jobId came from a match, not from a job you opened. Then the box asks. */
  isSuggestion: boolean;
  /** When that job was last saved, and how many ticked things weren't in it then. */
  lastSavedAt: string | null;
  newCount: number;
  suggestedName: string;
  sure: Item[];
  /** Opened since you unpacked this job: likely part of it. Highlighted; the clear matches are in `sure`. */
  likely: Item[];
  maybe: Item[];
  /** In the job before but not open now. Kept unless you untick them. */
  kept: Item[];
  hiddenCount: number;
  /** Break things left open (YouTube, Netflix…) because they aren't about this work. */
  breakCount: number;
  /** Nothing to work on is open, only these videos or shows: ⌃S offers to put them on the Break shelf. */
  onlyBreaks: Item[];
  frontKey: string | null;
  tidyUp: boolean;
  errors: CollectorError[];
  /** Why each item is where it is, in plain words (tooltips). */
  why: Record<string, string>;
  /** Your jobs for the "Save to" picker, best match first. */
  jobOptions: JobOption[];
}

export interface JobOption {
  id: string;
  name: string;
  /** How well what's open fits this job. */
  match: 'strong' | 'some' | 'none';
  current: boolean;
}

export interface SaveRequest {
  /** Update this job, or null for a new job. */
  jobId: string | null;
  name: string;
  note: string;
  keys: string[];
  tidy: boolean;
  /** Stashd saving by itself: it leaves your current folder, Tidy up choice and learning alone. */
  auto?: boolean;
}

export interface SaveResult {
  jobId: string;
  entryId: string;
  /** Untitled documents that need a name before tidying. */
  needsNaming: Item[];
}

export interface BriefView {
  job: Job;
  entry: SaveEntry;
  brief: Brief;
  history: { id: string; savedAt: string; note: string }[];
}

export interface OpenResult {
  opened: number;
  alreadyOpen: number;
  missing: string[];
  failed: string[];
}

export interface AppInfo {
  version: string;
  hasApiKey: boolean;
  shortcutErrors: string[];
}

/** Untitled documents to name before tidying up. */
export interface NamingRequest {
  jobName: string;
  items: { key: string; app: string; label: string; suggested: string }[];
  folder: string;
}

/** One flying item in the tidy-up animation. */
export interface FlyItem {
  label: string;
  /** data: URL of the app or file icon, or null for a plain card. */
  icon: string | null;
  /** How many things this icon stands for (8 Chrome tabs are one Chrome icon with 8). */
  count?: number;
}

export interface OverlayPlay {
  items: FlyItem[];
  /** Where the menu bar icon is, inside the overlay window. */
  target: { x: number; y: number };
  /** The screen size, so the layout never depends on a stale window size. */
  size: { width: number; height: number };
  reverse: boolean;
  sound: boolean;
  /** How many things in all (the icons are grouped by app). */
  total?: number;
}

export interface ToastInfo {
  title: string;
  /** How many things were put away: counts up beside the title. */
  count?: number;
  detail: string;
  canUndo: boolean;
  /** How the folder in the toast looks: asleep after packing, wide-eyed when things come back. */
  mood?: 'awake' | 'sleep' | 'curious' | 'wide';
  /** A button that does something else than Undo (Unpack a folder you seem to be back on). */
  action?: string;
  /** The action is an offer on the side, not the point of the card: shown as a quiet text button. */
  subtle?: boolean;
  /** How long it stays (ms), shown as a thin line that runs out; pointing at the card holds it. */
  ms?: number;
}

/** A place on the Break shelf you go to often (YouTube, Netflix…). */
export interface BreakPlace {
  name: string;
  url: string;
}

/** Something you were watching or listening to, put on the shelf by Tidy all. */
export type BreakItem = Item & {
  /** When it last came to the shelf (you closed it, or Tidy all put it here). */
  savedAt?: string;
  /** When you last opened it from the shelf, and how often you have. */
  openedAt?: string;
  opens?: number;
  /** How far into the video you were when it closed, and its length, in seconds (from the Chrome extension). */
  progress?: { t: number; d: number };
};

/** The Break shelf: what you were watching, your places, and where breaks open. */
export interface BreakShelf {
  items: BreakItem[];
  places: BreakPlace[];
  /** Where break things open: a browser, or a clean window of its own. Null until you choose. */
  browser: BrowserName | 'window' | null;
}

// ---------- Ask Stashd ----------

/** Something an answer points at: a folder, or one thing inside a folder (or open right now). */
export type AskRef =
  | { kind: 'folder'; jobId: string; name: string; meta: string }
  | { kind: 'item'; jobId: string | null; folder: string | null; item: Item };

export type AskActionType = 'add' | 'remove' | 'move' | 'rename' | 'pin' | 'unpin' | 'unpack' | 'done';

/** A change Ask Stashd proposes. It runs only when you confirm it (by its id), and can be undone. */
export interface AskAction {
  id: string;
  type: AskActionType;
  jobId: string;
  folder: string;
  item?: Item;
  toJobId?: string;
  to?: string;
  name?: string;
}

export interface AskAnswer {
  question: string;
  answer: string;
  /** A short friendly line under the answer (personality, never facts). */
  aside?: string;
  highlights: string[];
  refs: AskRef[];
  action: AskAction | null;
  /** Minutes and saves per folder this week, when the question is about time. */
  week?: { name: string; minutes: number; saves: number }[];
  /** Questions left today, when Stashd AI says. */
  left?: number;
  /** From a past chat: its proposed change can't run any more. */
  past?: boolean;
}

/** A past Ask Stashd conversation, for the list. */
export interface AskChat {
  id: number;
  title: string;
  updated: string;
  turns: number;
}

/** Why Ask Stashd couldn't answer: Stashd AI is off, today's limit is used, or something went wrong. */
export interface AskProblem {
  problem: 'off' | 'limit' | 'error';
  message: string;
}

/** Stashd keeping itself up to date (src/main/updater.ts). */
export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  /** The version running now. */
  current: string;
  /** The newer version being downloaded or ready. */
  available?: string;
  /** It can replace itself (false: Stashd isn't somewhere it can write, so the download page is offered). */
  canInstall?: boolean;
  checkedAt?: string;
  error?: string;
}

/** One permission in the welcome's checklist (src/main/setup.ts). */
export interface SetupItem {
  /** A bundle id, or "accessibility". */
  id: string;
  name: string;
  /** Why Stashd needs it, in a few words. */
  why: string;
  kind: 'automation' | 'accessibility';
  /** allowed; denied (turned off in System Settings); ask (not asked yet); later (asked the first time you use the app). */
  status: 'allowed' | 'denied' | 'ask' | 'later';
}
