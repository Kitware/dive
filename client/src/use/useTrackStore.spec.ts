import Vue from 'vue';
import CompositionApi, { watchEffect } from '@vue/composition-api';
import useTrackStore from '@/use/useTrackStore';

Vue.use(CompositionApi);

jest.mock('@/lib/api/viameDetection.service', () => ({}));

describe('useTrackStore', () => {
  it('can add and remove tracks', () => {
    const ts = useTrackStore({ markChangesPending: () => null });
    const t0 = ts.addTrack(20);
    const t1 = ts.addTrack(10);
    expect(Array.from(ts.trackMap.keys()).length).toBe(2);
    expect(ts.sortedTrackIds.value[0]).toBe(1);
    expect(ts.intervalTree.search([10, 10]).length).toBe(1);
    expect(ts.intervalTree.search([10, 20]).length).toBe(2);

    ts.removeTrack(t1.trackId);
    expect(Array.from(ts.trackMap.keys()).length).toBe(1);
    expect(ts.sortedTrackIds.value[0]).toBe(0);
    expect(ts.intervalTree.search([10, 10]).length).toBe(0);
    expect(ts.intervalTree.search([10, 20]).length).toBe(1);

    ts.removeTrack(t0.trackId);
    expect(Array.from(ts.trackMap.keys()).length).toBe(0);
    expect(ts.sortedTrackIds.value.length).toBe(0);
    expect(ts.intervalTree.search([10, 10]).length).toBe(0);
    expect(ts.intervalTree.search([10, 20]).length).toBe(0);
  });

  it('marks changes pending when a track updates', () => {
    let didCall = false;
    const markChangesPending = () => { didCall = true; };
    const ts = useTrackStore({ markChangesPending });
    ts.addTrack(0);
    expect(didCall).toEqual(true);
  });

  it('updates a reactive list when member tracks change', async () => {
    const ts = useTrackStore({ markChangesPending: () => null });
    const track = ts.addTrack(0);

    let called = false;

    watchEffect(() => {
      if (ts.sortedTrackIds.value.length) {
        called = true;
      }
    });

    track.setAttribute('foo', 'bar');
    await Vue.nextTick();
    expect(called).toBeTruthy();
    called = false;

    track.setFeature({
      frame: 0,
    });
    await Vue.nextTick();
    expect(called).toBeTruthy();
    called = false;

    track.setType('foo');
    await Vue.nextTick();
    expect(called).toBeTruthy();
    called = false;
  });
});
