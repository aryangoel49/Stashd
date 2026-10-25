// Every message the UI can send to the main process. Each handler checks who sent it
// and validates its input before doing anything.

import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import type { AppInfo } from '../shared/types';
import * as v from '../shared/validate';
import type { Core } from './core';
import { findVSCode } from './restore';
import { isAppUrl, showWindow } from './windows';

const AUTOMATION_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const url = event.senderFrame?.url ?? '';
    if (!isAppUrl(url)) throw new Error('Blocked a message from an unknown page');
    try {
      return await fn(event, ...args);
    } catch (e) {
      // Send a clean, readable message to the UI.
      throw new Error(e instanceof Error ? e.message : String(e));
    }
  });
}

export function registerIpc(core: Core, hooks: { shortcutErrors: () => string[]; saved: () => void }): void {
  handle('app:info', async (): Promise<AppInfo & { shortcutErrors: string[] }> => ({
    version: app.getVersion(),
    hasApiKey: await core.secrets.has(),
    vscodeAvailable: (await findVSCode()) !== null,
    platform: process.platform,
    shortcutErrors: hooks.shortcutErrors(),
  }));

  handle('settings:get', () => core.settings.get());
  handle('settings:update', (_e, patch) => core.settings.update(patch));
  handle('settings:setApiKey', async (_e, key) => {
    await core.secrets.set(v.apiKey(key));
    return core.secrets.has();
  });

  handle('projects:add', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts: Electron.OpenDialogOptions = { title: 'Choose a project folder', properties: ['openDirectory', 'createDirectory'] };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || !res.filePaths[0]) return null;
    return core.addProject(v.absolutePath(res.filePaths[0]));
  });
  handle('projects:remove', async (event, id, deleteSnapshots) => {
    const projectId = v.projectId(id);
    const del = v.bool(deleteSnapshots, 'deleteSnapshots');
    await core.removeProject(projectId, del);
    return true;
  });
  handle('projects:list', () => core.listProjects());
  handle('projects:suggested', () => core.suggestedProject());

  handle('snapshot:save', async (_e, id, note) => {
    const snap = await core.save(v.projectId(id), v.note(note));
    hooks.saved();
    return { id: snap.id, errors: snap.errors };
  });
  handle('snapshot:list', (_e, id) => core.store.list(v.projectId(id)));

  handle('recap:get', (_e, id, snapshotId, ai) =>
    core.recap(v.projectId(id), snapshotId == null ? undefined : v.snapshotId(snapshotId), v.bool(ai ?? false, 'ai')),
  );
  handle('recap:aiPayload', (_e, id, snapshotId) =>
    core.aiPayloadPreview(v.projectId(id), snapshotId == null ? undefined : v.snapshotId(snapshotId)),
  );

  handle('restore:run', (_e, req) => core.restore(v.restoreRequest(req)));

  handle('snapshots:deleteProject', async (event, id) => {
    const projectId = v.projectId(id);
    const project = core.project(projectId);
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: ['Delete snapshots', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Delete all saved snapshots for ${project.name}?`,
      detail: 'This cannot be undone. Your project files are not touched.',
    };
    const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (res.response !== 0) return false;
    await core.deleteProjectSnapshots(projectId);
    return true;
  });

  handle('window:open', (_e, route) => {
    if (route !== 'main' && route !== 'settings' && route !== 'quicksave') throw new Error('bad window');
    showWindow(route);
    return true;
  });
  handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
    return true;
  });
  handle('system:openAutomationSettings', async () => {
    await shell.openExternal(AUTOMATION_SETTINGS);
    return true;
  });
}
