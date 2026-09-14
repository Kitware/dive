/** Shared desktop IPC types for VIAME add-on management. */
export interface ViameAddon {
  name: string;
  description: string;
  url: string;
  requires: string[];
  marker: string;
  status: 'installed' | 'not installed' | 'unknown';
}
export interface AddonInstallRequest {
  name: string;
  archive?: string;
  force?: boolean;
}
export interface AddonJob {
  name: string;
  installDir: string;
  running: boolean;
  log: string;
  error?: string;
  phase?: 'download' | 'verify' | 'install' | 'elevation' | 'complete';
  downloadProgress?: number;
  downloadBytes?: number;
  downloadTotalBytes?: number;
  installProgress?: number;
  localArchive?: boolean;
  elevated?: boolean;
  canCancel?: boolean;
  cancelRequested?: boolean;
  cancelled?: boolean;
}
export interface AddonCatalog {
  installDir: string;
  addons: ViameAddon[];
  installerAvailable: boolean;
  readOnly: boolean;
  job: AddonJob | null;
}
