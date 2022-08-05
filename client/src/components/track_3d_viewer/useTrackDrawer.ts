/* eslint-disable consistent-return */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Ref, watch } from '@vue/composition-api';
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
import TrackManager, { TrackTracker } from './TrackManager';
import { injectAggregateController } from '../annotators/useMediaController';
import { ViewUtils, Feature, getTrackColor } from './trackUtils';

export default function useTrackDrawer(
  trackManager: TrackManager,
  onlyShowSelectedTrack: Ref<boolean>,
  viewUtils: ViewUtils,
) {
  const selectedTrackIdRef = useSelectedTrackId();
  const mediaController = injectAggregateController();
  const trackStyleManager = useTrackStyleManager();
  const filteredTracksRef = useTrackFilters();
  const cameraStore = useCameraStore();
  const { frame: frameRef } = mediaController.value;

  /**
   * Emphasize on a specific track: make sure it is visible, increase its line width and
   * set its color to selected
   */
  const emphasizeTrack = function emphasizeTrack(trackId: AnnotationId) {
    const trackActor = trackManager.getTrack(trackId)?.trackActor;

    if (!trackActor) {
      throw new Error(`Track actor not found for track id: ${trackId}`);
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
    const trackColor = getTrackColor(trackWithContext, trackStyleManager);

    // pre-process features in order to represent them
    const features: Feature[] = annotation.features
      .filter((feature) => feature !== undefined)
      .map((feature) => {
        const { attributes } = feature;

        if (!attributes) {
          return;
        }

        const { x, y, z } = attributes as { x: number; y: number; z: number };

        if (x === undefined || y === undefined || z === undefined) {
          return;
        }

        return {
          x,
          y,
          z,
          frameNumber: feature.frame,
        };
      })
      .filter((feature) => feature !== undefined) as Feature[];

    // Create the render objects for this track and render them
    const { trackActor, frameDetections } = viewUtils.createTrackActors(trackColor, features);

    trackManager.registerTrack(annotation.id, trackActor, frameDetections);
  };

  const initializeTracks = function drawTracks() {
    filteredTracksRef.filteredAnnotations.value.forEach(initializeTrack);
  };

  /**
   * Show the detections representation for the current frame and hide others.
   * If onlyShowSelectedTrack is true, only detections from this track will be shown.
   */
  const onFrameChange = function onFrameChange(
    newFrameNumber: number,
    oldFrameNumber?: number,
  ) {
    if (onlyShowSelectedTrack.value && selectedTrackIdRef.value !== null) {
      // Draw only detection from this frame and the selected track
      const actor = trackManager.getTrackFrameDetection(selectedTrackIdRef.value, newFrameNumber);

      if (actor) {
        actor.setVisibility(true);
      }
    } else {
      // Draw all frame actors if there are some.
      const currentFrameSphereActors = trackManager.getFrameActors(newFrameNumber);

      if (currentFrameSphereActors) {
        currentFrameSphereActors.forEach((sphereActor) => sphereActor.setVisibility(true));
      }
    }

    if (oldFrameNumber !== undefined) {
      const previousFrameSphereActors = trackManager.getFrameActors(oldFrameNumber);

      if (previousFrameSphereActors) {
        previousFrameSphereActors.forEach((sphereActor) => sphereActor.setVisibility(false));
      }
    }
    viewUtils.rerender();
  };

  /**
   * Emphasize on the new selected track and de-emphasize the previous one.
   */
  const onSelectedTrackChange = function onSelectedTrackChange(
    newTrackId: number|null,
    oldTrackId: number|undefined,
  ) {
    if (newTrackId) {
      emphasizeTrack(newTrackId);
    }

    if (oldTrackId) {
      const trackMap = trackManager.getTrack(oldTrackId);

      if (!trackMap) {
        throw new Error(`Track tracker not found for track id ${oldTrackId}`);
      }

      deEmphasizeTrack(oldTrackId, trackMap.trackActor);

      if (onlyShowSelectedTrack.value) {
        hideTrack(trackMap);
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

    viewUtils.rerender();
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

  // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
  // @ts-ignore

  watch(selectedTrackIdRef, onSelectedTrackChange);
  watch(frameRef, onFrameChange);
  watch(onlyShowSelectedTrack, onOnlyShowSelectedTrackChange);
  watch(filteredTracksRef.filteredAnnotations, onFilteredAnnotationsChange);

  return {
    onSelectedTrackChange,
    onFrameChange,
    initializeTracks,
  };
}
