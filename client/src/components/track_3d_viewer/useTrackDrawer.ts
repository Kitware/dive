/* eslint-disable consistent-return */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Ref, watch } from 'vue';
import {
  useTrackFilters,
  useSelectedTrackId,
  useTrackStyleManager,
  useCameraStore,
} from 'vue-media-annotator/provides';
import * as vtkMath from '@kitware/vtk.js/Common/Core/Math';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import { AnnotationWithContext, TrackWithContext } from 'vue-media-annotator/BaseFilterControls';
import Track from 'vue-media-annotator/track';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkLookupTable from '@kitware/vtk.js/Common/Core/LookupTable';
import TrackManager, { TrackTracker } from './TrackManager';
import { injectAggregateController } from '../annotators/useMediaController';
import {
  getTrackColor, getTrackType, getTrackTypeColor, ViewUtils, Feature,
} from './trackUtils';
import { buildLookupTable } from './lookupTable';

export interface TrackDrawerParams {
  trackManager: TrackManager;
  onlyShowSelectedTrack: Ref<boolean>;
  detectionGlyphSize: Ref<number>;
  viewUtils: ViewUtils;
  renderer: Ref<vtkRenderer | undefined>;
}

export default function useTrackDrawer({
  trackManager,
  onlyShowSelectedTrack,
  detectionGlyphSize,
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

  // We uses a sphere to represents a detection in space
  const detectionGlyphSource = vtkSphereSource.newInstance();

  watch(detectionGlyphSize, (newSize) => {
    detectionGlyphSource.setRadius(newSize);
    viewUtils.rerender();
  }, {
    immediate: true,
  });

  detectionGlyphSource.setThetaResolution(20);

  const drawFeature = function drawFeature(
    points: vtkPoints,
    lines: vtkCellArray,
    trackColor: [number, number, number],
    { x, y, z }: { x: number; y: number; z: number},
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
    pointMapper.setInputConnection(detectionGlyphSource.getOutputPort());

    const pointActor = vtkActor.newInstance();

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

  const initializeTrack = function initializeTrack(trackWithContext: TrackWithContext) {
    const annotation = cameraStore.getTracksMerged(trackWithContext.annotation.id);

    // pre-process features in order to represent them
    const features: Feature[] = annotation.features
      .filter((feature) => feature !== undefined)
      .map((feature) => {
        const { attributes } = feature;

        if (!attributes) {
          return;
        }

        const { stereo3d_x: x, stereo3d_y: y, stereo3d_z: z } = attributes;

        if (x === undefined || y === undefined || z === undefined) {
          return;
        }

        return {
          x: Number(x),
          y: Number(y),
          z: Number(z),
          frameNumber: feature.frame,
        };
      })
      .filter((feature) => feature !== undefined) as Feature[];

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
      trackManager.registerTrack(annotation.id, trackActor, frameDetections, trackColor, trackType);
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

  const onFilteredAnnotationsChange = function onFilteredAnnotationsChange(
    annotations: AnnotationWithContext<Track>[],
  ) {
    const trackIds: AnnotationId[] = [];

    annotations.forEach((trackWithContext) => {
      const trackId = trackWithContext.annotation.id;
      trackIds.push(trackId);

      const trackTracker = trackManager.getTrack(trackId);

      // New track, so initialize it
      if (!trackTracker) {
        initializeTrack(trackWithContext);
      } else {
        // The track exists, so just show it
        trackTracker.hidden = false;
        trackTracker.trackActor.setVisibility(true);
      }
    });

    // All tracks that we have should be hidden
    trackManager.forEachTrack((track, trackId) => {
      if (!trackIds.includes(trackId)) {
        // eslint-disable-next-line no-param-reassign
        track.hidden = true;
        track.trackActor.setVisibility(false);
      }
    });

    viewUtils.rerender();
  };

  const initializeTracks = function drawTracks() {
    filteredTracksRef.filteredAnnotations.value.forEach(initializeTrack);

    onFrameChange(frameRef.value, undefined);
    onSelectedTrackChange(selectedTrackIdRef.value, null);
  };

  watch(selectedTrackIdRef, onSelectedTrackChange);
  watch(frameRef, onFrameChange);
  watch(onlyShowSelectedTrack, onOnlyShowSelectedTrackChange);
  watch(filteredTracksRef.filteredAnnotations, onFilteredAnnotationsChange);

  return {
    onSelectedTrackChange,
    onFrameChange,
    initializeTracks,
    initialize: initializeTracks,
  };
}
