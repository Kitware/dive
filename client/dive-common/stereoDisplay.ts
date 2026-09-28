/**
 * Entries of the viewer's camera selector. A stereo pair offers, per camera,
 * both cameras side by side with that camera selected, or that camera beside
 * the 3D viewer, which takes the other camera's pane.
 */
export interface DisplayOption {
  value: string;
  text: string;
  menuText: string;
}

const CAMERA_PREFIX = 'camera:';
const VIEWER_3D_PREFIX = 'viewer3d:';

export function displayValue(camera: string, viewer3d: boolean) {
  return `${viewer3d ? VIEWER_3D_PREFIX : CAMERA_PREFIX}${camera}`;
}

export function parseDisplayValue(value: string) {
  const viewer3d = value.startsWith(VIEWER_3D_PREFIX);
  return {
    camera: value.slice((viewer3d ? VIEWER_3D_PREFIX : CAMERA_PREFIX).length),
    viewer3d,
  };
}

function capitalize(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function displayOptions(
  cameras: readonly string[],
  stereo: boolean,
  defaultCamera: string,
): DisplayOption[] {
  if (!stereo) {
    return cameras.map((camera) => ({
      value: displayValue(camera, false),
      text: camera,
      menuText: camera === defaultCamera ? `${camera} (Default)` : camera,
    }));
  }
  return [false, true].flatMap((viewer3d) => cameras.map((camera) => {
    const text = `${capitalize(camera)} ${viewer3d ? '+ 3D Viewer' : '(Selected)'}`;
    return { value: displayValue(camera, viewer3d), text, menuText: text };
  }));
}
