import {
  app, protocol, screen, BrowserWindow, session,
} from 'electron';
import { initialize as initializeRemote } from '@electron/remote/main';
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib';

import { closeAll as closeChildren } from './backend/native/processManager';
import { listen, close as closeServer } from './backend/server';
import ipcListen from './backend/ipcService';

app.commandLine.appendSwitch('no-sandbox');
// To support a broader number of systems.
app.commandLine.appendSwitch('ignore-gpu-blacklist');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win: BrowserWindow | null;

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
      // Use pluginOptions.nodeIntegration, leave this alone
      // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html
      // #node-integration for more info
      nodeIntegration: (!!process.env.ELECTRON_NODE_INTEGRATION),
      plugins: true,
      enableRemoteModule: true,
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
  initializeRemote();

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    // Load the url of the dev server if in development mode
    await win.loadURL(process.env.WEBPACK_DEV_SERVER_URL);
    if (!process.env.IS_TEST) win.webContents.openDevTools();
  } else {
    createProtocol('app', partitionSession.protocol);
    // Load the index.html when not in development
    win.loadURL('app://./index.html');
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
    createWindow();
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
app.on('ready', async () => {
  createWindow();
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
