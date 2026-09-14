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
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  send(channel: string, ...args: unknown[]): void;
  on<T = unknown>(channel: string, listener: (payload: T) => void): () => void;
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
