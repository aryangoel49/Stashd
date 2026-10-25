// The only bridge between the UI and the main process. The UI gets this typed `api`
// object and nothing else: no Node, no Electron, no file access.

import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppInfo,
  CollectorError,
  Project,
  ProjectListItem,
  RecapView,
  RestoreRequest,
  RestoreResult,
  Settings,
  SnapshotSummary,
} from './shared/types';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function on(channel: string, cb: (...args: unknown[]) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  appInfo: () => invoke<AppInfo & { shortcutErrors: string[] }>('app:info'),
  getSettings: () => invoke<Settings>('settings:get'),
  updateSettings: (patch: Partial<Settings>) => invoke<Settings>('settings:update', patch),
  setApiKey: (key: string) => invoke<boolean>('settings:setApiKey', key),

  addProject: () => invoke<Project | null>('projects:add'),
  removeProject: (id: string, deleteSnapshots: boolean) => invoke<boolean>('projects:remove', id, deleteSnapshots),
  listProjects: () => invoke<ProjectListItem[]>('projects:list'),
  suggestedProject: () => invoke<string | null>('projects:suggested'),

  saveSnapshot: (projectId: string, note: string) => invoke<{ id: string; errors: CollectorError[] }>('snapshot:save', projectId, note),
  listSnapshots: (projectId: string) => invoke<SnapshotSummary[]>('snapshot:list', projectId),
  getRecap: (projectId: string, snapshotId: string | null, ai: boolean) => invoke<RecapView>('recap:get', projectId, snapshotId, ai),
  aiPayload: (projectId: string, snapshotId: string | null) => invoke<string>('recap:aiPayload', projectId, snapshotId),
  restore: (req: RestoreRequest) => invoke<RestoreResult>('restore:run', req),
  deleteProjectSnapshots: (projectId: string) => invoke<boolean>('snapshots:deleteProject', projectId),

  openWindow: (route: 'main' | 'settings' | 'quicksave') => invoke<boolean>('window:open', route),
  closeWindow: () => invoke<boolean>('window:close'),
  openAutomationSettings: () => invoke<boolean>('system:openAutomationSettings'),

  onSnapshotsChanged: (cb: () => void) => on('snapshots:changed', cb),
  onSettingsChanged: (cb: () => void) => on('settings:changed', cb),
  onShowProject: (cb: (projectId: string) => void) => on('show-project', (id) => cb(String(id))),
  onQuickSaveReset: (cb: () => void) => on('quicksave:reset', cb),
};

export type Api = typeof api;

contextBridge.exposeInMainWorld('api', api);
