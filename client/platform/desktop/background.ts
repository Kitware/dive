import {
  app, protocol, screen, BrowserWindow, session, dialog, ipcMain,
} from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { closeAll as closeChildren } from './backend/native/processManager';
import { listen, close as closeServer } from './backend/server';
import ipcListen from './backend/ipcService';
import { CliOpenArgs, parseCliArgs, runCliImport } from './backend/cliImport';

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

// To support a broader number of systems.
app.commandLine.appendSwitch('ignore-gpu-blacklist');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win: BrowserWindow | null;
let allowClose = false;
let closeGuardActive = false;

// CLI opens queued until the renderer is mounted, listening for
// desktop:open-dataset, and has pulled via desktop:cli-open-pending. Cold-start
// imports and second-instance forwards share this queue so neither is dropped
// while the window is still loading (or missing, e.g. macOS with no windows).
const pendingCliOpens: CliOpenArgs[] = [];
let cliRendererReady = false;
let creatingWindow = false;
let cliOpenChain: Promise<void> = Promise.resolve();
// Misuse of the launch flags is reported once the app is ready; throwing here,
// at module scope, would take the process down without telling the user why.
let cliArgsError: string | null = null;
let initialCliOpen: CliOpenArgs | null = null;
try {
  initialCliOpen = parseCliArgs(process.argv);
  if (initialCliOpen) {
    pendingCliOpens.push(initialCliOpen);
  }
} catch (err) {
  cliArgsError = err instanceof Error ? err.message : String(err);
}

/**
 * Import the CLI-requested dataset and navigate the renderer to it. Navigation
 * is driven by an event rather than the return value because media that needs
 * transcoding only becomes viewable once its conversion job finishes.
 */
async function openFromCli(cliArgs: CliOpenArgs) {
  // Multi-camera launches have no single import path; name what was asked for.
  const target = cliArgs.importPath
    ?? Object.entries(cliArgs.cameras ?? {}).map(([c, p]) => `${c}=${p}`).join(', ');
  try {
    await runCliImport(
      cliArgs,
      (update) => sendToRenderer('job-update', update),
      (datasetId) => sendToRenderer('desktop:open-dataset', datasetId),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Log as well as prompt: a modal dialog is invisible to anyone driving the
    // app from a script or reading a log after the fact.
    console.error(`Failed to open ${target} from the command line: ${message}`);
    dialog.showErrorBox(
      'DIVE Desktop',
      `Failed to open ${target} from the command line:\n\n${message}`,
    );
  }
}

/** Drain queued CLI opens once the renderer has registered its listener. */
function flushCliOpens() {
  if (!cliRendererReady) {
    return;
  }
  while (pendingCliOpens.length > 0) {
    const cliArgs = pendingCliOpens.shift() as CliOpenArgs;
    // Chain imports so overlapping second-instance launches do not race.
    cliOpenChain = cliOpenChain.then(() => openFromCli(cliArgs));
  }
}

function enqueueCliOpen(cliArgs: CliOpenArgs) {
  pendingCliOpens.push(cliArgs);
  flushCliOpens();
}

// The renderer calls this once it is mounted and listening, so that a dataset
// ready before the window finishes loading is not missed. Later second-instance
// opens also flush through here once this has run at least once for the window.
ipcMain.handle('desktop:cli-open-pending', () => {
  cliRendererReady = true;
  const first = pendingCliOpens[0];
  flushCliOpens();
  return first?.importPath ?? null;
});
ipcMain.on('desktop:close-guard-active', (event, active: boolean) => {
  if (win && event.sender === win.webContents) {
    closeGuardActive = active;
  }
});

ipcMain.on('desktop:close-response', (event, allow: boolean) => {
  if (win && event.sender === win.webContents && allow) {
    allowClose = true;
    win.close();
  }
});

// Native three-way prompt shown by the renderer close guard when the window is
// closed with unsaved changes. Returns the user's choice.
ipcMain.handle('desktop:confirm-close-unsaved', async (): Promise<'save' | 'discard' | 'cancel'> => {
  if (!win) return 'discard';
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save and Exit', 'Exit Without Saving', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: 'Unsaved Changes',
    message: 'You have unsaved changes.',
    detail: 'Do you want to save your changes before exiting DIVE Desktop?',
  });
  if (response === 0) return 'save';
  if (response === 1) return 'discard';
  return 'cancel';
});

// This application uses localStorage with persistent sessions.
// In order to use this mechanism, only one application instance
// can exist at a time.  Acquire a lock or quit and focus the running window.
//
// Hand the parsed launch arguments to the running instance as additionalData.
// The argv Electron forwards to second-instance is Chromium's, which hoists
// switches ahead of positionals and so detaches `--import <path>` from its
// value; process.argv here is the raw one, so parse before handing it over.
const gotTheLock = app.requestSingleInstanceLock(initialCliOpen ?? undefined);
if (!gotTheLock) {
  // A second launch carrying a dataset is not a mistake: the running instance
  // picks it up via the second-instance event below and opens it, so quit
  // quietly rather than reporting a failure the user did not have.
  if (cliArgsError) {
    dialog.showErrorBox('DIVE Desktop', cliArgsError);
  } else if (!initialCliOpen) {
    dialog.showErrorBox(
      'DIVE Desktop',
      'Another instance is already running.\n\n'
        + 'If you do not see a window, close any existing DIVE Desktop or Electron dev session, then try again.',
    );
  }
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

// In dev, Electron can attempt to load desktop.html before the Vite renderer
// server is fully ready. Retry briefly to avoid flaky startup failures.
async function loadDevUrlWithRetry(window: BrowserWindow, url: string) {
  const maxAttempts = 10;
  const attemptLoad = async (attempt: number): Promise<void> => {
    try {
      await window.loadURL(url);
      return Promise.resolve();
    } catch (err) {
      if (attempt >= maxAttempts) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load ${url} after ${maxAttempts} attempts: ${message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      return attemptLoad(attempt + 1);
    }
  };
  return attemptLoad(1);
}

async function createWindow() {
  if (win || creatingWindow) {
    return;
  }
  creatingWindow = true;
  try {
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
        await loadDevUrlWithRetry(win, desktopDevUrl);
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

    allowClose = false;
    closeGuardActive = false;
    win.on('close', (e) => {
      if (allowClose || !closeGuardActive) return;
      e.preventDefault();
      win?.webContents.send('desktop:close-requested');
    });

    win.on('closed', () => {
      allowClose = false;
      closeGuardActive = false;
      // The next window must re-pull pending CLI opens after its listener is up.
      cliRendererReady = false;
      win = null;
    });
  } finally {
    creatingWindow = false;
  }
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
//
// Only the instance holding the single-instance lock opens a window. Without
// this guard a losing instance races its own app.quit(), builds a window while
// the app is tearing down, and reports a spurious startup failure.
if (gotTheLock) {
  app.whenReady().then(() => {
    // Launch flags were malformed. Say so and stop, rather than opening an app
    // window that silently ignores what was asked for.
    if (cliArgsError) {
      dialog.showErrorBox('DIVE Desktop', cliArgsError);
      app.exit(1);
      return Promise.resolve();
    }
    return createWindow();
  }).catch((err) => {
    dialog.showErrorBox(
      'DIVE Desktop',
      `The application failed to start:\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    app.exit(1);
  });
}

app.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
  // A second launch carrying a dataset opens it in this window, rather than
  // being dropped on the floor by the single-instance lock. The args were
  // parsed by that instance and passed through the lock request, since the
  // forwarded argv no longer pairs flags with their values.
  //
  // Queue until the renderer has called cli-open-pending (listener registered).
  // If there is no window yet (startup race, or macOS with all windows closed),
  // create one so the queued open can be pulled.
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  } else if (gotTheLock && app.isReady()) {
    createWindow().catch((err) => {
      dialog.showErrorBox(
        'DIVE Desktop',
        err instanceof Error ? err.message : String(err),
      );
    });
  }
  const cliArgs = additionalData as CliOpenArgs | undefined;
  if (cliArgs?.importPath || cliArgs?.cameras) {
    enqueueCliOpen(cliArgs);
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
