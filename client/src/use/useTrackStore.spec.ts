/// <reference types="jest" />
import useTrackStore from '@/use/useTrackStore';

describe('useTrackStore', () => {
  it('can add and remove tracks', () => {
    const ts = useTrackStore({ markChangesPending: () => {} });
    ts.addTrack();
    ts.addTrack();
    expect(Object.keys(ts.trackMap)).toBe(2);
  });

  it('marks changes pending when a track updates', () => {
    let didCall = false;
    const markChangesPending = () => { didCall = true; };
    const ts = useTrackStore({ markChangesPending });
    ts;
    const newTrack = ts.addTrack();
    expect(didCall).toEqual(true);
  });
});
