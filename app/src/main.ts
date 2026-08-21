import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { inspectSave } from './save-reader';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#0b0b0b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.once('ready-to-show', () => window.show());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

app.whenReady().then(() => {
  const smokeSave = process.env.CCR_PREFLIGHT_SMOKE_SAVE;
  const smokeOutput = process.env.CCR_PREFLIGHT_SMOKE_OUTPUT;
  if (smokeSave && smokeOutput) {
    void inspectSave(smokeSave, app.isPackaged)
      .then((result) => {
        fs.writeFileSync(smokeOutput, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        app.exit(result.status === 'ready' ? 0 : 2);
      })
      .catch((error) => {
        fs.writeFileSync(smokeOutput, `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`, 'utf8');
        app.exit(1);
      });
    return;
  }

  Menu.setApplicationMenu(null);
  ipcMain.handle('app:get-info', () => ({ name: app.getName(), version: app.getVersion() }));
  ipcMain.handle('save:select-and-inspect', async () => {
    const selected = await dialog.showOpenDialog({
      title: 'Select CFP National Championship Week Dynasty Save',
      buttonLabel: 'Inspect Save',
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }]
    });
    if (selected.canceled || selected.filePaths.length === 0) return null;
    return inspectSave(selected.filePaths[0]!, app.isPackaged);
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
