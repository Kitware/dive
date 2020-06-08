/// <reference types="jest" />
import Vue from 'vue';
import CompositionApi from '@vue/composition-api';
import useTrackStore from './useTrackStore';

Vue.use(CompositionApi);

jest.mock('@/lib/api/viameDetection.service', () => ({}));

describe('useTrackStore', () => {
  it('can add and remove tracks', () => {
    const ts = useTrackStore({ markChangesPending: () => null });
    ts.addTrack(20);
    ts.addTrack(10);
    expect(Array.from(ts.trackMap.keys()).length).toBe(2);
    expect(ts.sortedTrackIds.value[0]).toBe(1);
  });

  it('marks changes pending when a track updates', () => {
    let didCall = false;
    const markChangesPending = () => { didCall = true; };
    const ts = useTrackStore({ markChangesPending });
    ts.addTrack(0);
    expect(didCall).toEqual(true);
  });
});
