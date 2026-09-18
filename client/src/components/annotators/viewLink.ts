export type ViewLinkResolver = (sourceCamera: string, point: [number, number]) =>
  Promise<[number, number] | null>;

export interface ViewLinkDeps {
  /** Centre of a pane in image coordinates; undefined when it has no map. */
  center: (paneKey: string) => { x: number; y: number } | undefined;
  cameraName: (paneKey: string) => string | undefined;
  /** Recentre every pane but the source on `point`. */
  recenter: (sourceKey: string, point: [number, number]) => void;
  synced: () => boolean;
  delayMs?: number;
}

/**
 * Keeps synchronised panes on the same object across a stereo rig. Plain
 * screen-delta sync stays in charge of the motion; once it settles, the
 * source pane's centre is looked up on the other camera and the other panes
 * recentre on it. A lookup that fails, is overtaken by a newer one, or lands
 * after sync was turned off leaves the plain sync as is.
 */
export default function createViewLink(deps: ViewLinkDeps) {
  const delay = deps.delayMs ?? 150;
  let resolver: ViewLinkResolver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request = 0;

  function setResolver(next: ViewLinkResolver | null) {
    resolver = next;
    clearTimeout(timer);
  }

  async function link(sourceKey: string) {
    const resolve = resolver;
    const center = deps.center(sourceKey);
    const sourceName = deps.cameraName(sourceKey);
    if (!resolve || !center || !sourceName || !deps.synced()) return;
    request += 1;
    const current = request;
    let target: [number, number] | null = null;
    try {
      target = await resolve(sourceName, [center.x, center.y]);
    } catch {
      target = null;
    }
    if (!target || current !== request || !deps.synced()) return;
    deps.recenter(sourceKey, target);
  }

  function schedule(sourceKey: string) {
    if (!resolver) return;
    clearTimeout(timer);
    timer = setTimeout(() => { link(sourceKey); }, delay);
  }

  return { setResolver, schedule, enabled: () => resolver !== null };
}
