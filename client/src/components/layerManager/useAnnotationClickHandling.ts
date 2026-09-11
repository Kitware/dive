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
import pickPolygon from './polygonSelection';

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

  const clicked = (trackId: number, editing: boolean, modifiers?: { ctrl: boolean }, geo?: { x: number; y: number }) => {
    if (justFinalizedCreation) {
      return;
    }
    if (clickHandledThisTick) {
      return;
    }
    clickHandledThisTick = true;
    window.setTimeout(() => { clickHandledThisTick = false; }, 0);

    if (editing && trackId !== null && geo && editAnnotationLayer.type === 'Polygon') {
      if (selectedCamera.value !== camera) handler.selectCamera(camera, false);
      if (selectedCamera.value !== camera) return;
      const point = alignedView.mapNativePoint(geo.x, geo.y);
      const polygon = pickPolygon(polyAnnotationLayer.formattedData, trackId, point, true);
      if (polygon) {
        editAnnotationLayer.disable();
        handler.trackSelect(trackId, true);
        finishPolygonClick(trackId, polygon.polygonKey, true);
        return;
      }
    }

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

  // GeoJS may finish the current edit later in the same mouse event. Apply
  // polygon navigation after all layers have processed that click.
  let polygonNavigationPending = false;
  function finishPolygonClick(trackId: AnnotationId, polygonKey?: string, enterEditing = false) {
    if (polygonNavigationPending) return;
    polygonNavigationPending = true;
    const frame = frameNumberRef.value;
    const switchPolygon = enterEditing || (polygonKey !== undefined && polygonKey !== selectedKeyRef.value);
    window.setTimeout(() => {
      polygonNavigationPending = false;
      if (selectedCamera.value !== camera || frameNumberRef.value !== frame
          || selectedTrackIdRef.value !== trackId) return;
      editAnnotationLayer.disable();
      if (polygonKey !== undefined) handler.selectFeatureHandle(-1, polygonKey);
      // Select explicitly: trackEdit toggles the whole detection off when it
      // was already being edited, requiring an unwanted second right-click.
      handler.trackSelect(trackId, switchPolygon);
      refreshLayers();
    }, 0);
  }

  function wireHandlers() {
    editAnnotationLayer.bus.$on('editing-annotation-sync', (editing: boolean, deselect?: boolean) => {
      if (deselect) {
        handler.trackSelect(null, false);
      } else {
        handler.trackSelect(selectedTrackIdRef.value, editing);
      }
    });
    editAnnotationLayer.bus.$on('polygon-edit-right-click', (geo: { x: number; y: number }) => {
      const trackId = selectedTrackIdRef.value;
      if (selectedCamera.value !== camera || trackId === null || editingModeRef.value !== 'Polygon') return;
      const point = alignedView.mapNativePoint(geo.x, geo.y);
      const hit = pickPolygon(polyAnnotationLayer.formattedData, trackId as number, point);
      finishPolygonClick(trackId, hit?.polygonKey);
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

    polyAnnotationLayer.bus.$on('polygon-right-clicked', (trackId: number, polygonKey: string) => {
      if (polygonNavigationPending) return;
      if (selectedCamera.value === camera && trackId === selectedTrackIdRef.value
          && editingModeRef.value === 'Polygon' && editAnnotationLayer.getMode() !== 'creation') {
        // The edit-layer click resolves the actual polygon hit (including
        // holes) and applies the switch after GeoJS finishes this mouse event.
        return;
      }
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
      if (selectedCamera.value === camera && selectedTrackIdRef.value !== null
          && editingModeRef.value === 'Polygon' && editAnnotationLayer.getMode() !== 'creation') {
        // The edit layer also receives clicks in gaps between polygons.
        return;
      }
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
