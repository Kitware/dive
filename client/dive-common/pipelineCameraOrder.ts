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
 * user is shown each slot with the camera DIVE proposes for it — by role
 * when both sides have one, else by name — and display order fills any slot
 * that would otherwise stay empty; the confirmed order is what the job runs with.
 *
 * Role inference is mirrored in server/dive_tasks/multicam_pipeline.py.
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

/**
 * Cameras that could fill a slot. A camera whose assigned role equals the
 * slot's role wins over name matching, so a corrected role beats a
 * misleading name; otherwise the slot token must equal the camera name, or
 * share a role (or, for non-role tokens like `left`, appear literally) with
 * one of the name's segments.
 */
export function camerasForSlot(
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
  const lower = slot.toLowerCase();
  const exact = cameras.filter((camera) => camera.toLowerCase() === lower);
  if (exact.length) {
    return exact;
  }
  const aliases = new Set<string>(role ? CAMERA_ROLE_ALIASES[role] : [lower]);
  return cameras.filter((camera) => segments(camera).some((seg) => aliases.has(seg)));
}

/**
 * Display-order fallback: inputN gets the Nth camera in persisted display
 * order (`cameraOrder`, via orderedMultiCamCameraNames).
 */
export function proposedPipelineCameraOrder(cameras: readonly string[]): string[] {
  return [...cameras];
}

/**
 * Default dialog prefill: match slots by role/name first; any slot that would
 * stay empty (or the whole row when every slot is bare `inputN`) is filled
 * from display order instead of leaving the user with blank pickers.
 */
export function defaultDialogCameraOrder(
  slots: string[],
  cameras: string[],
  roles: Record<string, CameraRole> = {},
): string[] {
  const matched = prefillPipelineCameraOrder(slots, cameras, roles);
  if (matched.every((camera) => camera !== null)) {
    return matched as string[];
  }
  if (matched.every((camera) => camera === null)) {
    return proposedPipelineCameraOrder(cameras);
  }
  const taken = new Set(matched.filter((camera): camera is string => camera !== null));
  const remaining = cameras.filter((camera) => !taken.has(camera));
  const result: (string | null)[] = [...matched];
  let next = 0;
  result.forEach((camera, index) => {
    if (camera === null && next < remaining.length) {
      result[index] = remaining[next];
      next += 1;
    }
  });
  if (result.every((camera) => camera !== null)) {
    return result as string[];
  }
  return proposedPipelineCameraOrder(cameras);
}

/**
 * Propose a camera for every slot by matching slot tokens to camera roles /
 * names. A slot with no unique candidate is proposed as null.
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
    const matches = camerasForSlot(slot, cameras, roles).filter((c) => !taken.has(c));
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

/** Match Python truthiness for registration matrix checks (see crud_rpc.py). */
function registrationValueTruthy(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

type HomographyPair = { AtoB?: unknown; BtoA?: unknown };

/**
 * Pair keys that have a fitted AtoB or BtoA matrix. Mirrors the server's
 * `fitted_pairs` filter so the camera-assignment dialog agrees with the
 * run-time registration check.
 */
export function fittedRegistrationPairs(
  homographies: Record<string, HomographyPair> | null | undefined,
): string[] {
  return Object.entries(homographies ?? {})
    .filter(([, value]) => registrationValueTruthy(value)
      && (registrationValueTruthy(value.AtoB) || registrationValueTruthy(value.BtoA)))
    .map(([key]) => key);
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
    + `("${missing.target}"). Register ${missing.camera} → ${missing.target} in the Camera Registration tab${where}.`;
}

/** Parse the value of a `# Camera Order:` header into slot tokens. */
export function parseCameraOrderHeader(value: string): string[] {
  return value.trim().split(/[\s,]+/).filter((token) => token);
}
