/**
 * Left/right pairing for stereo batch import.
 *
 * Recognizes l / left / r / right markers in folder and video file names and
 * pairs names that are otherwise identical, so `dive01_L.mp4` + `dive01_R.mp4`
 * or `left/` + `right/` resolve to one stereo dataset.
 */

export type StereoSide = 'left' | 'right';

const LEFT_TOKENS = new Set(['l', 'left']);
const RIGHT_TOKENS = new Set(['r', 'right']);

/** Name separators that delimit a side marker token. */
const DELIMITERS = /[_\-.\s]+/;

/** Drop a trailing file extension; names without one pass through. */
export function stripExtension(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(0, index) : name;
}

export interface StereoSideMatch {
  /** Name with the side marker removed; the pairing key. */
  stem: string;
  side: StereoSide;
}

/**
 * Detect a delimited l/left/r/right token. Requires exactly one such token, so
 * `cam_ir` (ends in "r" but tokenizes to cam + ir) and `left_right` are misses.
 */
export function detectStereoSideToken(name: string): StereoSideMatch | null {
  const parts = stripExtension(name).split(DELIMITERS).filter(Boolean);
  const matched: number[] = [];
  parts.forEach((part, index) => {
    const lower = part.toLowerCase();
    if (LEFT_TOKENS.has(lower) || RIGHT_TOKENS.has(lower)) {
      matched.push(index);
    }
  });
  if (matched.length !== 1) {
    return null;
  }
  const index = matched[0];
  return {
    stem: parts.filter((_, i) => i !== index).join('_'),
    side: LEFT_TOKENS.has(parts[index].toLowerCase()) ? 'left' : 'right',
  };
}

export interface StereoCharDiff {
  /** Shared name with the differing character removed. */
  stem: string;
  /** Which of the two inputs is the left camera. */
  leftFirst: boolean;
}

/**
 * Pair two names that differ at exactly one character where that character is
 * L/R, covering markers glued to the name (`camL.mp4` / `camR.mp4`).
 */
export function detectStereoSideByCharDiff(a: string, b: string): StereoCharDiff | null {
  const baseA = stripExtension(a);
  const baseB = stripExtension(b);
  if (baseA.length !== baseB.length || baseA === baseB) {
    return null;
  }
  let diffIndex = -1;
  for (let i = 0; i < baseA.length; i += 1) {
    if (baseA[i] !== baseB[i]) {
      if (diffIndex !== -1) {
        return null;
      }
      diffIndex = i;
    }
  }
  if (diffIndex === -1) {
    return null;
  }
  const charA = baseA[diffIndex].toLowerCase();
  const charB = baseB[diffIndex].toLowerCase();
  const stem = baseA.slice(0, diffIndex) + baseA.slice(diffIndex + 1);
  if (charA === 'l' && charB === 'r') {
    return { stem, leftFirst: true };
  }
  if (charA === 'r' && charB === 'l') {
    return { stem, leftFirst: false };
  }
  return null;
}

export interface StereoPair<T> {
  /** Shared name with the side marker removed; empty when the names are bare left/right. */
  stem: string;
  left: T;
  right: T;
}

export interface StereoPairingResult<T> {
  pairs: StereoPair<T>[];
  unpaired: T[];
}

/**
 * Pair a list of folder or video names into stereo pairs. Delimited markers are
 * matched first; whatever is left over is matched by single-character L/R
 * difference. A name that could join more than one pair is left unpaired.
 */
export function pairStereoNames<T>(
  items: T[],
  getName: (item: T) => string,
): StereoPairingResult<T> {
  const pairs: StereoPair<T>[] = [];
  const consumed = new Set<T>();

  const byStem = new Map<string, { left: T[]; right: T[] }>();
  items.forEach((item) => {
    const match = detectStereoSideToken(getName(item));
    if (!match) {
      return;
    }
    const group = byStem.get(match.stem) ?? { left: [], right: [] };
    group[match.side].push(item);
    byStem.set(match.stem, group);
  });

  // Sorted for deterministic output regardless of directory listing order.
  [...byStem.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([stem, group]) => {
      if (group.left.length !== 1 || group.right.length !== 1) {
        return;
      }
      pairs.push({ stem, left: group.left[0], right: group.right[0] });
      consumed.add(group.left[0]);
      consumed.add(group.right[0]);
    });

  const remaining = items.filter((item) => !consumed.has(item));
  const charPairs: { stem: string; left: T; right: T }[] = [];
  const ambiguous = new Set<T>();
  for (let i = 0; i < remaining.length; i += 1) {
    for (let j = i + 1; j < remaining.length; j += 1) {
      const diff = detectStereoSideByCharDiff(getName(remaining[i]), getName(remaining[j]));
      if (diff) {
        const [left, right] = diff.leftFirst
          ? [remaining[i], remaining[j]]
          : [remaining[j], remaining[i]];
        // A name matching more than one partner is too ambiguous to guess at.
        if (charPairs.some((pair) => pair.left === left || pair.right === left
          || pair.left === right || pair.right === right)) {
          ambiguous.add(left);
          ambiguous.add(right);
        } else {
          charPairs.push({ stem: diff.stem, left, right });
        }
      }
    }
  }

  charPairs.forEach((pair) => {
    if (ambiguous.has(pair.left) || ambiguous.has(pair.right)) {
      return;
    }
    pairs.push(pair);
    consumed.add(pair.left);
    consumed.add(pair.right);
  });

  return {
    pairs,
    unpaired: items.filter((item) => !consumed.has(item)),
  };
}
