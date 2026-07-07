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
    const selectedCorrespondenceId = computed(() => calibration.selectedCorrespondenceId.value);
    /** Delete the selected correspondence (both cameras' points). Bound to Del/Backspace. */
    function deleteSelectedCorrespondence() {
      calibration.removeSelectedCorrespondence();
    }
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

    return {
      cameras,
      camLeft,
      camRight,
      calibration,
      pickingEnabled: calibration.pickingEnabled,
      alignment: calibration.alignment,
      fitError: calibration.fitError,
      linkedNav: calibration.linkedNav,
      selectedCorrespondenceId,
      deleteSelectedCorrespondence,
      cursorReadout,
      correspondences,
      transformType,
      transformTypeItems: TRANSFORM_TYPES,
      minPoints,
      alignmentModeItems,
      canFit,
      canClearLast,
      saving,
      setTransformType,
      setAlignmentMode,
      setPickTarget,
      save,
    };
  },
});
</script>

<template>
  <div
    v-mousetrap="[
      { bind: 'del', handler: deleteSelectedCorrespondence },
      { bind: 'backspace', handler: deleteSelectedCorrespondence },
    ]"
    class="mx-4"
  >
    <span class="text-body-2">
      Pick corresponding points between two cameras to fit an alignment transform.
    </span>
    <v-divider class="my-3" />

    <v-switch
      v-model="pickingEnabled"
      label="Pick points"
      dense
      hide-details
      class="mt-0 mb-2"
    />
    <span class="text-caption grey--text">
      Click a point in one camera, then the matching point in the other.
      Click a placed marker to select it (Delete removes its point in both
      cameras); drag a marker to refine it. Right-click to recenter both
      cameras on that point (requires a fitted transform).
    </span>

    <v-select
      v-model="camLeft"
      :items="cameras"
      label="Camera A (left)"
      dense
      outlined
      hide-details
      class="mt-3 mb-3"
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
            :style="c.id === selectedCorrespondenceId
              ? { backgroundColor: 'rgba(255, 152, 0, 0.25)' }
              : undefined"
            @click="calibration.selectCorrespondence(c.id)"
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

    <v-divider class="my-3" />

    <!--
      Deliberately not gated on the active pair having correspondences
      (unlike the export buttons above): saving must also be able to persist
      a cleared state (so stale saved calibration doesn't survive Clear All /
      per-row deletes) and state belonging to non-active pairs.
    -->
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
  </div>
</template>
