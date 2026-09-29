/**
 * Entries of the viewer's camera selector. A stereo pair offers, per selected
 * camera: both cameras, that camera beside the 3D viewer (which takes the other
 * camera's pane), or both cameras with the 3D viewer as a third pane.
 */
export type Viewer3dMode = 'off' | 'replace' | 'beside';

export interface DisplayOption {
  value: string;
  text: string;
  menuText: string;
}

const PREFIXES: Record<Viewer3dMode, string> = {
  off: 'camera:',
  replace: 'viewer3d:',
  beside: 'stereo3d:',
};
const MODES = Object.keys(PREFIXES) as Viewer3dMode[];

export function displayValue(camera: string, mode: Viewer3dMode) {
  return `${PREFIXES[mode]}${camera}`;
}

export function parseDisplayValue(value: string): { camera: string; mode: Viewer3dMode } {
  const mode = MODES.find((candidate) => value.startsWith(PREFIXES[candidate])) ?? 'off';
  return { camera: value.slice(PREFIXES[mode].length), mode };
}

function capitalize(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function stereoLabel(camera: string, mode: Viewer3dMode) {
  const name = capitalize(camera);
  if (mode === 'replace') {
    return `${name} + 3D`;
  }
  return mode === 'beside' ? `Stereo (${name}) + 3D` : `Stereo (${name})`;
}

export function displayOptions(
  cameras: readonly string[],
  stereo: boolean,
  defaultCamera: string,
): DisplayOption[] {
  if (!stereo) {
    return cameras.map((camera) => ({
      value: displayValue(camera, 'off'),
      text: camera,
      menuText: camera === defaultCamera ? `${camera} (Default)` : camera,
    }));
  }
  return MODES.flatMap((mode) => cameras.map((camera) => {
    const text = stereoLabel(camera, mode);
    return { value: displayValue(camera, mode), text, menuText: text };
  }));
}
