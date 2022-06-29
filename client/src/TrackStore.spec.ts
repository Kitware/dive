/// <reference types="jest" />
import Vue from 'vue';
import CompositionApi, { watchEffect } from '@vue/composition-api';
import TrackStore from './TrackStore';

Vue.use(CompositionApi);

describe('TrackStore', () => {
  it('can add and remove tracks', () => {
    const ts = new TrackStore({ markChangesPending: () => null, cameraName: 'singleCam' });
    const t0 = ts.add(20, 'foo', undefined, ts.getNewId());
    const t1 = ts.add(10, 'foo', undefined, ts.getNewId());
    expect(Array.from(ts.annotationMap.keys()).length).toBe(2);
    expect(ts.sorted.value[0].trackId).toBe(1);
    expect(ts.intervalTree.search([10, 10]).length).toBe(1);
    expect(ts.intervalTree.search([10, 20]).length).toBe(2);

    ts.remove(t1.id);
    expect(Array.from(ts.annotationMap.keys()).length).toBe(1);
    expect(ts.sorted.value[0].trackId).toBe(0);
    expect(ts.intervalTree.search([10, 10]).length).toBe(0);
    expect(ts.intervalTree.search([10, 20]).length).toBe(1);

    ts.remove(t0.id);
    expect(Array.from(ts.annotationMap.keys()).length).toBe(0);
    expect(ts.sorted.value.length).toBe(0);
    expect(ts.intervalTree.search([10, 10]).length).toBe(0);
    expect(ts.intervalTree.search([10, 20]).length).toBe(0);
  });

  it('can insert and delete single-frame detections', () => {
    const ts = new TrackStore({ markChangesPending: () => null, cameraName: 'singleCam' });
    ts.add(0, 'foo', undefined, ts.getNewId());
    const t1 = ts.add(0, 'bar', undefined, ts.getNewId());
    expect(Array.from(ts.annotationMap.keys()).length).toBe(2);

    ts.remove(t1.trackId);
    expect(Array.from(ts.annotationMap.keys()).length).toBe(1);
    expect(ts.intervalTree.search([0, 0])).toStrictEqual(['0']);
  });

  it('marks changes pending when a track updates', () => {
    let didCall = false;
    const markChangesPending = () => { didCall = true; };
    const ts = new TrackStore({ markChangesPending, cameraName: 'singleCam' });
    ts.add(0, 'foo', undefined, ts.getNewId());
    expect(didCall).toEqual(true);
  });

  it('throws an error when you access a track that is missing', () => {
    const markChangesPending = () => null;
    const ts = new TrackStore({ markChangesPending, cameraName: 'singleCam' });
    expect(() => ts.get(0)).toThrow('Annotation ID 0 not found in annotationMap.');
    ts.add(1000, 'foo', undefined, ts.getNewId());
    expect(ts.get(0)).toBeTruthy();
  });

  it('updates a reactive list when member tracks change', async () => {
    const ts = new TrackStore({ markChangesPending: () => null, cameraName: 'singleCam' });
    const track = ts.add(0, 'foo', undefined, ts.getNewId());

    let called = false;

    watchEffect(() => {
      if (ts.sorted.value.length) {
        called = true;
      }
    });

    track.setAttribute('foo', 'bar');
    await Vue.nextTick();
    expect(called).toBeTruthy();
    called = false;

    track.setFeature({
      keyframe: true,
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
