/**
 * Camera display order. camMap's key order is insertion order from an awaited
 * per-camera load loop, and entries survive a dataset switch, so anything that
 * reads "first" or "last" camera as rig geometry -- the registration reference
 * camera, the direction a loop-closure residual is measured in -- has to go
 * through the persisted order instead.
 */
// eslint-disable-next-line import/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';
import CameraStore from './CameraStore';

/**
 * A loaded multicam rig: cameras added (in whatever order the awaited load
 * loop produced) and the constructor's 'singleCam' placeholder pruned, as
 * Viewer.vue does once loading completes.
 */
function loadedStore(names: string[]): CameraStore {
  const s = new CameraStore({ markChangesPending: () => {} });
  names.forEach((n) => s.addCamera(n));
  s.removeCamera('singleCam');
  return s;
}

describe('CameraStore.orderedCameraNames', () => {
  it('falls back to camMap order when no order is published', () => {
    const s = loadedStore(['rgb', 'uv']);
    expect(s.orderedCameraNames()).toEqual(['rgb', 'uv']);
  });

  it('returns the persisted order regardless of insertion order', () => {
    // Arrive out of order, as an awaited load loop can produce.
    const s = loadedStore(['uv', 'rgb', 'ir']);
    expect([...s.camMap.value.keys()]).toEqual(['uv', 'rgb', 'ir']);
    s.displayOrder.value = ['rgb', 'ir', 'uv'];
    expect(s.orderedCameraNames()).toEqual(['rgb', 'ir', 'uv']);
  });

  it('ignores a stale order left by a previous dataset', () => {
    // Order naming cameras this dataset does not have must not win.
    const s = loadedStore(['left', 'right']);
    s.displayOrder.value = ['rgb', 'ir', 'uv'];
    expect(s.orderedCameraNames()).toEqual(['left', 'right']);
  });

  it('ignores a partial order that omits a present camera', () => {
    const s = loadedStore(['rgb', 'ir', 'uv']);
    s.displayOrder.value = ['rgb', 'ir'];
    expect(s.orderedCameraNames()).toEqual(['rgb', 'ir', 'uv']);
  });

  it('falls back mid-load, while the singleCam placeholder is still present', () => {
    // The transient that produced a spurious loop-closure warning: order is
    // published but the rig is not fully assembled yet.
    const s = new CameraStore({ markChangesPending: () => {} });
    s.addCamera('rgb');
    s.addCamera('ir');
    s.displayOrder.value = ['rgb', 'ir', 'uv'];
    expect(s.orderedCameraNames()).toEqual([...s.camMap.value.keys()]);
    expect(s.orderedCameraNames()).toContain('singleCam');
  });
});
