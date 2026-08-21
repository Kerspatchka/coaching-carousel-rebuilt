import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from './shared/desktop-api';

const api: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke('app:get-info') as Promise<{ name: string; version: string }>,
  selectAndInspectSave: () => ipcRenderer.invoke('save:select-and-inspect') as ReturnType<DesktopApi['selectAndInspectSave']>
};

contextBridge.exposeInMainWorld('ccr', api);
