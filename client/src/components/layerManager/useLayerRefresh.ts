import { watch, Ref } from 'vue';
import type { AnnotationId } from '../../BaseAnnotation';
import type { TrackWithContext } from '../../BaseFilterControls';
import type { VisibleAnnotationTypes } from '../../layers';
import type { EditAnnotationTypes } from '../../layers/EditAnnotationLayer';
import type SegmentationPointsLayer from '../../layers/AnnotationLayers/SegmentationPointsLayer';
import type UILayer from '../../layers/UILayers/UILayer';
import type { ToolTipWidgetData } from '../../layers/UILayers/UILayerTypes';

interface DisableableLayer {
  disable(): void;
}

export interface LayerRefreshContext {
  hasFrameRef: Ref<boolean>;
  frameNumberRef: Ref<number>;
  editingModeRef: Ref<false | EditAnnotationTypes>;
  selectedTrackIdRef: Ref<AnnotationId | null>;
  multiSelectListRef: Ref<readonly AnnotationId[]>;
  enabledTracksRef: Ref<readonly TrackWithContext[]>;
  visibleModesRef: Ref<readonly VisibleAnnotationTypes[]>;
  selectedKeyRef: Ref<string>;
  colorBy: Ref<string> | string;
  layers: {
    rectAnnotationLayer: DisableableLayer;
    overlapLayer: DisableableLayer;
    polyAnnotationLayer: DisableableLayer;
    lineLayer: DisableableLayer;
    pointLayer: DisableableLayer;
    tailLayer: DisableableLayer;
    textLayer: DisableableLayer;
    attributeLayer: DisableableLayer;
    attributeBoxLayer: DisableableLayer;
    editAnnotationLayer: DisableableLayer;
    segmentationPointsLayer: SegmentationPointsLayer;
    uiLayer: UILayer;
  };
  hoverOvered: Ref<ToolTipWidgetData[]>;
  updateLayers: (
    frame: number,
    editingTrack: false | EditAnnotationTypes,
    selectedTrackId: AnnotationId | null,
    multiSelectList: readonly AnnotationId[],
    enabledTracks: readonly TrackWithContext[],
    visibleModes: readonly VisibleAnnotationTypes[],
    selectedKey: string,
    colorBy: string,
  ) => void;
}

export default function useLayerRefresh(ctx: LayerRefreshContext) {
  const colorByValue = () => (typeof ctx.colorBy === 'string' ? ctx.colorBy : ctx.colorBy.value);

  /**
   * Disables every annotation/edit layer without touching stored track
   * data. Used when this camera has no frame at the current aligned-
   * timeline slot (hasFrameRef false).
   */
  function disableAllLayers() {
    const { layers } = ctx;
    layers.rectAnnotationLayer.disable();
    layers.overlapLayer.disable();
    layers.polyAnnotationLayer.disable();
    layers.lineLayer.disable();
    layers.pointLayer.disable();
    layers.tailLayer.disable();
    layers.textLayer.disable();
    layers.attributeLayer.disable();
    layers.attributeBoxLayer.disable();
    layers.editAnnotationLayer.disable();
    layers.segmentationPointsLayer.clear();
    ctx.hoverOvered.value = [];
    layers.uiLayer.setToolTipWidget('customToolTip', false);
  }

  /** Re-runs updateLayers, or blanks the layers when this camera has no frame. */
  function refreshLayers() {
    if (!ctx.hasFrameRef.value) {
      disableAllLayers();
      return;
    }
    ctx.updateLayers(
      ctx.frameNumberRef.value,
      ctx.editingModeRef.value,
      ctx.selectedTrackIdRef.value,
      ctx.multiSelectListRef.value,
      ctx.enabledTracksRef.value,
      ctx.visibleModesRef.value,
      ctx.selectedKeyRef.value,
      colorByValue(),
    );
  }

  watch(ctx.hasFrameRef, () => refreshLayers());

  /**
   * TODO: for some reason, GeoJS requires us to initialize
   * by calling the render function twice.  This is a bug.
   * https://github.com/Kitware/dive/issues/365
   */
  [1, 2].forEach(() => {
    refreshLayers();
  });

  return { refreshLayers, disableAllLayers };
}
