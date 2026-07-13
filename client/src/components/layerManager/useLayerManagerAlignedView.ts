import {
  computed, watch, ComputedRef, Ref,
} from 'vue';
import type { AggregateMediaController, MediaController } from '../annotators/mediaControllerType';
import type AlignedViewStore from '../../alignedView/AlignedViewStore';
import AlignedImageLayer from '../../layers/AlignedImageLayer';
import type { EditAnnotationTypes } from '../../layers/EditAnnotationLayer';
import type { Feature } from '../../track';
import { applyHomography, invert3, Matrix3 } from '../../alignedView/homography';
import { mapBounds, mapRotatedBounds, mapGeoJSONFeatures } from '../../alignedView/alignedView';
import {
  geojsonToBound, isRotationValue, ROTATION_ATTRIBUTE_NAME, getRotationFromAttributes,
} from '../../utils';
import { getCameraQuadMedia } from './quadMediaSource';

export interface DisplayTransformLayer {
  setDisplayTransform(matrix: Matrix3 | null): void;
}

export default function useLayerManagerAlignedView(options: {
  camera: string;
  annotator: MediaController;
  aggregateController: Ref<AggregateMediaController>;
  alignedView?: AlignedViewStore;
  editingModeRef: Ref<false | EditAnnotationTypes>;
}) {
  const {
    camera, annotator, aggregateController, alignedView, editingModeRef,
  } = options;

  /**
   * Aligned view (SEAL-TK features 2 + 3): while active, this camera's
   * display transform (native -> reference space, null when unwarped).
   * Stored geometry stays native (decision D3); the transform is applied
   * at draw time only.
   */
  const alignedDisplayTransform = computed(
    () => (alignedView ? alignedView.cameraTransform(camera) : null),
  );

  /**
   * Inverse of the display transform (reference/display space -> this
   * camera's native space). The edit layer operates in geojs map
   * coordinates -- display space -- so draws and edits made while the
   * aligned view warps this camera must be mapped back through this before
   * being committed to (native) track storage.
   */
  const alignedDisplayInverse = computed<Matrix3 | null>(() => {
    const matrix = alignedDisplayTransform.value;
    if (!matrix) {
      return null;
    }
    try {
      return invert3(matrix);
    } catch {
      return null;
    }
  });

  /** Map a native-space location into display space for view centering. */
  const mapDisplayPoint = (x: number, y: number) => {
    const matrix = alignedDisplayTransform.value;
    if (!matrix) {
      return { x, y };
    }
    const [mx, my] = applyHomography(matrix, [x, y]);
    return { x: mx, y: my };
  };

  /** Map a display-space location back into native space. */
  const mapNativePoint = (x: number, y: number): [number, number] => {
    const inverse = alignedDisplayInverse.value;
    return inverse ? applyHomography(inverse, [x, y]) : [x, y];
  };

  /**
   * Copy a native-space track feature into display space for the edit
   * layer (identity passthrough when this camera renders unwarped), so
   * edit handles land on the warped imagery. The stored feature is never
   * mutated (decision D3: storage stays native).
   */
  function featureToDisplay(feature: Feature | null): Feature | null {
    const matrix = alignedDisplayTransform.value;
    if (!matrix || !feature) {
      return feature;
    }
    const mapped: Feature = { ...feature };
    const rotation = getRotationFromAttributes(feature.attributes);
    if (feature.bounds) {
      if (rotation !== undefined) {
        const rotated = mapRotatedBounds(matrix, feature.bounds, rotation);
        mapped.bounds = rotated.bounds;
        mapped.attributes = {
          ...feature.attributes,
          [ROTATION_ATTRIBUTE_NAME]: rotated.rotation,
        };
      } else {
        mapped.bounds = mapBounds(matrix, feature.bounds);
      }
    }
    if (feature.geometry) {
      mapped.geometry = {
        ...feature.geometry,
        features: mapGeoJSONFeatures(matrix, feature.geometry.features),
      };
    }
    return mapped;
  }

  // Created before the annotation layers in LayerManager so its geojs layer
  // z-orders beneath boxes/polygons/text (geojs stacks layers by creation order).
  const alignedImageLayer = new AlignedImageLayer({
    annotator,
    getImage: () => {
      try {
        return getCameraQuadMedia(
          (cam) => aggregateController.value.getController(cam),
          camera,
        );
      } catch {
        // Controllers may be cleared mid-poll during a dataset reload.
        return null;
      }
    },
    getTransform: () => alignedDisplayTransform.value,
    // Right-click means "remove last point" while creating/editing
    // geometry; recenter everywhere else.
    getRecenterEnabled: () => !editingModeRef.value,
  });

  /**
   * Apply (or clear) the aligned-view display transform: warp the imagery
   * quad and point every geometry layer's draw-time mapping at the same
   * matrix, then re-render.
   */
  function setupDisplayTransformWatches(
    displayTransformedLayers: DisplayTransformLayer[],
    onTransformChange: () => void,
    frameNumberRef: Ref<number>,
  ) {
    watch(alignedDisplayTransform, (matrix) => {
      displayTransformedLayers.forEach((layer) => layer.setDisplayTransform(matrix));
      alignedImageLayer.update();
      onTransformChange();
    }, { immediate: true });

    // The warped imagery must follow frame changes. This trigger covers the
    // seek itself (blanking promptly when a frame has no image, e.g. an
    // aligned-timeline gap); the element the seek eventually loads arrives
    // through the imageRevision watch below.
    watch(frameNumberRef, () => {
      if (alignedDisplayTransform.value) {
        alignedImageLayer.update();
      }
    });

    // ...and follow the displayed element itself: the annotator bumps
    // imageRevision whenever it redraws its media quad -- the async <img>
    // swap after a seek finishes loading, an image-enhancement change
    // (percentile-stretch URL remap or CSS filter toggle), or the initial
    // video quad. This is what keeps the warp's snapshot in step with the
    // actual pixels; the transform/frame watches only see triggers, not the
    // late-arriving element.
    watch(annotator.imageRevision, () => {
      if (alignedDisplayTransform.value) {
        alignedImageLayer.update();
      }
    });
  }

  /** Map a display-space edit back into native space before track storage. */
  function mapEditGeoJSONToNative(
    inverse: Matrix3 | null,
    data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>,
    type: string,
  ): {
    bounds?: ReturnType<typeof geojsonToBound>;
    rotation?: number;
    geoJSON?: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>;
  } {
    if (type === 'rectangle') {
      let bounds = geojsonToBound(data as GeoJSON.Feature<GeoJSON.Polygon>);
      let rotation = data.properties && isRotationValue(data.properties?.[ROTATION_ATTRIBUTE_NAME])
        ? data.properties[ROTATION_ATTRIBUTE_NAME] as number
        : undefined;
      if (inverse) {
        if (rotation !== undefined) {
          const mapped = mapRotatedBounds(inverse, bounds, rotation);
          bounds = mapped.bounds;
          rotation = mapped.rotation;
        } else {
          bounds = mapBounds(inverse, bounds);
        }
      }
      return { bounds, rotation };
    }
    const geoJSON = inverse ? mapGeoJSONFeatures(inverse, [data])[0] : data;
    return { geoJSON };
  }

  return {
    alignedImageLayer,
    alignedDisplayTransform,
    alignedDisplayInverse,
    mapDisplayPoint,
    mapNativePoint,
    featureToDisplay,
    setupDisplayTransformWatches,
    mapEditGeoJSONToNative,
  };
}

export type LayerManagerAlignedView = ReturnType<typeof useLayerManagerAlignedView>;
export type AlignedDisplayTransform = ComputedRef<Matrix3 | null>;
