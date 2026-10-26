// The only bridge between the UI and the main process. The UI gets this typed `api`
// object and nothing else: no Node, no Electron, no file access.

import { contextBridge, ipcRenderer } from 'electron';
import type { AppInfo, BriefView, Job, JobSummary, OpenResult, OverlayPlay, SavePreview, SaveRequest, SaveResult, Settings, ToastInfo, OpenState, Suggestion } from './shared/types';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function on(channel: string, cb: (...args: unknown[]) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  appInfo: () => invoke<AppInfo>('app:info'),
  getSettings: () => invoke<Settings>('settings:get'),
  updateSettings: (patch: Partial<Settings>) => invoke<Settings>('settings:update', patch),
  connectClaude: (key: string) => invoke<boolean>('claude:connect', key),
  openClaudeKeysPage: () => invoke<boolean>('claude:openKeysPage'),

  previewSave: (opts: { asNew?: boolean; jobId?: string } = {}) => invoke<SavePreview>('save:preview', opts),
  commitSave: (req: SaveRequest) => invoke<SaveResult>('save:commit', req),
  cancelSave: () => invoke<boolean>('save:cancel'),
  aiName: (keys: string[]) => invoke<string | null>('save:aiName', keys),

  listJobs: () => invoke<JobSummary[]>('jobs:list'),
  openState: () => invoke<Record<string, OpenState>>('jobs:openState'),
  suggestions: () => invoke<Suggestion[]>('suggest:list'),
  acceptSuggestion: (id: string) => invoke<void>('suggest:accept', id),
  dismissSuggestion: (id: string, forever: boolean) => invoke<void>('suggest:dismiss', id, forever),
  undoSuggestion: () => invoke<void>('suggest:undo'),
  getBrief: (jobId: string, entryId?: string) => invoke<BriefView>('jobs:brief', jobId, entryId ?? null),
  rewriteBrief: (jobId: string, entryId: string) => invoke<BriefView>('jobs:rewriteBrief', jobId, entryId),
  sendFeedback: (jobId: string, entryId: string, helpful: boolean, comment?: string) => invoke<void>('jobs:feedback', jobId, entryId, helpful, comment ?? null),
  openJob: (jobId: string, entryId: string | null, mode: 'needed' | 'all') => invoke<OpenResult>('jobs:open', jobId, entryId, mode),
  openItem: (jobId: string, key: string) => invoke<OpenResult>('jobs:openItem', jobId, key),
  removeItem: (jobId: string, key: string) => invoke<void>('jobs:removeItem', jobId, key),
  moveItem: (fromJobId: string, key: string, toJobId: string) => invoke<void>('jobs:moveItem', fromJobId, key, toJobId),
  renameJob: (jobId: string, name: string) => invoke<void>('jobs:rename', jobId, name),
  setDone: (jobId: string, done: boolean) => invoke<void>('jobs:done', jobId, done),
  deleteJob: (jobId: string) => invoke<boolean>('jobs:delete', jobId),
  confirmDelete: (jobId: string) => invoke<boolean>('jobs:confirmDelete', jobId),

  openWindow: (route: 'save' | 'pack' | 'main' | 'settings', jobId?: string) => invoke<boolean>('window:open', route, jobId),
  closeWindow: () => invoke<boolean>('window:close'),
  fitWindow: (height: number) => invoke<boolean>('window:fit', height),
  openAutomationSettings: () => invoke<boolean>('system:openAutomationSettings'),
  openAppleAiSettings: () => invoke<boolean>('system:openAppleAiSettings'),
  quit: () => invoke<boolean>('app:quit'),
  getPayload: <T>() => invoke<T | null>('ui:payload'),
  finishNaming: (names: (string | null)[]) => invoke<boolean>('naming:done', names),
  undoTidy: () => invoke<void>('tidy:undo'),
  dismissToast: () => invoke<boolean>('toast:dismiss'),
  overlayDone: () => invoke<boolean>('overlay:done'),

  onJobsChanged: (cb: () => void) => on('jobs:changed', cb),
  onSettingsChanged: (cb: () => void) => on('settings:changed', cb),
  onShowJob: (cb: (jobId: string) => void) => on('panel:show-job', (id) => cb(String(id))),
  onSaveBegin: (cb: (mode: 'save' | 'pack' | 'last') => void) =>
    on('save:begin', (m) => cb(m === 'save' || m === 'pack' ? m : 'last')),
  onWindowShown: (cb: () => void) => on('window:shown', cb),
  onWindowHidden: (cb: () => void) => on('window:hidden', cb),
  onWindowBlur: (cb: () => void) => on('window:blur', cb),
  onPayload: (cb: () => void) => on('payload:updated', cb),
  onOverlayPlay: (cb: (play: OverlayPlay) => void) => on('overlay:play', (p) => cb(p as OverlayPlay)),
  onToastShow: (cb: (info: ToastInfo) => void) => on('toast:show', (p) => cb(p as ToastInfo)),
  onToastLeave: (cb: () => void) => on('toast:leave', cb),
  onMainShow: (cb: (view: 'main' | 'settings') => void) => on('main:show', (v) => cb(v === 'settings' ? 'settings' : 'main')),
};

export type Api = typeof api;
export type { Job };

contextBridge.exposeInMainWorld('api', api);
