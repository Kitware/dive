import {
  app, protocol, screen, BrowserWindow, session, dialog,
} from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { closeAll as closeChildren } from './backend/native/processManager';
import { listen, close as closeServer } from './backend/server';
import ipcListen from './backend/ipcService';

function ensureValidWorkingDirectory() {
  try {
    process.cwd();
  } catch {
    const fallbackCandidates = [os.homedir(), '/tmp', '/'];
    fallbackCandidates.some((candidate) => {
      try {
        process.chdir(candidate);
        return true;
      } catch {
        return false;
      }
    });
  }
}

ensureValidWorkingDirectory();

app.commandLine.appendSwitch('no-sandbox');
// To support a broader number of systems.
app.commandLine.appendSwitch('ignore-gpu-blacklist');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win: BrowserWindow | null;

// This application uses localStorage with persistent sessions.
// In order to use this mechanism, only one application instance
// can exist at a time.  Acquire a lock or quit and focus the running window.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  dialog.showErrorBox(
    'DIVE Desktop',
    'Another instance is already running.\n\n'
      + 'If you do not see a window, close any existing DIVE Desktop or Electron dev session, then try again.',
  );
  app.quit();
}

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } },
]);

async function cleanup() {
  closeServer();
  await closeChildren();
  app.quit();
}

async function createWindow() {
  const size = screen.getPrimaryDisplay().workAreaSize;
  const partitionSession = session.fromPartition('persist:dive');
  // Create the browser window.
  win = new BrowserWindow({
    width: Math.min(size.width, 1420),
    height: Math.min(size.height - 200, 960),
    autoHideMenuBar: true,
    title: 'VIAME DIVE Desktop',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      plugins: true,
      // Fix session such that every instance of the applicaton loads
      // the same session i.e.localStorage
      session: partitionSession,
    },
  });

  listen((server) => {
    let address = server.address();
    let port = 0;
    if (typeof address === 'object' && address !== null) {
      port = address.port || 0;
      address = address.address || '';
    }
    console.error(`Server listening on ${address}:${port}`);
  });
  ipcListen();

  const devServerUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const desktopDevUrl = devServerUrl.includes('desktop.html')
      ? devServerUrl
      : new URL('desktop.html', devServerUrl.endsWith('/') ? devServerUrl : `${devServerUrl}/`).toString();
    try {
      await win.loadURL(desktopDevUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load ${desktopDevUrl}: ${msg}`);
    }
    if (!process.env.IS_TEST) win.webContents.openDevTools();
  } else {
    const desktopEntryCandidates = app.isPackaged
      ? [path.join(app.getAppPath(), 'dist_desktop', 'desktop.html')]
      : [
        path.resolve(__dirname, '..', '..', 'dist_desktop', 'desktop.html'),
        path.resolve(app.getAppPath(), 'dist_desktop', 'desktop.html'),
        path.resolve(process.cwd(), 'dist_desktop', 'desktop.html'),
      ];
    const desktopEntry = desktopEntryCandidates.find((candidate) => fs.existsSync(candidate))
      || desktopEntryCandidates[0];
    try {
      await win.loadFile(desktopEntry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load ${desktopEntry}: ${msg}`);
    }
  }

  win.on('closed', () => {
    win = null;
  });
}

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    cleanup();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (win === null) {
    createWindow().catch((err) => {
      dialog.showErrorBox('DIVE Desktop', err instanceof Error ? err.message : String(err));
    });
  }
});

// If the quit button from the context menu is used,
// Intercept the before-quit event
app.on('before-quit', () => {
  closeChildren();
  closeServer();
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => createWindow()).catch((err) => {
  dialog.showErrorBox(
    'DIVE Desktop',
    `The application failed to start:\n\n${err instanceof Error ? err.message : String(err)}`,
  );
  app.exit(1);
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

if (process.platform === 'win32') {
  process.on('message', (data) => {
    if (data === 'graceful-exit') {
      cleanup();
    }
  });
} else {
  process.on('SIGTERM', () => {
    cleanup();
  });
}

export default function sendToRenderer(channel: string, payload?: unknown) {
  if (win) {
    win.webContents.send(channel, payload);
  }
}
