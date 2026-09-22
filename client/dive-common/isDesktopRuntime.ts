/** True when running inside the Electron desktop app (not web Girder). */
export default function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && 'diveDesktop' in window;
}
