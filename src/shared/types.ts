// Types shared by the main process, the preload bridge and the React UI.

export type BrowserName = 'chrome' | 'arc' | 'safari';
export type Accent = 'indigo' | 'teal' | 'coral';
export type Route = 'panel' | 'save' | 'main' | 'overlay' | 'naming' | 'toast';

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
  accent: Accent;
  /** The last choice of the "Tidy up" toggle. Off until the user turns it on. */
  tidyUp: boolean;
  aiModel: string;
  aiDisclosureAccepted: boolean;
  /** Light glass by default; dark, or follow the Mac. */
  appearance: Appearance;
  /** The soft whoosh when windows fly into the menu bar. */
  sounds: boolean;
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
  window?: number;
  /** For tabs: the active tab of its window. For docs: the front document of its app. */
  active?: boolean;
  /** A document that has never been saved (Word "Document1"). */
  untitled?: boolean;
  /** Part of the job but not open when it was saved (closed by accident, say). Kept, not closed by Tidy up. */
  notOpen?: boolean;
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

export interface Brief {
  source: 'claude' | 'apple' | 'basic';
  /** One or two plain sentences. */
  sentence: string;
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
}

export interface JobSummary {
  id: string;
  name: string;
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

/** How much of a folder is open right now (tabs and files; apps don't count). */
export interface OpenState {
  open: number;
  total: number;
}

/** What the save box shows. */
export interface SavePreview {
  /** The job this save updates, if any (the open job, or a strong match). */
  jobId: string | null;
  jobName: string | null;
  /** True when jobId came from a match, not from a job you opened. Then the box asks. */
  isSuggestion: boolean;
  suggestedName: string;
  sure: Item[];
  /** Opened since you unpacked this job: likely part of it. Highlighted; the clear matches are in `sure`. */
  likely: Item[];
  maybe: Item[];
  /** In the job before but not open now. Kept unless you untick them. */
  kept: Item[];
  hiddenCount: number;
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
  appleAi: 'available' | 'unavailable' | 'unknown';
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
}

export interface OverlayPlay {
  items: FlyItem[];
  /** Where the menu bar icon is, inside the overlay window. */
  target: { x: number; y: number };
  /** The screen size, so the layout never depends on a stale window size. */
  size: { width: number; height: number };
  reverse: boolean;
  sound: boolean;
}

export interface ToastInfo {
  title: string;
  detail: string;
  canUndo: boolean;
  /** How the folder in the toast looks: asleep after packing, wide-eyed when things come back. */
  mood?: 'awake' | 'sleep' | 'curious' | 'wide';
}
