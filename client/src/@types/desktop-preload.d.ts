interface DesktopOpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface DesktopSaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

interface DesktopRuntimeInfo {
  arch: string;
  platform: string;
  versions: Record<string, string>;
  env: {
    VUE_APP_GIT_HASH: string;
  };
}

interface DesktopBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (...args: unknown[]) => void): () => void;
  showOpenDialog(options: unknown): Promise<DesktopOpenDialogResult>;
  showSaveDialog(options: unknown): Promise<DesktopSaveDialogResult>;
  getAppVersionSync(): string;
  getAppVersion(): Promise<string>;
  getAppPath(name: string): Promise<string>;
  openPath(targetPath: string): Promise<string>;
  runtime: DesktopRuntimeInfo;
}

interface Window {
  diveDesktop: DesktopBridge;
}
