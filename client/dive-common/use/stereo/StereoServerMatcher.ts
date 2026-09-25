import type { StereoMatcher, StereoMatchMethod } from './stereoMatcher';
import type { WarpOptions, WarpResult } from './StereoOnnxMatcher';

/** Identity of the frame pair a warp belongs to, from the transfer's frameKey. */
export interface FramePair {
  source: string;
  target: string;
  frame: number;
}

/** The transfer keys frames as `source>target@frame`. */
export function parseFrameKey(key: string | undefined): FramePair {
  const match = key?.match(/^(.+?)>(.+?)@(\d+)$/);
  if (!match) throw new Error('A server-side warp needs to know which frame it is for.');
  return { source: match[1], target: match[2], frame: Number(match[3]) };
}

export interface ServerStereoApi {
  transferPoints(request: {
    frame: number; sourceCamera: string; points: [number, number][]; method: StereoMatchMethod;
  }): Promise<{
    success: boolean; error?: string; transferredPoints?: [number, number][]; validMatches?: boolean[];
  }>;
  setFrame(frame: number, method: StereoMatchMethod): Promise<unknown>;
}

/**
 * A matcher whose correspondence search runs in VIAME's interactive service
 * on the server. The frame pixels and rig the transfer hands over are unused:
 * the server reads the same frames from its own copy of the dataset.
 */
export default class StereoServerMatcher implements StereoMatcher {
  private api: ServerStereoApi;

  private method: StereoMatchMethod;

  constructor(api: ServerStereoApi, method: StereoMatchMethod) {
    this.api = api;
    this.method = method;
  }

  async warpPoints(
    points: [number, number][],
    _source: unknown,
    _target: unknown,
    _rig: unknown,
    opts: WarpOptions,
  ): Promise<WarpResult[]> {
    if (!points.length) return [];
    const pair = parseFrameKey(opts.frameKey);
    const response = await this.api.transferPoints({
      frame: pair.frame, sourceCamera: pair.source, points, method: this.method,
    });
    if (!response.success) {
      throw new Error(response.error || 'The server could not map the points to the other camera.');
    }
    const mapped = response.transferredPoints ?? [];
    return points.map((_, i) => {
      const point = mapped[i];
      const valid = response.validMatches?.[i] !== false
        && !!point && Number.isFinite(point[0]) && Number.isFinite(point[1]);
      return {
        x: valid ? point[0] : NaN,
        y: valid ? point[1] : NaN,
        score: valid ? 1 : 0,
        secondScore: 0,
        accepted: valid,
      };
    });
  }

  async prepare(frameKey: string, _s: unknown, _t: unknown, _r: unknown, stillWanted?: () => boolean) {
    const pair = parseFrameKey(frameKey);
    if (stillWanted && !stillWanted()) return;
    await this.api.setFrame(pair.frame, this.method);
  }
}
