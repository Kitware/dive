import { ref, Ref } from 'vue';

export default class TrackViewerSettingsStore {
  cameraParallelProjection: Ref<boolean>;

  onlyShowSelectedTrack: Ref<boolean>;

  detectionGlyphSize: Ref<number>;

  cubeAxesBounds: Ref<{
    xrange: [number, number];
    yrange: [number, number];
    zrange: [number, number];
  }>;

  adjustCubeAxesBoundsManually: Ref<boolean>;

  constructor() {
    this.cameraParallelProjection = ref(true);
    this.onlyShowSelectedTrack = ref(false);
    this.detectionGlyphSize = ref(0.003);

    this.cubeAxesBounds = ref({
      xrange: [-1, 1],
      yrange: [-1, 1],
      zrange: [-1, 1],
    });
    this.adjustCubeAxesBoundsManually = ref(false);
  }
}
