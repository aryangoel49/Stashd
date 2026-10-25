// Types shared by the main process, the preload bridge and the React UI.

export type BrowserName = 'chrome' | 'arc' | 'safari';

export interface Project {
  id: string;
  name: string;
  path: string;
}

export interface Settings {
  projects: Project[];
  browsers: Record<BrowserName, boolean>;
  /** Entries with a dot are domains (subdomains match too). Entries without a dot are keywords matched anywhere in host + path. */
  excludedDomains: string[];
  keepQueryStrings: boolean;
  shellHistory: boolean;
  lookbackHours: number;
  retentionCount: number;
  retentionDays: number;
  autoSnapshot: boolean;
  launchAtLogin: boolean;
  openFilesInVSCode: boolean;
  shortcutSave: string;
  shortcutRecap: string;
  aiRecap: boolean;
  aiModel: string;
  aiDisclosureAccepted: boolean;
}

export type SnapshotTrigger = 'manual' | 'lock' | 'sleep' | 'idle';

export interface FileEntry {
  /** Path relative to the project folder, always with forward slashes. */
  path: string;
  mtime: string;
  size: number;
}

export interface Commit {
  hash: string;
  subject: string;
  date: string;
}

export interface GitState {
  branch: string;
  head: string | null;
  status: string[];
  diffStat: string;
  commits: Commit[];
  stashes: string[];
}

export interface Tab {
  browser: BrowserName;
  window: number;
  title: string;
  url: string;
  active: boolean;
}

export interface CollectorError {
  collector: string;
  message: string;
  /** Set when macOS Automation permission was denied for a browser. */
  permissionDenied?: boolean;
}

export interface Snapshot {
  version: 1;
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  createdAt: string;
  auto: boolean;
  trigger: SnapshotTrigger;
  note: string;
  files: FileEntry[];
  git: GitState | null;
  tabs: Tab[];
  shell: string[] | null;
  errors: CollectorError[];
}

export interface SnapshotSummary {
  id: string;
  projectId: string;
  createdAt: string;
  auto: boolean;
  trigger: SnapshotTrigger;
  note: string;
}

export interface ProjectListItem extends Project {
  lastSnapshotAt: string | null;
  snapshotCount: number;
  exists: boolean;
}

export interface Changes {
  newCommits: Commit[];
  branchChanged: { from: string; to: string } | null;
  editedAfter: FileEntry[];
  missingFiles: string[];
  stillUncommitted: string[];
  /** True when there was no git info to compare. */
  noGit: boolean;
}

export interface RecapItem {
  kind: 'tab' | 'file';
  key: string;
  label: string;
  detail: string;
  /** For tabs: the URL. For files: the path relative to the project. */
  target: string;
  browser?: BrowserName;
  suggested: boolean;
}

export interface Recap {
  source: 'local' | 'ai';
  text: string;
  /** Present when an AI recap was asked for but failed. */
  aiError?: string;
}

export interface RecapView {
  snapshot: Snapshot;
  changes: Changes;
  recap: Recap;
  items: RecapItem[];
}

export interface RestoreRequest {
  projectId: string;
  snapshotId: string;
  keys: string[];
}

export interface RestoreResult {
  opened: number;
  missing: string[];
  failed: string[];
}

export interface AppInfo {
  version: string;
  hasApiKey: boolean;
  vscodeAvailable: boolean;
  platform: string;
}

export type Route = 'main' | 'quicksave' | 'settings';
