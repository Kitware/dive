<script lang="ts">
import {
  computed, defineComponent, ref, watch,
} from 'vue';
import {
  useCameraStore,
  useCameraCalibration,
  useDatasetId,
} from 'vue-media-annotator/provides';
import { TransformType, TRANSFORM_TYPES, minPointsForTransform } from 'vue-media-annotator/transform';
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
    const transformType = computed<TransformType>(
      () => (activeKey.value ? calibration.transformTypeForPair(activeKey.value) : 'homography'),
    );
    const minPoints = computed(() => minPointsForTransform(transformType.value));
    const canFit = computed(() => correspondences.value.length >= minPoints.value);
    const canExport = computed(() => correspondences.value.length >= 1);
    const canClearLast = computed(
      () => calibration.pendingPoint.value !== null || correspondences.value.length > 0,
    );

    const alignmentModeItems = computed(() => [
      { text: 'Original (no alignment)', value: 'original' },
      { text: `Warp ${camLeft.value ?? 'A'} onto ${camRight.value ?? 'B'}`, value: 'AtoB', disabled: !canFit.value },
      { text: `Warp ${camRight.value ?? 'B'} onto ${camLeft.value ?? 'A'}`, value: 'BtoA', disabled: !canFit.value },
    ]);

    function setTransformType(type: TransformType) {
      const key = activeKey.value;
      if (key) {
        calibration.setTransformType(key, type);
      }
    }

    function setAlignmentMode(mode: 'original' | 'AtoB' | 'BtoA') {
      calibration.setAlignmentMode(mode);
    }

    function setPickTarget(target: 'native' | 'ghost') {
      calibration.setPickTarget(target);
    }

    /** Live cursor readout text: this camera's coord, and its linked point in the other camera. */
    const cursorReadout = computed(() => {
      const cursor = calibration.cursorCoord.value;
      if (!cursor) {
        return null;
      }
      const [x, y] = cursor.coord;
      const other = calibration.linkedPoint(cursor.camera, cursor.coord);
      const here = `${cursor.camera}: (${x.toFixed(1)}, ${y.toFixed(1)})`;
      if (!other) {
        return here;
      }
      const [ox, oy] = other.coord;
      return `${here} -> ${other.camera}: (${ox.toFixed(1)}, ${oy.toFixed(1)})`;
    });

    async function save() {
      saving.value = true;
      try {
        calibration.maybeFitActivePair();
        await saveMetadata(datasetId.value, {
          cameraHomographies: calibration.homographies.value,
          cameraCorrespondences: calibration.correspondences.value,
          cameraTransformTypes: calibration.transformTypes.value,
        });
      } finally {
        saving.value = false;
      }
    }

    /** Trigger a browser download of `text` as `filename`. */
    function downloadText(text: string, filename: string) {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
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
      downloadText(calibration.toPointsText(key), `${camLeft.value}_to_${camRight.value}_points.txt`);
    }

    /**
     * Download the fitted homography (fitting first if needed) as a
     * whitespace-separated 3x3 matrix .txt, matching keypointgui's Save
     * Left->Right / Right->Left Homography.
     */
    function exportHomography(direction: 'AtoB' | 'BtoA') {
      const key = activeKey.value;
      if (!key) {
        return;
      }
      calibration.maybeFitActivePair();
      const text = calibration.toHomographyText(key, direction);
      if (!text) {
        return;
      }
      const [from, to] = direction === 'AtoB' ? [camLeft.value, camRight.value] : [camRight.value, camLeft.value];
      downloadText(text, `${from}_to_${to}_homography.txt`);
    }

    const pointsFileInput = ref<HTMLInputElement | null>(null);
    const loadPointsDialog = ref(false);
    const loadPointsError = ref<string | null>(null);
    const pendingLoadText = ref<string | null>(null);

    function applyLoadedPoints(text: string, mode: 'replace' | 'merge') {
      const key = activeKey.value;
      if (!key) {
        return;
      }
      loadPointsError.value = null;
      try {
        calibration.loadPointsFromText(key, text, mode);
      } catch (e) {
        loadPointsError.value = e instanceof Error ? e.message : String(e);
      }
    }

    /** File input change handler for Load points.txt; prompts for replace/merge if the pair already has points. */
    function onPointsFileSelected(event: Event) {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? '');
        if (correspondences.value.length > 0) {
          pendingLoadText.value = text;
          loadPointsDialog.value = true;
        } else {
          applyLoadedPoints(text, 'replace');
        }
      };
      reader.readAsText(file);
    }

    function confirmLoadPoints(mode: 'replace' | 'merge') {
      loadPointsDialog.value = false;
      if (pendingLoadText.value !== null) {
        applyLoadedPoints(pendingLoadText.value, mode);
        pendingLoadText.value = null;
      }
    }

    return {
      cameras,
      camLeft,
      camRight,
      calibration,
      pickingEnabled: calibration.pickingEnabled,
      alignment: calibration.alignment,
      linkedNav: calibration.linkedNav,
      cursorReadout,
      correspondences,
      transformType,
      transformTypeItems: TRANSFORM_TYPES,
      minPoints,
      alignmentModeItems,
      canFit,
      canExport,
      canClearLast,
      saving,
      pointsFileInput,
      loadPointsDialog,
      loadPointsError,
      setTransformType,
      setAlignmentMode,
      setPickTarget,
      save,
      exportPoints,
      exportHomography,
      onPointsFileSelected,
      confirmLoadPoints,
    };
  },
});
</script>

<template>
  <div class="mx-4">
    <span class="text-body-2">
      Pick corresponding points between two cameras to fit an alignment transform.
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
      Right-click to recenter both cameras on that point (requires a fitted
      transform).
    </span>

    <v-switch
      v-model="linkedNav"
      label="Link pan/zoom"
      dense
      hide-details
      class="mt-0 mb-2"
    />
    <span class="text-caption grey--text">
      Panning or zooming either camera recenters the other on the same point
      (requires a fitted transform).
    </span>

    <div
      v-if="pickingEnabled"
      class="text-caption mt-2"
      style="font-family: monospace;"
    >
      {{ cursorReadout || 'Move the cursor over a camera to see its coordinates.' }}
    </div>

    <v-divider class="my-3" />

    <div class="d-flex align-center justify-space-between mb-1">
      <h4 class="mb-0">
        Correspondences ({{ correspondences.length }})
      </h4>
      <div>
        <tooltip-btn
          icon="mdi-undo"
          :disabled="!canClearLast"
          tooltip-text="Undo the pending point, or the last completed pair"
          @click="calibration.clearLast()"
        />
        <tooltip-btn
          color="error"
          icon="mdi-delete-sweep"
          :disabled="correspondences.length === 0"
          tooltip-text="Clear all correspondences for this pair"
          @click="calibration.clearPair()"
        />
      </div>
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
      No correspondences yet. At least {{ minPoints }} required for the selected transform.
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

    <input
      ref="pointsFileInput"
      type="file"
      accept=".txt"
      style="display: none"
      @change="onPointsFileSelected"
    >
    <v-btn
      block
      outlined
      small
      class="mt-2 mb-2"
      @click="pointsFileInput.click()"
    >
      Load points.txt
    </v-btn>
    <span
      v-if="loadPointsError"
      class="text-caption error--text d-block"
    >
      {{ loadPointsError }}
    </span>

    <v-dialog
      v-model="loadPointsDialog"
      max-width="420"
    >
      <v-card>
        <v-card-title>Load points.txt</v-card-title>
        <v-card-text>
          This pair already has {{ correspondences.length }} correspondence(s).
          Replace them with the loaded points, or merge the loaded points in?
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            text
            @click="loadPointsDialog = false"
          >
            Cancel
          </v-btn>
          <v-btn
            text
            @click="confirmLoadPoints('merge')"
          >
            Merge
          </v-btn>
          <v-btn
            color="primary"
            text
            @click="confirmLoadPoints('replace')"
          >
            Replace
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-divider class="my-3" />

    <v-btn
      block
      outlined
      small
      :disabled="!canFit"
      class="mb-2"
      @click="exportHomography('AtoB')"
    >
      Export A→B homography.txt
    </v-btn>
    <v-btn
      block
      outlined
      small
      :disabled="!canFit"
      class="mb-2"
      @click="exportHomography('BtoA')"
    >
      Export B→A homography.txt
    </v-btn>
    <span class="text-caption grey--text">
      Saves the fitted 3x3 matrix as whitespace-separated rows, matching
      keypointgui's Save Homography.
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

    <h4>Transform Type</h4>
    <v-select
      :value="transformType"
      :items="transformTypeItems"
      item-text="text"
      item-value="value"
      label="Transform type"
      dense
      outlined
      hide-details
      class="my-2"
      @change="setTransformType"
    />
    <span class="text-caption grey--text">
      Needs at least {{ minPoints }} correspondence pair(s) ({{ correspondences.length }} picked).
    </span>

    <v-divider class="my-3" />

    <h4>Alignment (in-app aligned picking)</h4>

    <v-select
      :value="alignment.mode"
      :items="alignmentModeItems"
      item-text="text"
      item-value="value"
      label="Alignment mode"
      dense
      outlined
      hide-details
      class="my-2"
      @change="setAlignmentMode"
    />
    <span
      v-if="!canFit"
      class="text-caption grey--text"
    >
      At least {{ minPoints }} correspondence pair(s) are required to align.
    </span>

    <div v-if="alignment.mode !== 'original'">
      <span class="text-caption">Ghost opacity</span>
      <v-slider
        v-model="alignment.opacity"
        :min="0"
        :max="1"
        :step="0.05"
        dense
        hide-details
      />

      <div class="mt-2">
        <span class="text-caption d-block mb-1">Picking for</span>
        <v-btn-toggle
          :value="alignment.pickTarget"
          mandatory
          dense
          @change="setPickTarget"
        >
          <v-btn value="native" small>
            This camera
          </v-btn>
          <v-btn value="ghost" small>
            Ghost overlay
          </v-btn>
        </v-btn-toggle>
      </div>
    </div>
  </div>
</template>
