/**
 * The `# Input:` / `# Output:` header of a pipe names one or more data types,
 * joined by `+` or `,`, each optionally qualified in parentheses, e.g.
 * `BBOX + MASK + HEAD-TAIL` or `IMAGE (per camera), BBOX (per camera)`.
 */
export interface PipelineDataType {
  name: string;
  qualifier?: string;
  icon?: string;
}

const ICONS: Record<string, string> = {
  IMAGE: 'mdi-image',
  VIDEO: 'mdi-video-vintage',
  TEXT: 'mdi-format-text',
  BBOX: 'mdi-vector-square',
  'FULL-SIZE-BBOX': 'mdi-square-outline',
  'HEAD-TAIL': 'mdi-vector-line',
  KEYPOINT: 'mdi-vector-point',
  KEYPOINTS: 'mdi-vector-point',
  MASK: 'mdi-vector-polygon',
  POLYGON: 'mdi-vector-polygon',
  POLYGONS: 'mdi-vector-polygon',
  TRACK: 'mdi-gesture',
  TRACKS: 'mdi-gesture',
  CALIBRATION: 'mdi-checkerboard',
};

function splitOutsideParentheses(spec: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  Array.from(spec).forEach((char) => {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === '+' || char === ',')) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  });
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part);
}

export function parsePipelineDataTypes(spec: string | undefined): PipelineDataType[] {
  if (!spec) {
    return [];
  }
  return splitOutsideParentheses(spec).map((part) => {
    const match = part.match(/^([^(]*?)\s*(?:\(([^)]*)\))?$/);
    const name = (match?.[1] || part).trim();
    const qualifier = match?.[2]?.trim() || undefined;
    return { name, qualifier, icon: ICONS[name.toUpperCase()] };
  });
}
