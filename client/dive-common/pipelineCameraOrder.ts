/**
 * Map a multicam pipeline's declared camera slots onto a dataset's cameras.
 *
 * A 2-cam/3-cam pipe wires each `inputN` to a specific role (the arctic seal
 * 3-cam pipe runs the thermal detector on input3 and projects optical boxes
 * onto input2), so which dataset camera lands on which input is the pipe's
 * contract, not something DIVE can infer from display order. Pipes state it
 * with a `# Camera Order: EO, UV, IR` header (one token per input, in
 * order); this resolves each token to exactly one dataset camera by name.
 *
 * Kept in sync with server/dive_tasks/multicam_pipeline.py
 * (resolve_pipeline_camera_order).
 */

/**
 * Role aliases: a slot token and a camera name match when they share a role,
 * or when the token itself appears as a segment of the camera name (so pipes
 * can name cameras literally, e.g. `# Camera Order: left, right`).
 */
export const CAMERA_ROLE_ALIASES: Record<string, readonly string[]> = {
  eo: ['eo', 'rgb', 'optical', 'color', 'colour', 'vis', 'visible'],
  ir: ['ir', 'thermal', 'lwir', 'mwir', 'flir'],
  uv: ['uv', 'ultraviolet'],
};

function segments(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((s) => s);
}

function roleOf(token: string): string | null {
  const lower = token.toLowerCase();
  const found = Object.entries(CAMERA_ROLE_ALIASES)
    .find(([, aliases]) => aliases.includes(lower));
  return found ? found[0] : null;
}

/** Cameras whose name matches a slot token, by literal segment or shared role. */
export function camerasMatchingSlot(token: string, cameras: string[]): string[] {
  const lower = token.toLowerCase();
  const exact = cameras.filter((camera) => camera.toLowerCase() === lower);
  if (exact.length) {
    return exact;
  }
  const role = roleOf(token);
  const aliases = new Set(role ? CAMERA_ROLE_ALIASES[role] : [lower]);
  return cameras.filter((camera) => segments(camera).some((seg) => aliases.has(seg)));
}

export type PipelineCameraOrderResult =
  | { order: string[]; error?: undefined }
  | { order?: undefined; error: string };

/**
 * Resolve declared slots to dataset cameras. Every slot must match exactly one
 * camera and no camera may fill two slots; anything else is an error message
 * naming the slot, the pipe's slots and the dataset's cameras so the user can
 * rename cameras (or fix the header) rather than get a silently mis-wired run.
 */
export function resolvePipelineCameraOrder(
  slots: string[],
  cameras: string[],
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
    const matches = camerasMatchingSlot(slot, cameras).filter((c) => !order.includes(c));
    if (matches.length !== 1) {
      const why = matches.length === 0
        ? 'no dataset camera matches'
        : `several dataset cameras match (${matches.join(', ')})`;
      return {
        error: `Cannot place pipeline camera "${slot}" (input${i + 1}): ${why}. ${context}. `
          + 'Rename the dataset cameras so each pipeline camera matches exactly one.',
      };
    }
    order.push(matches[0]);
  }
  return { order };
}

/** Parse the value of a `# Camera Order:` header into slot tokens. */
export function parseCameraOrderHeader(value: string): string[] {
  return value.trim().split(/[\s,]+/).filter((token) => token);
}
