// The only bridge between the UI and the main process. The UI gets this typed `api`
// object and nothing else: no Node, no Electron, no file access.

import { contextBridge, ipcRenderer } from 'electron';
import type { AppInfo, BriefView, Job, JobSummary, OpenResult, SavePreview, SaveRequest, SaveResult, Settings } from './shared/types';

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

  listJobs: () => invoke<JobSummary[]>('jobs:list'),
  getBrief: (jobId: string, entryId?: string) => invoke<BriefView>('jobs:brief', jobId, entryId ?? null),
  rewriteBrief: (jobId: string, entryId: string) => invoke<BriefView>('jobs:rewriteBrief', jobId, entryId),
  sendFeedback: (jobId: string, entryId: string, helpful: boolean, comment?: string) => invoke<void>('jobs:feedback', jobId, entryId, helpful, comment ?? null),
  openJob: (jobId: string, entryId: string, mode: 'needed' | 'all') => invoke<OpenResult>('jobs:open', jobId, entryId, mode),
  renameJob: (jobId: string, name: string) => invoke<void>('jobs:rename', jobId, name),
  setDone: (jobId: string, done: boolean) => invoke<void>('jobs:done', jobId, done),
  deleteJob: (jobId: string) => invoke<boolean>('jobs:delete', jobId),
  deleteAll: () => invoke<boolean>('data:deleteAll'),

  openWindow: (route: 'save' | 'main') => invoke<boolean>('window:open', route),
  closeWindow: () => invoke<boolean>('window:close'),
  fitWindow: (height: number) => invoke<boolean>('window:fit', height),
  openAutomationSettings: () => invoke<boolean>('system:openAutomationSettings'),
  openAppleAiSettings: () => invoke<boolean>('system:openAppleAiSettings'),
  quit: () => invoke<boolean>('app:quit'),

  onJobsChanged: (cb: () => void) => on('jobs:changed', cb),
  onSettingsChanged: (cb: () => void) => on('settings:changed', cb),
  onShowJob: (cb: (jobId: string) => void) => on('panel:show-job', (id) => cb(String(id))),
  onSaveBegin: (cb: () => void) => on('save:begin', cb),
  onWindowShown: (cb: () => void) => on('window:shown', cb),
  onWindowBlur: (cb: () => void) => on('window:blur', cb),
};

export type Api = typeof api;
export type { Job };

contextBridge.exposeInMainWorld('api', api);
