<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import {
  useTrackViewerSettingsStore,
} from 'vue-media-annotator/provides';

export default defineComponent({
  name: 'TrackViewerSettings',

  setup() {
    const trackViewerSettingsStore = useTrackViewerSettingsStore();
    const {
      onlyShowSelectedTrack,
      cameraParallelProjection,
      detectionGlyphSize,
      adjustCubeAxesBoundsManually,
      cubeAxesBounds,
    } = trackViewerSettingsStore;
    return {
      onlyShowSelectedTrack,
      cameraParallelProjection,
      detectionGlyphSize,
      adjustCubeAxesBoundsManually,
      cubeAxesBounds,
    };
  },
});
</script>

<template>
  <v-card>
    <v-card-text>
      <v-list>
        <v-list-item>
          <v-list-item-action>
            <v-switch
              v-model="onlyShowSelectedTrack"
              color="purple"
            />
          </v-list-item-action>
          <v-list-item-title>Only show selected track</v-list-item-title>
        </v-list-item>

        <v-list-item>
          <v-list-item-action>
            <v-switch
              v-model="cameraParallelProjection"
              color="purple"
            />
          </v-list-item-action>
          <v-list-item-title>Camera parallel Projection</v-list-item-title>
        </v-list-item>
      </v-list>

      <v-text-field
        v-model="detectionGlyphSize"
        type="number"
        step="0.001"
        label="Detection Glyph Size"
      />

      <v-checkbox
        v-model="adjustCubeAxesBoundsManually"
        label="Adjust Axes Range manually"
      />

      <div v-if="adjustCubeAxesBoundsManually">
        <div class="d-flex flex-grow-1">
          <v-text-field
            :value="cubeAxesBounds.xrange[0]"
            label="minX"
            type="number"
            step="0.01"
            variant="outlined"
            density="compact"
            class="mr-2"
            @input="$set(cubeAxesBounds.xrange, 0, Number($event))"
          />

          <v-text-field
            :value="cubeAxesBounds.xrange[1]"
            label="maxX"
            type="number"
            variant="outlined"
            step="0.01"
            @input="$set(cubeAxesBounds.xrange, 1, Number($event))"
          />
        </div>

        <div class="d-flex">
          <v-text-field
            :value="cubeAxesBounds.yrange[0]"
            label="minY"
            type="number"
            step="0.01"
            class="mr-2"
            variant="outlined"
            @input="$set(cubeAxesBounds.yrange, 0, Number($event))"
          />
          <v-text-field
            :value="cubeAxesBounds.yrange[1]"
            label="maxY"
            type="number"
            variant="outlined"
            step="0.01"
            @input="$set(cubeAxesBounds.yrange, 1, Number($event))"
          />
        </div>

        <div class="d-flex">
          <v-text-field
            :value="cubeAxesBounds.zrange[0]"
            label="minZ"
            type="number"
            step="0.01"
            variant="outlined"
            class="mr-2"
            @input="$set(cubeAxesBounds.zrange, 0, Number($event))"
          />
          <v-text-field
            :value="cubeAxesBounds.zrange[1]"
            label="maxZ"
            type="number"
            variant="outlined"
            step="0.01"
            @input="$set(cubeAxesBounds.zrange, 1, Number($event))"
          />
        </div>
      </div>
    </v-card-text>
  </v-card>
</template>
