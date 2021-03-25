import {
  app, protocol, screen, BrowserWindow,
} from 'electron';
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib';
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer';

import { closeAll as closeChildren } from './backend/native/processManager';
import { listen, close as closeServer } from './backend/server';
import ipcListen from './backend/ipcService';

app.commandLine.appendSwitch('no-sandbox');
// To support a broader number of systems.
app.commandLine.appendSwitch('ignore-gpu-blacklist');

const isDevelopment = process.env.NODE_ENV !== 'production';

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
  // Create the browser window.
  win = new BrowserWindow({
    width: Math.min(size.width, 1300),
    height: Math.min(size.height - 200, 900),
    autoHideMenuBar: true,
    webPreferences: {
      // Use pluginOptions.nodeIntegration, leave this alone
      // See nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html
      // #node-integration for more info
      nodeIntegration: (!!process.env.ELECTRON_NODE_INTEGRATION),
      plugins: true,
      enableRemoteModule: true,
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

  if (process.env.IS_ELECTRON) {
    // Load the url of the dev server if in development mode
    await win.loadURL(process.env.WEBPACK_DEV_SERVER_URL as string);
    if (!process.env.IS_TEST) win.webContents.openDevTools();
  } else {
    createProtocol('app');
    // Load the index.html when not in development
    win.loadURL(`file://${__dirname}/index.html`);
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
  if (isDevelopment && !process.env.IS_TEST) {
    // Install Vue Devtools
    try {
      await installExtension(VUEJS_DEVTOOLS);
    } catch (e) {
      console.error('Vue Devtools failed to install:', e.toString());
    }
  }
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
