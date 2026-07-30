import type { Ref } from 'vue';
import type { AnnotationId } from '../../BaseAnnotation';
import type { Handler } from '../../provides';
import type EditAnnotationLayer from '../../layers/EditAnnotationLayer';
import type { EditAnnotationTypes } from '../../layers/EditAnnotationLayer';
import type RectangleLayer from '../../layers/AnnotationLayers/RectangleLayer';
import type PolygonLayer from '../../layers/AnnotationLayers/PolygonLayer';
import type LineLayer from '../../layers/AnnotationLayers/LineLayer';
import type { LayerManagerAlignedView } from './useLayerManagerAlignedView';
import routeMulticamEditToCamera from './useMulticamEditRouting';
import type CameraStore from '../../CameraStore';
import type TrackStore from '../../TrackStore';
import { pointInPolygon } from '../../utils';

export default function useAnnotationClickHandling(options: {
  camera: string;
  handler: Handler;
  selectedCamera: Ref<string>;
  selectedTrackIdRef: Ref<AnnotationId | null>;
  selectedKeyRef: Ref<string>;
  frameNumberRef: Ref<number>;
  flickNumberRef: Ref<number>;
  editingModeRef: Ref<false | EditAnnotationTypes>;
  cameraStore: CameraStore;
  trackStore: TrackStore;
  alignedView: Pick<
    LayerManagerAlignedView,
    'alignedDisplayInverse' | 'mapNativePoint' | 'mapEditGeoJSONToNative'
  >;
  editAnnotationLayer: EditAnnotationLayer;
  rectAnnotationLayer: RectangleLayer;
  polyAnnotationLayer: PolygonLayer;
  lineLayer: LineLayer;
  refreshLayers: () => void;
}) {
  const {
    camera,
    handler,
    selectedCamera,
    selectedTrackIdRef,
    selectedKeyRef,
    frameNumberRef,
    flickNumberRef,
    editingModeRef,
    cameraStore,
    trackStore,
    alignedView,
    editAnnotationLayer,
    rectAnnotationLayer,
    polyAnnotationLayer,
    lineLayer,
    refreshLayers,
  } = options;

  // Set briefly when a draw finalizes so the same click doesn't also select
  // an overlapping existing detection. Cleared on the next macrotask.
  let justFinalizedCreation = false;

  // Guards against a single physical click being handled more than once when
  // it lands on overlapping features on different layers.
  let clickHandledThisTick = false;

  const clicked = (trackId: number, editing: boolean, modifiers?: { ctrl: boolean }) => {
    if (justFinalizedCreation) {
      return;
    }
    if (clickHandledThisTick) {
      return;
    }
    clickHandledThisTick = true;
    window.setTimeout(() => { clickHandledThisTick = false; }, 0);

    if (selectedCamera.value !== camera) {
      if (editAnnotationLayer.getMode() === 'creation' && !editing) {
        return;
      }
      if (trackId !== null) {
        handler.selectCamera(camera, false);
        if (selectedCamera.value === camera) {
          handler.trackSelect(trackId, false, modifiers);
          if (editing) {
            handler.trackEdit(trackId);
          }
        }
      }
      return;
    }
    if (editAnnotationLayer.getMode() !== 'creation') {
      editAnnotationLayer.disable();
      if (editing && trackId !== null) {
        handler.trackEdit(trackId);
      } else {
        handler.trackSelect(trackId, editing, modifiers);
      }
    } else if (editing && trackId !== null) {
      editAnnotationLayer.disable();
      handler.trackEdit(trackId);
    }
  };

  function wireHandlers() {
    editAnnotationLayer.bus.$on('editing-annotation-sync', (editing: boolean, deselect?: boolean) => {
      if (deselect) {
        handler.trackSelect(null, false);
      } else {
        handler.trackSelect(selectedTrackIdRef.value, editing);
      }
    });
    editAnnotationLayer.bus.$on('confirm-annotation', () => {
      handler.confirmRecipe();
    });
    handler.registerFinalizeCreation(() => {
      editAnnotationLayer.finalizeInProgress();
    });

    rectAnnotationLayer.bus.$on('annotation-clicked', clicked);
    rectAnnotationLayer.bus.$on('annotation-right-clicked', clicked);
    rectAnnotationLayer.bus.$on('annotation-ctrl-clicked', clicked);
    polyAnnotationLayer.bus.$on('annotation-clicked', clicked);
    polyAnnotationLayer.bus.$on('annotation-right-clicked', clicked);
    polyAnnotationLayer.bus.$on('annotation-ctrl-clicked', clicked);
    lineLayer.bus.$on('annotation-clicked', clicked);
    lineLayer.bus.$on('annotation-right-clicked', clicked);

    polyAnnotationLayer.bus.$on('polygon-right-clicked', (_trackId: number, polygonKey: string) => {
      if (editAnnotationLayer.getMode() === 'creation') {
        handler.cancelCreation();
      }
      handler.selectFeatureHandle(-1, polygonKey);
      window.setTimeout(() => refreshLayers(), 0);
    });

    polyAnnotationLayer.bus.$on('polygon-clicked', (_trackId: number, polygonKey: string) => {
      if (editAnnotationLayer.getMode() === 'creation') {
        return;
      }
      handler.selectFeatureHandle(-1, polygonKey);
      window.setTimeout(() => refreshLayers(), 0);
    });

    polyAnnotationLayer.bus.$on('polygon-right-clicked-outside', () => {
      if (editAnnotationLayer.getMode() === 'creation') {
        handler.cancelCreation();
        handler.selectFeatureHandle(-1, '');
        window.setTimeout(() => refreshLayers(), 0);
      }
    });

    editAnnotationLayer.bus.$on('update:geojson', (
      mode: 'in-progress' | 'editing',
      geometryCompleteEvent: boolean,
      data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>,
      type: string,
      key = '',
      cb: () => void = () => (undefined),
    ) => {
      if (routeMulticamEditToCamera({
        camera,
        selectedCamera,
        frameNumberRef,
        selectedTrackIdRef,
        editingModeRef,
        selectedKeyRef,
        cameraStore,
        trackStore,
        handler,
      })) {
        return;
      }

      const inverse = alignedView.alignedDisplayInverse.value;
      const mapped = alignedView.mapEditGeoJSONToNative(inverse, data, type);
      if (type === 'rectangle' && mapped.bounds) {
        cb();
        handler.updateRectBounds(
          frameNumberRef.value,
          flickNumberRef.value,
          mapped.bounds,
          mapped.rotation,
        );
      } else if (mapped.geoJSON) {
        handler.updateGeoJSON(
          mode,
          frameNumberRef.value,
          flickNumberRef.value,
          mapped.geoJSON,
          key,
          cb,
        );
      }
      if (geometryCompleteEvent) {
        justFinalizedCreation = true;
        window.setTimeout(() => { justFinalizedCreation = false; }, 0);
        refreshLayers();
      }
    });

    editAnnotationLayer.bus.$on(
      'update:selectedIndex',
      (index: number, _type: EditAnnotationTypes, key?: string) => {
        if (index >= 0 && key !== undefined) {
          handler.selectFeatureHandle(index, key);
        } else {
          handler.selectFeatureHandle(index, selectedKeyRef.value);
        }
      },
    );

    editAnnotationLayer.bus.$on('click-outside-edit', (geo: { x: number; y: number }) => {
      const point = alignedView.mapNativePoint(geo.x, geo.y);
      const polygonData = polyAnnotationLayer.formattedData;
      const clickedPolygon = polygonData.find((item) => {
        const rings = item.polygon.coordinates;
        const outer = rings[0].map(([x, y]) => ({ x, y }));
        const holes = rings.slice(1).map((ring) => ring.map(([x, y]) => ({ x, y })));
        return pointInPolygon({ x: point[0], y: point[1] }, outer, holes);
      });
      if (clickedPolygon) {
        handler.selectFeatureHandle(-1, clickedPolygon.polygonKey || '');
        window.setTimeout(() => refreshLayers(), 0);
      }
    });
  }

  return { wireHandlers };
}
