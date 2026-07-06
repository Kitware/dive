/**
 * Pure helpers for the multicam "aligned view" (SEAL-TK features 2 + 3):
 * resolving a per-camera native->reference-space transform for every loaded
 * camera from the available sources, and composing camera-to-camera mappings
 * through the reference camera.
 *
 * Conventions (documented assumptions, see migration plan Q3):
 * - The REFERENCE camera is the first camera in display order
 *   (`meta.multiCamMedia.cameraOrder[0]`, i.e. `multiCamList[0]`). Its
 *   transform is the identity.
 * - Calibration-tool homographies are stored per directional pair key
 *   `camA::camB` with `AtoB` mapping camA pixels onto camB (and `BtoA` the
 *   inverse); a camera's path to the reference is found by composing pair
 *   edges (breadth-first, so up-to-3-camera rigs may chain e.g. UV->IR->EO).
 * - The calibration store is the SINGLE source the viewer resolves from:
 *   whatever the calibration panel shows/saves is what the Align button
 *   applies. External calibration .json files enter that same store, either
 *   through the panel's Load calibration button or by seeding the saved
 *   calibration at multicam import time.
 */
import {
  Matrix3, matMul3, invert3, applyHomography, Point,
} from './homography';
import type { CameraHomographies } from './CameraCalibrationStore';

export const IDENTITY3: Matrix3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** True when `m` is (numerically) the identity transform. */
export function isIdentityMatrix3(m: Matrix3, eps = 1e-9): boolean {
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      if (Math.abs(m[i][j] - IDENTITY3[i][j]) > eps) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Defensively validate an untrusted value (e.g. read from dataset meta JSON)
 * as a row-major 3x3 matrix usable as a display transform. Returns null for
 * anything malformed, non-finite, or singular (non-invertible) rather than
 * throwing, so callers can treat "bad matrix" as "no matrix".
 */
export function readTransformMatrix(raw: unknown): Matrix3 | null {
  if (!Array.isArray(raw) || raw.length !== 3) {
    return null;
  }
  const m: number[][] = [];
  for (let i = 0; i < 3; i += 1) {
    const row = raw[i];
    if (!Array.isArray(row) || row.length !== 3) {
      return null;
    }
    const nums = row.map(Number);
    if (nums.some((v) => !Number.isFinite(v))) {
      return null;
    }
    m.push(nums);
  }
  try {
    invert3(m);
  } catch {
    return null;
  }
  return m;
}

/** One directed edge of the calibration-pair graph: `matrix` maps `from` pixels onto `to`. */
interface PairEdge {
  to: string;
  matrix: Matrix3;
}

/** Build the bidirectional camera adjacency from calibration pair homographies. */
function buildPairGraph(homographies: CameraHomographies): Record<string, PairEdge[]> {
  const graph: Record<string, PairEdge[]> = {};
  const addEdge = (from: string, to: string, matrix: Matrix3) => {
    if (!graph[from]) {
      graph[from] = [];
    }
    graph[from].push({ to, matrix });
  };
  Object.entries(homographies).forEach(([key, pair]) => {
    const [camA, camB] = key.split('::');
    if (!camA || !camB || camA === camB || !pair) {
      return;
    }
    addEdge(camA, camB, pair.AtoB);
    addEdge(camB, camA, pair.BtoA);
  });
  return graph;
}

/**
 * Compose a `camera` -> `reference` matrix by walking the calibration pair
 * graph breadth-first (shortest hop count). Returns null when no path exists.
 */
export function composeThroughPairs(
  camera: string,
  reference: string,
  homographies: CameraHomographies,
): Matrix3 | null {
  if (camera === reference) {
    return IDENTITY3;
  }
  const graph = buildPairGraph(homographies);
  // BFS queue of (camera, accumulated camera->node matrix).
  const queue: { node: string; matrix: Matrix3 }[] = [{ node: camera, matrix: IDENTITY3 }];
  const visited = new Set<string>([camera]);
  while (queue.length) {
    const { node, matrix } = queue.shift() as { node: string; matrix: Matrix3 };
    const edges = graph[node] || [];
    for (let i = 0; i < edges.length; i += 1) {
      const edge = edges[i];
      if (!visited.has(edge.to)) {
        // p_to = edge.matrix * p_node and p_node = matrix * p_camera.
        const composed = matMul3(edge.matrix, matrix);
        if (edge.to === reference) {
          return composed;
        }
        visited.add(edge.to);
        queue.push({ node: edge.to, matrix: composed });
      }
    }
  }
  return null;
}

/**
 * Resolve a native->reference matrix for EVERY camera in `cameras` from the
 * calibration store's pair homographies, or null when any camera lacks a
 * usable transform (the aligned view is all-or-none: a partially-aligned
 * display would be misleading). The reference camera always maps by the
 * identity.
 */
export function resolveToReferenceTransforms(
  cameras: string[],
  reference: string,
  homographies: CameraHomographies,
): Record<string, Matrix3> | null {
  if (!cameras.length || !cameras.includes(reference)) {
    return null;
  }
  const result: Record<string, Matrix3> = {};
  for (let i = 0; i < cameras.length; i += 1) {
    const camera = cameras[i];
    if (camera === reference) {
      result[camera] = IDENTITY3;
    } else {
      const matrix = composeThroughPairs(camera, reference, homographies);
      if (!matrix) {
        return null;
      }
      result[camera] = matrix;
    }
  }
  return result;
}

/**
 * Matrix mapping `from`-camera native pixels onto `to`-camera native pixels,
 * composed through the shared reference space:
 * p_to = inv(T_to->ref) * T_from->ref * p_from.
 * Returns null when either camera has no resolved transform.
 */
export function cameraPairTransform(
  toReference: Record<string, Matrix3>,
  from: string,
  to: string,
): Matrix3 | null {
  const fromRef = toReference[from];
  const toRef = toReference[to];
  if (!fromRef || !toRef) {
    return null;
  }
  try {
    return matMul3(invert3(toRef), fromRef);
  } catch {
    return null;
  }
}

/** Map a point through a nullable transform (identity when null). */
export function mapPoint(matrix: Matrix3 | null, point: Point): Point {
  if (!matrix) {
    return point;
  }
  return applyHomography(matrix, point);
}
