/**
 * Camera roles, and how a multicam pipeline's input slots are filled from a
 * dataset's cameras.
 *
 * A 2-cam/3-cam pipe wires each `inputN` to a specific role (the arctic seal
 * 3-cam pipe runs the thermal detector on input3 and projects optical boxes
 * onto input2), so which dataset camera lands on which input is the pipe's
 * contract, not something DIVE can infer from display order. Pipes state it
 * with a `# Camera Order: EO, UV, IR` header (one token per input, in order).
 *
 * Datasets carry a role per camera (`cameraRoles`, inferred once at import
 * from the camera / image names and editable afterwards). Before a run the
 * user is shown each slot with the camera DIVE proposes for it -- by role
 * when both sides have one, else by name -- and confirms or corrects it; the
 * confirmed order is what the job runs with.
 *
 * Kept in sync with server/dive_tasks/multicam_pipeline.py.
 */

/** The sensor modalities DIVE knows how to match. */
export type CameraRole = 'eo' | 'ir' | 'uv';
export const CAMERA_ROLES: readonly CameraRole[] = ['eo', 'ir', 'uv'];

export const CAMERA_ROLE_LABELS: Record<CameraRole, string> = {
  eo: 'Optical (EO)',
  ir: 'Thermal (IR)',
  uv: 'Ultraviolet (UV)',
};

/**
 * Role aliases: a slot token and a camera name match when they share a role,
 * or when the token itself appears as a segment of the camera name (so pipes
 * can name cameras literally, e.g. `# Camera Order: left, right`).
 */
export const CAMERA_ROLE_ALIASES: Record<CameraRole, readonly string[]> = {
  eo: ['eo', 'rgb', 'optical', 'color', 'colour', 'vis', 'visible'],
  ir: ['ir', 'thermal', 'lwir', 'mwir', 'flir'],
  uv: ['uv', 'ultraviolet'],
};

function segments(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((s) => s);
}

/** The role a slot token or camera-name segment denotes, if any. */
export function roleOfToken(token: string): CameraRole | null {
  const lower = token.toLowerCase();
  const found = CAMERA_ROLES.find((role) => CAMERA_ROLE_ALIASES[role].includes(lower));
  return found ?? null;
}

/**
 * Infer a camera's role from its name, falling back to tokens in its image
 * file names (KAMERA style `..._rgb.jpg` / `_ir.tif` / `_uv.jpg`). Only a
 * unanimous answer counts: a name or file set naming two roles yields null.
 */
export function inferCameraRole(cameraName: string, imageNames: string[] = []): CameraRole | null {
  const fromName = new Set(segments(cameraName).map(roleOfToken).filter((r): r is CameraRole => !!r));
  if (fromName.size === 1) {
    return [...fromName][0];
  }
  if (fromName.size > 1) {
    return null;
  }
  const fromImages = new Set<CameraRole>();
  imageNames.slice(0, 50).forEach((image) => {
    const base = image.split(/[\\/]/).pop() ?? image;
    const stem = base.replace(/\.[^.]+$/, '');
    segments(stem).map(roleOfToken).forEach((r) => { if (r) fromImages.add(r); });
  });
  return fromImages.size === 1 ? [...fromImages][0] : null;
}

/** Infer roles for a whole rig; cameras DIVE cannot classify are omitted. */
export function inferCameraRoles(
  cameras: Record<string, string[] | undefined>,
): Record<string, CameraRole> {
  const roles: Record<string, CameraRole> = {};
  Object.entries(cameras).forEach(([name, images]) => {
    const role = inferCameraRole(name, images ?? []);
    if (role) {
      roles[name] = role;
    }
  });
  return roles;
}

/** Cameras whose name matches a slot token, by literal segment or shared role. */
export function camerasMatchingSlot(token: string, cameras: string[]): string[] {
  const lower = token.toLowerCase();
  const exact = cameras.filter((camera) => camera.toLowerCase() === lower);
  if (exact.length) {
    return exact;
  }
  const role = roleOfToken(token);
  const aliases = new Set<string>(role ? CAMERA_ROLE_ALIASES[role] : [lower]);
  return cameras.filter((camera) => segments(camera).some((seg) => aliases.has(seg)));
}

export type PipelineCameraOrderResult =
  | { order: string[]; error?: undefined }
  | { order?: undefined; error: string };

/**
 * Resolve declared slots to dataset cameras without user interaction (CLI,
 * and the fallback when no confirmed order was supplied). Every slot must
 * match exactly one camera and no camera may fill two slots; anything else
 * is an error message naming the slot, the pipe's slots and the dataset's
 * cameras.
 */
export function resolvePipelineCameraOrder(
  slots: string[],
  cameras: string[],
  roles: Record<string, CameraRole> = {},
): PipelineCameraOrderResult {
  const context = `pipeline cameras [${slots.join(', ')}], dataset cameras [${cameras.join(', ')}]`;
  if (slots.length !== cameras.length) {
    return {
      error: `Pipeline expects ${slots.length} cameras but the dataset has ${cameras.length}: ${context}`,
    };
  }
  const order: string[] = [];
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const matches = candidatesForSlot(slot, cameras, roles).filter((c) => !order.includes(c));
    if (matches.length !== 1) {
      const why = matches.length === 0
        ? 'no dataset camera matches'
        : `several dataset cameras match (${matches.join(', ')})`;
      return {
        error: `Cannot place pipeline camera "${slot}" (input${i + 1}): ${why}. ${context}. `
          + 'Set the camera roles (or rename the cameras) so each pipeline camera matches exactly one.',
      };
    }
    order.push(matches[0]);
  }
  return { order };
}

/**
 * Cameras that could fill a slot: cameras whose assigned role equals the
 * slot's role take precedence over name matching, so a corrected role wins
 * over a misleading name.
 */
export function candidatesForSlot(
  slot: string,
  cameras: string[],
  roles: Record<string, CameraRole> = {},
): string[] {
  const role = roleOfToken(slot);
  if (role) {
    const byRole = cameras.filter((camera) => roles[camera] === role);
    if (byRole.length) {
      return byRole;
    }
  }
  return camerasMatchingSlot(slot, cameras);
}

/**
 * Propose a camera for every slot for the confirmation step. Unlike
 * {@link resolvePipelineCameraOrder} this never fails: a slot with no unique
 * candidate is proposed as null and left for the user to fill.
 */
export function prefillPipelineCameraOrder(
  slots: string[],
  cameras: string[],
  roles: Record<string, CameraRole> = {},
): (string | null)[] {
  const taken = new Set<string>();
  const proposed: (string | null)[] = slots.map(() => null);
  // Unique matches first, so an ambiguous slot cannot steal a camera another
  // slot needs unambiguously.
  slots.forEach((slot, index) => {
    const matches = candidatesForSlot(slot, cameras, roles).filter((c) => !taken.has(c));
    if (matches.length === 1) {
      [proposed[index]] = matches;
      taken.add(matches[0]);
    }
  });
  return proposed;
}

/**
 * Slot labels for a pipe: its declared `# Camera Order:` tokens, else the
 * bare `input1..N` positions.
 */
export function pipelineCameraSlots(declaredOrder: string[] | null | undefined, count: number): string[] {
  if (declaredOrder?.length) {
    return declaredOrder;
  }
  return Array.from({ length: count }, (_, i) => `input${i + 1}`);
}

export interface MissingRegistration {
  /** 1-based pipeline input position. */
  input: number;
  camera: string;
  /** Camera 1, the frame the warp maps onto. */
  target: string;
}

/**
 * Cameras a pipe will warp (its `warpN` processes) that have no fitted
 * registration onto camera 1 of the given order. `fittedPairs` are the
 * dataset's homography keys (`a::b`, either orientation counts). Checked
 * before a run so the failure is "register camera X onto Y first" rather
 * than the pipe dying at configure time on a missing file.
 */
export function missingRegistrations(
  order: (string | null)[],
  registrationWarps: number[] | null | undefined,
  fittedPairs: string[],
): MissingRegistration[] {
  const target = order[0];
  if (!target || !registrationWarps?.length) {
    return [];
  }
  const fitted = new Set(fittedPairs);
  const missing: MissingRegistration[] = [];
  registrationWarps.forEach((input) => {
    const camera = order[input - 1];
    if (!camera || camera === target) {
      return;
    }
    if (!fitted.has(`${camera}::${target}`) && !fitted.has(`${target}::${camera}`)) {
      missing.push({ input, camera, target });
    }
  });
  return missing;
}

export function describeMissingRegistration(missing: MissingRegistration, pipelineName?: string): string {
  const where = pipelineName ? ` before running ${pipelineName}` : '';
  return `Camera "${missing.camera}" (input${missing.input}) has no registration onto camera 1 `
    + `("${missing.target}"). Register ${missing.camera} → ${missing.target} in Aligned View${where}.`;
}

/** Parse the value of a `# Camera Order:` header into slot tokens. */
export function parseCameraOrderHeader(value: string): string[] {
  return value.trim().split(/[\s,]+/).filter((token) => token);
}
