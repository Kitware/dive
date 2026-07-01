<script lang="ts">
import {
  computed, defineComponent, ref, watch,
} from 'vue';
import {
  useCameraStore,
  useCameraCalibration,
  useDatasetId,
} from 'vue-media-annotator/provides';
import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';
import { useApi } from 'dive-common/apispec';

export default defineComponent({
  name: 'CameraCalibration',
  description: 'Camera Calibration',
  components: { TooltipBtn },
  setup() {
    const cameraStore = useCameraStore();
    const calibration = useCameraCalibration();
    const datasetId = useDatasetId();
    const { saveMetadata } = useApi();

    const cameras = computed(() => [...cameraStore.camMap.value.keys()]);
    const camLeft = ref<string | null>(null);
    const camRight = ref<string | null>(null);
    const saving = ref(false);

    // Default the selectors to the first two cameras.
    if (cameras.value.length >= 2) {
      [camLeft.value, camRight.value] = cameras.value;
    }

    watch([camLeft, camRight], () => {
      calibration.setActivePair(camLeft.value, camRight.value);
    }, { immediate: true });

    const activeKey = computed(() => calibration.activePairKey());
    const correspondences = computed(() => {
      const key = activeKey.value;
      return key ? (calibration.correspondences.value[key] || []) : [];
    });
    const canFit = computed(() => correspondences.value.length >= 4);
    const canExport = computed(() => correspondences.value.length >= 1);

    function setOverlayEnabled(enabled: boolean) {
      calibration.setOverlayEnabled(enabled);
    }

    async function save() {
      saving.value = true;
      try {
        calibration.maybeFitActivePair();
        await saveMetadata(datasetId.value, {
          cameraHomographies: calibration.homographies.value,
          cameraCorrespondences: calibration.correspondences.value,
        });
      } finally {
        saving.value = false;
      }
    }

    /**
     * Download the active pair's correspondences as a keypointgui-style
     * points.txt (leftX leftY rightX rightY), for VIAME's
     * itk_point_set_to_transform to build the .h5. Left/right order matches the
     * panel's Camera A / Camera B selection.
     */
    function exportPoints() {
      const key = activeKey.value;
      if (!key) {
        return;
      }
      const blob = new Blob([calibration.toPointsText(key)], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${camLeft.value}_to_${camRight.value}_points.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }

    return {
      cameras,
      camLeft,
      camRight,
      calibration,
      pickingEnabled: calibration.pickingEnabled,
      overlay: calibration.overlay,
      correspondences,
      canFit,
      canExport,
      saving,
      setOverlayEnabled,
      save,
      exportPoints,
    };
  },
});
</script>

<template>
  <div class="mx-4">
    <span class="text-body-2">
      Pick corresponding points between two cameras to fit an alignment homography.
    </span>
    <v-divider class="my-3" />

    <v-select
      v-model="camLeft"
      :items="cameras"
      label="Camera A (left)"
      dense
      outlined
      hide-details
      class="mb-3"
    />
    <v-select
      v-model="camRight"
      :items="cameras"
      label="Camera B (right)"
      dense
      outlined
      hide-details
      class="mb-3"
    />

    <v-switch
      v-model="pickingEnabled"
      label="Pick points"
      dense
      hide-details
      class="mt-0 mb-2"
    />
    <span class="text-caption grey--text">
      Click a point in one camera, then the matching point in the other.
    </span>

    <v-divider class="my-3" />

    <div class="d-flex align-center justify-space-between mb-1">
      <h4 class="mb-0">
        Correspondences ({{ correspondences.length }})
      </h4>
      <tooltip-btn
        color="error"
        icon="mdi-delete-sweep"
        :disabled="correspondences.length === 0"
        tooltip-text="Clear all correspondences for this pair"
        @click="calibration.clearPair()"
      />
    </div>
    <v-simple-table
      v-if="correspondences.length"
      dense
      class="mb-2"
    >
      <template #default>
        <thead>
          <tr>
            <th>#</th>
            <th>A (x, y)</th>
            <th>B (x, y)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(c, i) in correspondences"
            :key="c.id"
          >
            <td>{{ i + 1 }}</td>
            <td>{{ c.a[0].toFixed(1) }}, {{ c.a[1].toFixed(1) }}</td>
            <td>{{ c.b[0].toFixed(1) }}, {{ c.b[1].toFixed(1) }}</td>
            <td>
              <tooltip-btn
                color="error"
                icon="mdi-delete"
                tooltip-text="Remove this pair"
                @click="calibration.removeCorrespondence(c.id)"
              />
            </td>
          </tr>
        </tbody>
      </template>
    </v-simple-table>
    <span
      v-else
      class="text-caption grey--text"
    >
      No correspondences yet. At least 4 are required to preview the overlay.
    </span>

    <v-divider class="my-3" />

    <v-btn
      block
      color="info"
      small
      :disabled="!canExport"
      class="mb-2"
      @click="exportPoints"
    >
      Export points.txt
    </v-btn>
    <span class="text-caption grey--text">
      Saves rows of "leftX leftY rightX rightY" for VIAME's
      itk_point_set_to_transform (.h5). Columns follow the Camera A / Camera B order above.
    </span>

    <v-divider class="my-3" />

    <v-btn
      block
      color="success"
      small
      :disabled="!canExport"
      :loading="saving"
      class="mb-2"
      @click="save"
    >
      Save calibration
    </v-btn>

    <v-divider class="my-3" />

    <h4>Overlay (in-app alignment preview)</h4>

    <v-switch
      :input-value="overlay.enabled"
      label="Show overlay"
      dense
      hide-details
      :disabled="!canFit"
      class="mt-1"
      @change="setOverlayEnabled"
    />
    <span
      v-if="!canFit"
      class="text-caption grey--text"
    >
      At least 4 correspondences are required to preview the overlay.
    </span>

    <div v-if="canFit">
      <v-select
        v-model="overlay.direction"
        :items="[
          { text: 'Warp right onto left (B→A)', value: 'BtoA' },
          { text: 'Warp left onto right (A→B)', value: 'AtoB' },
        ]"
        label="Direction"
        dense
        outlined
        hide-details
        class="my-2"
      />
      <span class="text-caption">Opacity</span>
      <v-slider
        v-model="overlay.opacity"
        :min="0"
        :max="1"
        :step="0.05"
        dense
        hide-details
      />
    </div>
  </div>
</template>
