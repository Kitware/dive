/**
 * Decode COCO RLE segmentations into outline polygons.
 *
 * Mirrors server/dive_utils/serializers/kwcoco.py: DIVE stores geometry, not
 * rasters, so an imported mask becomes its outline. Holes are not representable
 * and are dropped. A mask that cannot be decoded yields an empty result.
 */

/** Refuse allocation past this; 8K×8K is already beyond DIVE display sizes. */
const RLE_MAX_PIXELS = 64 * 1024 * 1024;

/** Clockwise Moore neighbourhood as (dx, dy), starting due east. */
const MOORE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * Run lengths from either COCO counts spelling.
 *
 * Uncompressed COCO writes a list of integers; pycocotools writes the same
 * runs LEB128-encoded into a string.
 */
function decodeRleCounts(counts: unknown): number[] | null {
  if (Array.isArray(counts)) {
    if (counts.every(
      (count) => typeof count === 'number'
        && Number.isInteger(count)
        && count >= 0,
    )) {
      return counts as number[];
    }
    return null;
  }
  if (typeof counts !== 'string') {
    return null;
  }

  const runs: number[] = [];
  let position = 0;
  while (position < counts.length) {
    let value = 0;
    let shift = 0;
    let more = true;
    while (more) {
      if (position >= counts.length) {
        return null;
      }
      const char = counts.charCodeAt(position) - 48;
      // Use multiplicative power rather than << so shifts past 31 stay exact.
      /* eslint-disable no-bitwise -- LEB128 digit packing from pycocotools */
      value += (char & 0x1f) * (2 ** shift);
      more = Boolean(char & 0x20);
      position += 1;
      shift += 5;
      // Final chunk carries the sign in bit 0x10 (pycocotools rleFrString).
      if (!more && (char & 0x10)) {
        value -= 2 ** shift;
      }
      /* eslint-enable no-bitwise */
    }
    // Runs past the first two are deltas against the run two places back.
    if (runs.length > 2) {
      value += runs[runs.length - 2];
    }
    runs.push(value);
  }
  return runs.every((run) => run >= 0) ? runs : null;
}

function polygonArea(points: [number, number][]): number {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x, y] = points[index];
    const [nextX, nextY] = points[(index + 1) % points.length];
    total += x * nextY - nextX * y;
  }
  return Math.abs(total) / 2;
}

/**
 * Moore-neighbour trace of one component's outer boundary.
 *
 * Pure typed arrays: walking the boundary costs the perimeter rather than the area.
 */
function traceContour(
  mask: Uint8Array,
  width: number,
  height: number,
  start: [number, number],
): [number, number][] {
  const contour: [number, number][] = [start];
  // Entering the start pixel from the west, so begin the search north of it.
  let previous: [number, number] = [start[0] - 1, start[1]];
  let current: [number, number] = start;
  let tracing = true;

  while (tracing) {
    const back: [number, number] = [previous[0] - current[0], previous[1] - current[1]];
    let index = MOORE_OFFSETS.findIndex(
      ([dx, dy]) => dx === back[0] && dy === back[1],
    );
    if (index < 0) {
      index = 0;
    }
    let found: [number, number] | null = null;
    for (let step = 1; step < 9; step += 1) {
      const [dx, dy] = MOORE_OFFSETS[(index + step) % 8];
      const candidate: [number, number] = [current[0] + dx, current[1] + dy];
      if (candidate[0] >= 0 && candidate[0] < width
        && candidate[1] >= 0 && candidate[1] < height) {
        if (mask[candidate[1] * width + candidate[0]]) {
          found = candidate;
          break;
        }
        previous = candidate;
      }
    }
    if (found === null) {
      tracing = false; // isolated pixel
    } else if (found[0] === start[0] && found[1] === start[1] && contour.length > 1) {
      tracing = false;
    } else {
      contour.push(found);
      previous = current;
      current = found;
      if (contour.length > 4 * height * width) {
        tracing = false; // cannot happen; refuses to spin
      }
    }
  }

  return contour.map(([x, y]) => [x, y]);
}

/**
 * Trace a COCO RLE mask into image-space polygon contours.
 *
 * Contours are sorted largest-area first so callers that take the first get the
 * primary outline. Holes are not representable and are dropped.
 */
function rlePolygonCoords(segmentation: unknown): [number, number][][] {
  if (!segmentation || typeof segmentation !== 'object' || Array.isArray(segmentation)) {
    return [];
  }
  const { size, counts } = segmentation as { size?: unknown; counts?: unknown };
  if (!Array.isArray(size) || size.length !== 2) {
    return [];
  }
  const [height, width] = size;
  if (!Number.isInteger(height) || !Number.isInteger(width)) {
    return [];
  }
  if (height <= 0 || width <= 0 || height * width > RLE_MAX_PIXELS) {
    return [];
  }

  const runs = decodeRleCounts(counts);
  if (runs === null || runs.reduce((sum, run) => sum + run, 0) !== height * width) {
    return [];
  }

  // Column-major flat buffer (COCO / Fortran order): index = x * height + y.
  const flat = new Uint8Array(height * width);
  let position = 0;
  runs.forEach((run, index) => {
    if (index % 2) {
      flat.fill(1, position, position + run);
    }
    position += run;
  });

  // Row-major mask for neighbour walks: index = y * width + x.
  const mask = new Uint8Array(height * width);
  let any = false;
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      if (flat[x * height + y]) {
        mask[y * width + x] = 1;
        any = true;
      }
    }
  }
  if (!any) {
    return [];
  }

  // Boundary = foreground with at least one background 4-neighbour.
  const visited = new Uint8Array(height * width);
  const coordLists: [number, number][][] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] && !visited[index]) {
        const up = y > 0 && mask[(y - 1) * width + x];
        const down = y + 1 < height && mask[(y + 1) * width + x];
        const left = x > 0 && mask[y * width + (x - 1)];
        const right = x + 1 < width && mask[y * width + (x + 1)];
        if (!(up && down && left && right)) {
          const contour = traceContour(mask, width, height, [x, y]);
          contour.forEach(([cx, cy]) => {
            visited[cy * width + cx] = 1;
          });
          if (contour.length >= 3) {
            coordLists.push(contour);
          }
        }
      }
    }
  }

  coordLists.sort((a, b) => polygonArea(b) - polygonArea(a));
  return coordLists;
}

export {
  RLE_MAX_PIXELS,
  decodeRleCounts,
  rlePolygonCoords,
};
