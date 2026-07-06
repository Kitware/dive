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
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

export default defineComponent({
  name: 'CameraCalibration',
  description: 'Camera Calibration',
  components: { TooltipBtn },
  setup() {
    const cameraStore = useCameraStore();
    const calibration = useCameraCalibration();
    const datasetId = useDatasetId();
    const { saveMetadata } = useApi();
    const { prompt } = usePrompt();

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
    const canClearLast = computed(
      () => calibration.pendingPoint.value !== null || correspondences.value.length > 0,
    );
    /** The active pair has a usable transform: enough points to fit one, or one loaded from a file. */
    const hasTransform = computed(() => canFit.value
      || Boolean(activeKey.value && calibration.homographies.value[activeKey.value]));
    /** The active pair's transform came from a calibration file (no in-app fit backing it). */
    const hasLoadedTransform = computed(() => {
      const key = activeKey.value;
      return Boolean(key && calibration.homographies.value[key] && calibration.isLoadedHomography(key));
    });
    /**
     * The active pair was refit in-app while a producer-stamped calibration is
     * loaded, so its transform has diverged from what the stamped source
     * shipped -- worth saving and sending back to the producer.
     */
    const refinedFromSource = computed(() => {
      const key = activeKey.value;
      // Touch homographies so provenance changes recompute this (see store docs).
      return Boolean(key && calibration.homographies.value[key]
        && calibration.isRefinedFromSource(key));
    });
    const canClearPair = computed(
      () => correspondences.value.length > 0 || hasLoadedTransform.value,
    );

    const alignmentModeItems = computed(() => [
      { text: 'Original (no alignment)', value: 'original' },
      { text: `Warp ${camLeft.value ?? 'A'} onto ${camRight.value ?? 'B'}`, value: 'AtoB', disabled: !hasTransform.value },
      { text: `Warp ${camRight.value ?? 'B'} onto ${camLeft.value ?? 'A'}`, value: 'BtoA', disabled: !hasTransform.value },
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

    /**
     * Human-readable summary of the loaded calibration's provenance stamp
     * (scalar entries only -- nested structures are preserved in the file but
     * not displayed).
     */
    const sourceReadout = computed(() => {
      const source = calibration.source.value;
      if (!source) {
        return null;
      }
      const entries = Object.entries(source)
        .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
        .map(([k, v]) => `${k}: ${v}`);
      return entries.length ? entries.join(' · ') : 'present (no displayable fields)';
    });

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

    /**
     * Persist the calibration (all pairs) with the dataset: it is written as
     * the project's calibration.json and restored on every dataset load (so
     * the Align button works across sessions). Deliberately not gated on the
     * active pair having correspondences: saving must also be able to persist
     * a cleared state (so stale saved calibration doesn't survive Clear All /
     * per-row deletes) and state belonging to non-active pairs. Use
     * {@link exportCalibration} to get a portable copy for sharing.
     */
    async function save() {
      saving.value = true;
      try {
        calibration.maybeFitActivePair();
        await saveMetadata(datasetId.value, {
          cameraHomographies: calibration.homographies.value,
          cameraCorrespondences: calibration.correspondences.value,
          cameraTransformTypes: calibration.transformTypes.value,
          cameraCalibrationSource: calibration.source.value,
        });
      } finally {
        saving.value = false;
      }
    }

    /**
     * Download the calibration as a portable .json -- for handing refinements
     * (points included) back to an external producer, or reusing on another
     * dataset. Saving is separate: see {@link save}.
     */
    function exportCalibration() {
      calibration.maybeFitActivePair();
      downloadText(calibration.toCalibrationJson(), 'camera-calibration.json');
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

    const calibrationFileInput = ref<HTMLInputElement | null>(null);
    const loadCalibrationError = ref<string | null>(null);
    const loadCalibrationWarning = ref<string | null>(null);

    const hasAnyCalibration = computed(
      () => Object.values(calibration.correspondences.value).some((list) => list.length > 0)
        || Object.keys(calibration.homographies.value).length > 0,
    );

    /** Load a calibration .json, replacing every pair's state. */
    async function loadJsonCalibration(file: File) {
      const text = await file.text();
      if (hasAnyCalibration.value) {
        const confirmed = await prompt({
          title: 'Load calibration',
          text: 'This will replace the current calibration for ALL camera pairs. Continue?',
          confirm: true,
        });
        if (!confirmed) {
          return;
        }
      }
      const { cameras: fileCameras } = calibration.loadCalibrationText(text);
      const known = new Set(cameras.value);
      const unknown = fileCameras.filter((name) => !known.has(name));
      if (unknown.length) {
        loadCalibrationWarning.value = `Loaded, but these cameras are not in this dataset: ${unknown.join(', ')}`;
      }
    }

    function onCalibrationFileSelected(event: Event) {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file) {
        return;
      }
      loadCalibrationError.value = null;
      loadCalibrationWarning.value = null;
      loadJsonCalibration(file).catch((err) => {
        loadCalibrationError.value = err instanceof Error ? err.message : String(err);
      });
    }

    return {
      cameras,
      camLeft,
      camRight,
      calibration,
      pickingEnabled: calibration.pickingEnabled,
      alignment: calibration.alignment,
      fitError: calibration.fitError,
      cursorReadout,
      correspondences,
      transformType,
      transformTypeItems: TRANSFORM_TYPES,
      minPoints,
      alignmentModeItems,
      hasTransform,
      hasLoadedTransform,
      refinedFromSource,
      canClearPair,
      canClearLast,
      saving,
      sourceReadout,
      calibrationFileInput,
      loadCalibrationError,
      loadCalibrationWarning,
      setTransformType,
      setAlignmentMode,
      setPickTarget,
      save,
      exportCalibration,
      onCalibrationFileSelected,
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

    <input
      ref="calibrationFileInput"
      type="file"
      accept=".json"
      style="display: none"
      @change="onCalibrationFileSelected"
    >
    <v-btn
      block
      outlined
      small
      class="mb-2"
      @click="calibrationFileInput.click()"
    >
      Load calibration
    </v-btn>
    <span
      v-if="loadCalibrationError"
      class="text-caption error--text d-block"
    >
      {{ loadCalibrationError }}
    </span>
    <span
      v-if="loadCalibrationWarning"
      class="text-caption warning--text d-block"
    >
      {{ loadCalibrationWarning }}
    </span>
    <span
      v-if="sourceReadout"
      class="text-caption grey--text d-block"
    >
      Source: {{ sourceReadout }}
    </span>
    <span
      v-if="refinedFromSource"
      class="text-caption warning--text d-block"
    >
      This pair has been refined in-app since the source calibration was
      produced. Export the calibration to hand the refinement (and its
      points) back to the producer.
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
      Once a transform is fitted, pan/zoom is linked between the pair and
      right-click recenters both cameras on the clicked point.
    </span>

    <div
      v-if="pickingEnabled"
      class="text-caption mt-2"
      style="font-family: monospace;"
    >
      {{ cursorReadout || 'Move the cursor over a camera to see its coordinates.' }}
    </div>

    <v-divider class="my-3" />

    <v-expansion-panels
      flat
      accordion
    >
      <v-expansion-panel>
        <v-expansion-panel-header class="px-1">
          Correspondences ({{ correspondences.length }})
        </v-expansion-panel-header>
        <v-expansion-panel-content class="px-0">
          <div class="d-flex justify-end mb-1">
            <tooltip-btn
              icon="mdi-undo"
              :disabled="!canClearLast"
              tooltip-text="Undo the pending point, or the last completed pair"
              @click="calibration.clearLast()"
            />
            <tooltip-btn
              color="error"
              icon="mdi-delete-sweep"
              :disabled="!canClearPair"
              tooltip-text="Clear all correspondences and any loaded transform for this pair"
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
            v-else-if="hasLoadedTransform"
            class="text-caption grey--text"
          >
            Transform loaded from a file (no picked points). Picking {{ minPoints }} or more
            points and fitting will replace it.
          </span>
          <span
            v-else
            class="text-caption grey--text"
          >
            No correspondences yet. At least {{ minPoints }} required for the selected transform.
          </span>
        </v-expansion-panel-content>
      </v-expansion-panel>
    </v-expansion-panels>
    <!-- Kept outside the collapsed panel so fit failures stay visible. -->
    <span
      v-if="fitError"
      class="text-caption error--text d-block"
    >
      Could not fit transform: {{ fitError }}
    </span>

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
      v-if="!hasTransform"
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

    <v-divider class="my-3" />

    <v-btn
      block
      color="success"
      small
      :loading="saving"
      class="mb-2"
      @click="save"
    >
      Save calibration
    </v-btn>
    <span class="text-caption grey--text d-block mb-2">
      Saves with the dataset; restored automatically when it is reopened.
    </span>
    <v-btn
      block
      outlined
      small
      class="mb-2"
      @click="exportCalibration"
    >
      Export calibration (.json)
    </v-btn>
  </div>
</template>
