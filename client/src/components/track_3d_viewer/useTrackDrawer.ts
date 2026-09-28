/* eslint-disable consistent-return */

import { Ref, watch } from 'vue';
import {
  useTrackFilters,
  useSelectedTrackId,
  useTrackStyleManager,
  useCameraStore,
} from 'vue-media-annotator/provides';
import * as vtkMath from '@kitware/vtk.js/Common/Core/Math';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import { TrackWithContext } from 'vue-media-annotator/BaseFilterControls';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkConeSource from '@kitware/vtk.js/Filters/Sources/ConeSource';
import vtkLineSource from '@kitware/vtk.js/Filters/Sources/LineSource';
import vtkAppendPolyData from '@kitware/vtk.js/Filters/General/AppendPolyData';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkLookupTable from '@kitware/vtk.js/Common/Core/LookupTable';
import TrackManager, { TrackTracker } from './TrackManager';
import { injectAggregateController } from '../annotators/useMediaController';
import {
  getTrackColor, getTrackType, getTrackTypeColor, ViewUtils, Feature,
} from './trackUtils';
import { buildLookupTable } from './lookupTable';
import {
  Bounds3, featurePosition, robustBounds, Vec3,
} from './positions';

export interface TrackDrawerParams {
  trackManager: TrackManager;
  onlyShowSelectedTrack: Ref<boolean>;
  detectionGlyphSize: Ref<number>;
  positionedTrackCount: Ref<number>;
  viewUtils: ViewUtils;
  renderer: Ref<vtkRenderer | undefined>;
}

interface TrackEntry {
  trackWithContext: TrackWithContext;
  revision: string;
}

interface HeadMarker {
  cone: vtkConeSource;
  // Relative to the detection's midpoint, where its actor is positioned.
  head: Vec3;
  direction: Vec3;
}

export default function useTrackDrawer({
  trackManager,
  onlyShowSelectedTrack,
  detectionGlyphSize,
  positionedTrackCount,
  viewUtils,
  renderer,
}: TrackDrawerParams) {
  const selectedTrackIdRef = useSelectedTrackId();
  const mediaController = injectAggregateController();
  const trackStyleManager = useTrackStyleManager();
  const filteredTracksRef = useTrackFilters();
  const cameraStore = useCameraStore();
  const { frame: frameRef } = mediaController.value;
  const trackTypes: string[] = [];
  const trackKeys = new Map<AnnotationId, string>();
  const trackPositions = new Map<AnnotationId, Feature[]>();
  const headMarkers = new Map<vtkActor, HeadMarker>();
  let sceneBounds: Bounds3 | null = null;

  // We uses a sphere to represents a detection in space
  const detectionGlyphSource = vtkSphereSource.newInstance();

  /** The cone's tip sits on the head, pointing the way the animal faces. */
  const sizeHeadMarker = function sizeHeadMarker({ cone, head, direction }: HeadMarker) {
    const radius = detectionGlyphSource.getRadius();
    const height = 3 * radius;
    cone.setRadius(radius);
    cone.setHeight(height);
    cone.setCenter(...head.map((value, axis) => value - (direction[axis] * height) / 2) as Vec3);
  };

  /**
   * Positions are in the calibration's units, so the glyph is sized relative
   * to the extent of the data rather than by an absolute radius.
   */
  const updateGlyphRadius = function updateGlyphRadius() {
    const points: Vec3[] = [];
    trackPositions.forEach((features) => features.forEach(({
      x, y, z, head, tail,
    }) => {
      points.push([x, y, z], ...(head && tail ? [head, tail] : []));
    }));
    sceneBounds = robustBounds(points);
    const extent = sceneBounds
      ? Math.max(...[0, 2, 4].map((axis) => (sceneBounds as Bounds3)[axis + 1] - (sceneBounds as Bounds3)[axis]))
      : 0;
    const distance = sceneBounds ? Math.max(...sceneBounds.map(Math.abs)) : 0;
    let scale = 1;
    if (extent > 0) {
      scale = extent;
    } else if (distance > 0) {
      scale = distance;
    }
    detectionGlyphSource.setRadius((Number(detectionGlyphSize.value) / 100) * scale);
    headMarkers.forEach(sizeHeadMarker);
  };
  // eslint-disable-next-line no-param-reassign
  viewUtils.sceneBounds = () => sceneBounds;

  watch(detectionGlyphSize, () => {
    updateGlyphRadius();
    viewUtils.rerender();
  }, {
    immediate: true,
  });

  detectionGlyphSource.setThetaResolution(20);

  const drawFeature = function drawFeature(
    points: vtkPoints,
    lines: vtkCellArray,
    trackColor: [number, number, number],
    {
      x, y, z, head, tail,
    }: Feature,
    idx: number,
    frameDataArray: vtkDataArray,
    frameNumber: number,
  ) {
    points.setPoint(
      idx,
      x,
      y,
      z,
    );

    frameDataArray.setTuple(idx, [frameNumber]);

    if (idx > 0) {
      // eslint-disable-next-line no-param-reassign
      lines.getData()[idx] = idx - 1;
      // eslint-disable-next-line no-param-reassign
      lines.getData()[idx + 1] = idx;
    }

    const pointMapper = vtkMapper.newInstance();
    const pointActor = vtkActor.newInstance();
    const length = head && tail ? Math.hypot(...head.map((value, axis) => value - tail[axis])) : 0;

    if (head && tail && length > 0) {
      // Head and tail are known: draw the body as a segment through the midpoint
      const middle = [x, y, z];
      const localHead = head.map((value, axis) => value - middle[axis]) as Vec3;
      const localTail = tail.map((value, axis) => value - middle[axis]) as Vec3;
      const marker: HeadMarker = {
        cone: vtkConeSource.newInstance({ resolution: 12 }),
        head: localHead,
        direction: head.map((value, axis) => (value - tail[axis]) / length) as Vec3,
      };
      marker.cone.setDirection(...marker.direction);
      sizeHeadMarker(marker);
      headMarkers.set(pointActor, marker);

      const body = vtkLineSource.newInstance({ point1: localHead, point2: localTail });
      const glyph = vtkAppendPolyData.newInstance();
      glyph.setInputConnection(detectionGlyphSource.getOutputPort());
      glyph.addInputConnection(body.getOutputPort());
      glyph.addInputConnection(marker.cone.getOutputPort());
      pointMapper.setInputConnection(glyph.getOutputPort());
      pointActor.getProperty().setLineWidth(3);
    } else {
      pointMapper.setInputConnection(detectionGlyphSource.getOutputPort());
    }

    pointActor.setPosition(Number(x), Number(y), Number(z));
    pointActor.setMapper(pointMapper);
    pointActor.getProperty().setColor(...trackColor);
    pointActor.setVisibility(false);

    if (renderer.value) {
      renderer.value.addActor(pointActor);
    }

    return pointActor;
  };

  /**
   * A 3D track is vtkPolyData made of one single line.
   * Each point in this line represents a single detection.
   * The points are ordered by frame number.
   * We also store a point data field array to store the exact frame number of each point.
   */
  const drawTrack = function drawTrack(
    mapper: vtkMapper,
    trackColor: [number, number, number],
    features: Array<{x: number; y: number; z: number; frameNumber: number}>,
  ) {
    const numberOfFeatures = features.length;
    // One point stands for one detection
    const points = vtkPoints.newInstance();
    const trackPolyData = vtkPolyData.newInstance();

    const frameDataArray = vtkDataArray.newInstance({
      numberOfComponents: 1,
      size: numberOfFeatures,
      dataType: 'Uint32Array',
      name: 'frames',
    });

    const trackActor = vtkActor.newInstance();
    const trackActorProperty = trackActor.getProperty();
    points.setNumberOfPoints(numberOfFeatures);

    const lines = vtkCellArray.newInstance({ size: numberOfFeatures + 1 });
    lines.getData()[0] = numberOfFeatures;

    const frameDetections: [number, vtkActor][] = features
      .map((feature, idx) => {
        const featureActor = drawFeature(
          points,
          lines,
          trackColor,
          feature,
          idx,
          frameDataArray,
          feature.frameNumber,
        );
        return [feature.frameNumber, featureActor];
      });

    trackPolyData.setPoints(points);

    // store the frame number of each point
    trackPolyData.getPointData().setScalars(frameDataArray);

    mapper.setInputData(trackPolyData);
    trackPolyData.setLines(lines);

    // trackActorProperty.setColor(...trackColor);
    trackActorProperty.setLineWidth(3);
    trackActor.setMapper(mapper);

    if (renderer.value) {
      renderer.value.addActor(trackActor);
    }

    return {
      trackActor,
      frameDetections,
    };
  };

  /**
   * Emphasize on a specific track: make sure it is visible, increase its line width and
   * set its color to selected
   */
  const emphasizeTrack = function emphasizeTrack(trackId: AnnotationId) {
    const trackActor = trackManager.getTrack(trackId)?.trackActor;

    if (!trackActor) {
      return;
    }

    trackActor.setVisibility(true);
    trackActor.getProperty().setLineWidth(5);

    const selectedColor = vtkMath.hex2float(
      trackStyleManager.stateStyles.selected.color,
    ) as [number, number, number];

    trackActor.getProperty().setColor(...selectedColor);
  };

  const deEmphasizeTrack = function deEmphasizeTrack(trackId: AnnotationId, trackActor: vtkActor) {
    // Restore line width
    trackActor.getProperty().setLineWidth(3);

    const trackWithContext = filteredTracksRef
      .filteredAnnotations
      .value
      .find((track) => track.annotation.id === trackId);

    // If we do not find the track anymore in the list,
    // this is because the track has been filtered out in the meantime
    // In this case we cannot get the color, so we do nothing as the track will be hidden anyway
    if (trackWithContext) {
      const trackColor = getTrackColor(trackWithContext, trackStyleManager);
      trackActor.getProperty().setColor(...trackColor);
    }
  };

  const hideTrack = function hideTrack(trackMap: TrackTracker) {
    trackMap.trackActor.setVisibility(false);
    trackMap.detectionsMap.forEach((actor) => actor.setVisibility(false));
  };

  /**
   * Hide all tracks except the one matching the track id passed in the except param.
   */
  const hideAllTracks = function hideAllTracks(except?: AnnotationId | null) {
    trackManager.forEachTrack(({ trackActor, detectionsMap }, trackId) => {
      if (trackId !== except) {
        trackActor.setVisibility(false);
        detectionsMap.forEach((sphereActor) => {
          sphereActor.setVisibility(false);
        });
      }
    });
  };

  /**
   * Show all tracks, except the ones that are explicitly flagged as hidden
   */
  const showAllTracks = function showAllTracks() {
    trackManager.forEachTrack(({ trackActor, detectionsMap, hidden }) => {
      if (hidden) {
        return;
      }

      trackActor.setVisibility(true);
      detectionsMap.forEach((sphereActor, frameNumber) => {
        if (frameNumber === frameRef.value) {
          sphereActor.setVisibility(true);
        }
      });
    });
  };

  /**
   * One position per frame, from whichever camera's replica holds the
   * measurement, ordered by frame.
   */
  const trackFeatures = function trackFeatures(trackId: AnnotationId) {
    const byFrame = new Map<number, Feature>();
    cameraStore.getTrackAll(trackId).forEach((track) => {
      track.features.forEach((feature) => {
        if (!feature || byFrame.has(feature.frame)) {
          return;
        }
        const position = featurePosition(feature.attributes);
        if (position) {
          byFrame.set(feature.frame, { ...position, frameNumber: feature.frame });
        }
      });
    });
    return Array.from(byFrame.values()).sort((a, b) => a.frameNumber - b.frameNumber);
  };

  const removeTrack = function removeTrack(trackId: AnnotationId) {
    const trackTracker = trackManager.unregisterTrack(trackId);
    trackPositions.delete(trackId);
    if (!trackTracker) {
      return;
    }
    [trackTracker.trackActor, ...trackTracker.detectionsMap.values()].forEach((actor) => {
      headMarkers.delete(actor);
      if (renderer.value) {
        renderer.value.removeActor(actor);
      }
      actor.delete();
    });
  };

  const initializeTrack = function initializeTrack(trackWithContext: TrackWithContext) {
    const trackId = trackWithContext.annotation.id;
    const features = trackFeatures(trackId);

    if (features.length > 0) {
      const trackColor = getTrackColor(trackWithContext, trackStyleManager);
      const mapper = vtkMapper.newInstance({
        useLookupTableScalarRange: true,
      });
      mapper.setColorByArrayName('frames');
      mapper.setScalarVisibility(true);
      mapper.setColorModeToMapScalars();
      mapper.setInterpolateScalarsBeforeMapping(true);

      const { trackActor, frameDetections } = drawTrack(mapper, trackColor, features);

      const trackType = getTrackType(trackWithContext);
      trackTypes.push(trackType);
      trackManager.registerTrack(trackId, trackActor, frameDetections, trackColor, trackType);
      trackPositions.set(trackId, features);
    }
  };

  /**
   * Build one lookup table per track type.
   * Then, assign the correct lookup table to the track actor mapper.
   */
  const updateLookupTables = function updateLookupTables(currentFrame: number) {
    const trackTypeToLut: Map<string, vtkLookupTable> = new Map();
    trackTypes.forEach((trackType) => {
      if (!trackTypeToLut.get(trackType)) {
        const trackTypeColor = getTrackTypeColor(trackType, trackStyleManager);
        trackTypeToLut.set(trackType, buildLookupTable(trackTypeColor, currentFrame));
      }
    });

    trackManager.forEachTrack((trackTracker) => {
      const { trackType } = trackTracker;
      const lut = trackTypeToLut.get(trackType);
      const mapper = trackTracker.trackActor.getMapper();
      if (mapper) { mapper.setLookupTable(lut); }
    });
  };

  /**
   * Show the detections representation for the current frame and hide others.
   * If onlyShowSelectedTrack is true, only detections from this track will be shown.
   */
  const onFrameChange = function onFrameChange(
    newFrameNumber: number,
    oldFrameNumber?: number,
  ) {
    updateLookupTables(newFrameNumber);

    if (onlyShowSelectedTrack.value && selectedTrackIdRef.value !== null) {
      // Draw only detection from this frame and the selected track
      const actor = trackManager.getTrackFrameDetection(selectedTrackIdRef.value, newFrameNumber);

      if (actor) {
        actor.setVisibility(true);
      }
    } else {
      // Draw all frame actors if there are some.
      const frameTracker = trackManager.getFrameTracker(newFrameNumber);

      if (frameTracker) {
        frameTracker.detectionActors.forEach((detectionActor) => {
          detectionActor.setVisibility(true);
        });
      }
    }

    if (oldFrameNumber !== undefined) {
      const frameTracker = trackManager.getFrameTracker(oldFrameNumber);

      if (frameTracker) {
        frameTracker.detectionActors.forEach((sphereActor) => sphereActor.setVisibility(false));
      }
    }
    viewUtils.rerender();
  };

  /**
   * Emphasize on the new selected track and de-emphasize the previous one.
   */
  const onSelectedTrackChange = function onSelectedTrackChange(
    newTrackId: number|null,
    oldTrackId: number|null,
  ) {
    if (newTrackId) {
      emphasizeTrack(newTrackId);
    }

    if (oldTrackId) {
      const trackTracker = trackManager.getTrack(oldTrackId);

      if (!trackTracker) {
        return;
      }

      deEmphasizeTrack(oldTrackId, trackTracker.trackActor);

      if (onlyShowSelectedTrack.value) {
        hideTrack(trackTracker);
      }
    }

    viewUtils.rerender();
  };

  const onOnlyShowSelectedTrackChange = function onOnlyShowSelectedTrackChange(
    newOnlyShowSelectedTrack: boolean,
  ) {
    if (newOnlyShowSelectedTrack) {
      // Hide all tracks except the one that is selected (if there is one)
      hideAllTracks(selectedTrackIdRef.value);
    } else {
      showAllTracks();
    }

    viewUtils.rerender(true);
  };

  /** Reading each replica's revision re-runs the watcher when a track is edited. */
  const trackEntries = function trackEntries(): TrackEntry[] {
    return filteredTracksRef.filteredAnnotations.value.map((trackWithContext) => ({
      trackWithContext,
      revision: cameraStore.getTrackAll(trackWithContext.annotation.id)
        .map((track) => track.revision.value).join(','),
    }));
  };

  const onTracksChange = function onTracksChange(entries: TrackEntry[]) {
    if (!renderer.value) {
      return;
    }
    const trackIds = new Set<AnnotationId>();
    let rebuilt = false;

    entries.forEach(({ trackWithContext, revision }) => {
      const trackId = trackWithContext.annotation.id;
      trackIds.add(trackId);

      const key = `${revision}|${getTrackType(trackWithContext)}`;
      if (trackKeys.get(trackId) !== key) {
        removeTrack(trackId);
        initializeTrack(trackWithContext);
        trackKeys.set(trackId, key);
        rebuilt = true;
      }

      const trackTracker = trackManager.getTrack(trackId);
      if (trackTracker) {
        trackTracker.hidden = false;
        trackTracker.trackActor.setVisibility(
          !onlyShowSelectedTrack.value || selectedTrackIdRef.value === trackId,
        );
      }
    });

    Array.from(trackKeys.keys()).forEach((trackId) => {
      if (!trackIds.has(trackId)) {
        removeTrack(trackId);
        trackKeys.delete(trackId);
        rebuilt = true;
      }
    });

    if (rebuilt) {
      updateGlyphRadius();
      onFrameChange(frameRef.value, undefined);
      if (selectedTrackIdRef.value !== null) {
        emphasizeTrack(selectedTrackIdRef.value);
      }
    }
    // eslint-disable-next-line no-param-reassign
    positionedTrackCount.value = trackManager.getAllTracks().size;

    viewUtils.rerender();
  };

  const initializeTracks = function drawTracks() {
    onTracksChange(trackEntries());
    onSelectedTrackChange(selectedTrackIdRef.value, null);
  };

  watch(selectedTrackIdRef, onSelectedTrackChange);
  watch(frameRef, onFrameChange);
  watch(onlyShowSelectedTrack, onOnlyShowSelectedTrackChange);
  watch(trackEntries, onTracksChange);

  return {
    onSelectedTrackChange,
    onFrameChange,
    initializeTracks,
    initialize: initializeTracks,
  };
}
