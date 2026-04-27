import { contextBridge, ipcRenderer } from 'electron';

const desktopApi = {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    const wrapped = (_event: unknown, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  showOpenDialog: (options: unknown) => ipcRenderer.invoke('desktop:show-open-dialog', options),
  showSaveDialog: (options: unknown) => ipcRenderer.invoke('desktop:show-save-dialog', options),
  getAppVersionSync: () => ipcRenderer.sendSync('desktop:get-app-version-sync'),
  getAppVersion: () => ipcRenderer.invoke('desktop:get-app-version'),
  getAppPath: (name: string) => ipcRenderer.invoke('desktop:get-app-path', name),
  openPath: (targetPath: string) => ipcRenderer.invoke('desktop:open-path', targetPath),
  runtime: {
    arch: process.arch,
    platform: process.platform,
    versions: process.versions,
    env: {
      VUE_APP_GIT_HASH: process.env.VUE_APP_GIT_HASH || '',
    },
  },
};

contextBridge.exposeInMainWorld('diveDesktop', desktopApi);
