<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, ref, watch,
} from 'vue';
import {
  useAlignedView,
  useCameraStore,
  useCameraRegistration,
  useDatasetId,
} from 'vue-media-annotator/provides';
import {
  TransformType, TRANSFORM_TYPES, DEFAULT_TRANSFORM_TYPE, minPointsForTransform,
} from 'vue-media-annotator/alignedView/transform';
import { unresolvedCameras } from 'vue-media-annotator/alignedView/alignedView';
import { buildPerCameraRegistrationFiles } from 'vue-media-annotator/alignedView/cameraRegistrationFiles';
import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';
import { useApi } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

export default defineComponent({
  name: 'CameraRegistration',
  description: 'Camera Registration',
  components: { TooltipBtn },
  setup() {
    const cameraStore = useCameraStore();
    const registration = useCameraRegistration();
    const datasetId = useDatasetId();
    const alignedView = useAlignedView();
    const { saveMetadata } = useApi();
    const { prompt } = usePrompt();

    const cameras = computed(() => [...cameraStore.camMap.value.keys()]);
    /**
     * Per-camera alignment status for the whole rig, driving the status block:
     * the first camera (display order) is the reference (identity); every other
     * camera is 'resolved' when it has a fitted path to the reference, else
     * 'unresolved' (still needs registration to satisfy the Align button).
     */
    const cameraAlignmentStatuses = computed(() => {
      const list = cameras.value;
      const reference = list[0];
      if (!reference) {
        return [] as { name: string; status: 'reference' | 'resolved' | 'unresolved' }[];
      }
      const unresolved = new Set(
        unresolvedCameras(list, reference, registration.homographies.value),
      );
      return list.map((name) => {
        let status: 'reference' | 'resolved' | 'unresolved' = 'resolved';
        if (name === reference) {
          status = 'reference';
        } else if (unresolved.has(name)) {
          status = 'unresolved';
        }
        return { name, status };
      });
    });
    /** One-line rig-alignment summary (icon + color + text) for the status header. */
    const alignmentSummary = computed(() => {
      const total = cameras.value.length;
      const unresolvedCount = cameraAlignmentStatuses.value
        .filter((c) => c.status === 'unresolved').length;
      const complete = unresolvedCount === 0;
      return {
        icon: complete ? 'mdi-check-circle' : 'mdi-alert',
        color: complete ? 'success' : 'warning',
        text: `${total - unresolvedCount}/${total} cameras registered`,
      };
    });
    const camLeft = ref<string | null>(null);
    const camRight = ref<string | null>(null);
    const saving = ref(false);

    // Default the selectors to the first two cameras.
    if (cameras.value.length >= 2) {
      [camLeft.value, camRight.value] = cameras.value;
    }

    /**
     * Author-vs-review posture: picking defaults on for a pair that still
     * needs points, and off for one whose transform came from a registration
     * file (review it; the "Pick points" toggle opts back in to refine).
     * Re-applied whenever the active pair changes identity, so it overrides a
     * manual toggle on pair switch -- each pair opens in its own posture.
     */
    function applyPickingDefault() {
      registration.pickingEnabled.value = registration.pickingDefaultFor(
        registration.activePairKey(),
      );
    }

    watch([camLeft, camRight], () => {
      registration.setActivePair(camLeft.value, camRight.value);
      applyPickingDefault();
    }, { immediate: true });

    // The pair can also be set from outside the panel (the Import menu
    // re-selects a freshly imported pair); mirror such changes into the
    // selectors so the panel doesn't keep showing a stale pair.
    watch(registration.activePair, (pair) => {
      if (pair && (pair.camA !== camLeft.value || pair.camB !== camRight.value)) {
        camLeft.value = pair.camA;
        camRight.value = pair.camB;
      }
    });

    // Picking and the active pair are scoped to this panel: established while
    // it is open, cleared when it closes (unmounts), so the viewer can't be
    // left in picking mode -- or with linked pan/zoom, a warp ghost, or
    // pair-only panes -- with no visible control to get back out.
    onBeforeUnmount(() => {
      registration.pickingEnabled.value = false;
      registration.setActivePair(null, null);
    });

    // Switching datasets while this panel stays mounted re-runs the viewer's
    // loadDataset -> registration.hydrate(), which clears picking and the active
    // pair. This panel establishes those only at mount, so without this it
    // would be left visibly open but inert (dead markers, stale selectors).
    // Re-establish them whenever the camera set changes.
    watch(cameras, (list) => {
      const valid = !!camLeft.value && list.includes(camLeft.value)
        && !!camRight.value && list.includes(camRight.value);
      if (!valid) {
        // New dataset (or camera set): default the selectors to its first two
        // cameras; the [camLeft, camRight] watch re-runs setActivePair.
        camLeft.value = list.length >= 2 ? list[0] : null;
        camRight.value = list.length >= 2 ? list[1] : null;
      } else {
        // Same camera names as before: the selectors don't change, so
        // re-establish the pair that hydrate() nulled.
        registration.setActivePair(camLeft.value, camRight.value);
      }
      applyPickingDefault();
    });

    const activeKey = computed(() => registration.activePairKey());
    const correspondences = computed(() => {
      const key = activeKey.value;
      return key ? (registration.correspondences.value[key] || []) : [];
    });
    const transformType = computed<TransformType>(
      () => (activeKey.value
        ? registration.transformTypeForPair(activeKey.value)
        : DEFAULT_TRANSFORM_TYPE),
    );
    const minPoints = computed(() => minPointsForTransform(transformType.value));
    const canFit = computed(() => correspondences.value.length >= minPoints.value);
    const selectedCorrespondenceId = computed(() => registration.selectedCorrespondenceId.value);
    /**
     * Delete the unlocked point on Del/Backspace: the selected correspondence
     * (both cameras' points) if one is selected, otherwise the pending point
     * that is mid-placement.
     */
    function deleteSelectedCorrespondence() {
      if (registration.selectedCorrespondenceId.value !== null) {
        registration.removeSelectedCorrespondence();
      } else if (registration.pendingPoint.value !== null) {
        registration.clearLast();
      }
    }
    const canClearLast = computed(
      () => registration.pendingPoint.value !== null || correspondences.value.length > 0,
    );
    /** How many more correspondence pairs are needed before the transform can be fit. */
    const remainingPoints = computed(() => Math.max(0, minPoints.value - correspondences.value.length));
    /** The active pair has a usable transform: enough points to fit one, or one loaded from a file. */
    const hasTransform = computed(() => canFit.value
      || Boolean(activeKey.value && registration.homographies.value[activeKey.value]));
    /** The active pair's transform came from a registration file (no in-app fit backing it). */
    const hasLoadedTransform = computed(() => {
      const key = activeKey.value;
      return Boolean(key && registration.homographies.value[key] && registration.isLoadedHomography(key));
    });
    /**
     * Fit-robustness color: green with 12+ point pairs, yellow once the active
     * transform can be fit (its own minimum, e.g. 2 for Similarity), grey
     * below -- except that a file-loaded transform with no picked points is
     * trusted as shipped (green).
     */
    const fitQualityColor = computed(() => {
      if (correspondences.value.length >= 12) {
        return 'success';
      }
      if (canFit.value) {
        return 'warning';
      }
      return hasLoadedTransform.value ? 'success' : 'grey';
    });
    /**
     * Three-state transform status for the active pair -- loaded from a file,
     * fitted from picked points, or absent -- so a matrix-only registration
     * loaded from a producer (e.g. KAMERA) reads as complete rather than
     * "points still needed".
     */
    const transformStatus = computed(() => {
      if (hasLoadedTransform.value) {
        return {
          icon: 'mdi-file-check',
          color: 'success',
          text: 'Transform loaded from a registration file',
        };
      }
      if (canFit.value) {
        return {
          icon: 'mdi-check-circle',
          color: fitQualityColor.value,
          text: `Transform fit from ${correspondences.value.length} point pairs`,
        };
      }
      return {
        icon: 'mdi-progress-clock',
        color: 'grey',
        text: 'No transform yet: pick points below, or import a registration (Import menu)',
      };
    });
    /**
     * Toggle linked pan/zoom. Points are fit lazily, so enabling first fits
     * the active pair when it has enough points but no transform yet
     * (mirroring setAlignmentMode) -- the link engages immediately instead of
     * waiting for the next fit-triggering action.
     */
    function setLinkedNav(enabled: unknown) {
      const on = Boolean(enabled);
      if (on) {
        registration.maybeFitActivePair();
      }
      registration.linkedNav.value = on;
    }
    /**
     * The active pair was refit in-app while a producer-stamped registration is
     * loaded, so its transform has diverged from what the stamped source
     * shipped -- worth saving and sending back to the producer.
     */
    const refinedFromSource = computed(() => {
      const key = activeKey.value;
      // Touch homographies so provenance changes recompute this (see store docs).
      return Boolean(key && registration.homographies.value[key]
        && registration.isRefinedFromSource(key));
    });
    const canClearPair = computed(
      () => correspondences.value.length > 0 || hasLoadedTransform.value,
    );

    const alignmentModeItems = computed(() => [
      { text: 'Picking', value: 'original', disabled: false },
      { text: `${camLeft.value ?? 'A'} → ${camRight.value ?? 'B'}`, value: 'AtoB', disabled: !hasTransform.value },
      { text: `${camRight.value ?? 'B'} → ${camLeft.value ?? 'A'}`, value: 'BtoA', disabled: !hasTransform.value },
    ]);

    function setTransformType(type: TransformType) {
      const key = activeKey.value;
      if (key) {
        registration.setTransformType(key, type);
      }
    }

    function setAlignmentMode(mode: 'original' | 'AtoB' | 'BtoA') {
      registration.setAlignmentMode(mode);
    }

    /**
     * Human-readable summary of the loaded registration's provenance stamp
     * (scalar entries only -- nested structures are preserved in the file but
     * not displayed).
     */
    const sourceReadout = computed(() => {
      const source = registration.source.value;
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
      const cursor = registration.cursorCoord.value;
      if (!cursor) {
        return null;
      }
      const [x, y] = cursor.coord;
      const other = registration.linkedPoint(cursor.camera, cursor.coord);
      const here = `${cursor.camera}: (${x.toFixed(1)}, ${y.toFixed(1)})`;
      if (!other) {
        return here;
      }
      const [ox, oy] = other.coord;
      return `${here} -> ${other.camera}: (${ox.toFixed(1)}, ${oy.toFixed(1)})`;
    });

    /**
     * Persist the registration (all pairs) with the dataset: it is written as
     * the project's per-camera <camera>_to_<reference>_registration.json files and restored
     * on every dataset load (so the Align button works across sessions).
     * Deliberately not gated on the
     * active pair having correspondences: saving must also be able to persist
     * a cleared state (so stale saved registration doesn't survive Clear All /
     * per-row deletes) and state belonging to non-active pairs. Portable
     * copies for sharing come from the Export menu's per-camera registration
     * downloads, which read this saved state.
     *
     * Overwriting an existing saved registration (e.g. one imported from a
     * producer like KAMERA) is confirmed first, naming only the per-camera
     * file(s) whose content this save actually changes -- pairs the user
     * didn't touch are rewritten byte-identical, which isn't an overwrite
     * worth warning about.
     */
    async function save() {
      // Fit before diffing so the comparison reflects what will be written.
      registration.maybeFitActivePair();
      // Group the saved baseline and the current state into per-camera files
      // exactly the way the persistence layer writes them, against the same
      // reference camera the backend uses (the dataset's Reference Camera
      // choice, published by the viewer).
      const reference = alignedView.reference.value ?? cameras.value[0] ?? null;
      const savedFiles = buildPerCameraRegistrationFiles(
        registration.savedRegistrationValues(),
        reference,
      );
      const nextFiles = new Map(buildPerCameraRegistrationFiles(
        {
          homographies: registration.homographies.value,
          correspondences: registration.correspondences.value,
          transformTypes: registration.transformTypes.value,
          source: registration.source.value,
        },
        reference,
      ).map((file) => [file.name, file]));
      // Existing files this save replaces with different content (or removes,
      // for a cleared pair) -- the actual overwrites.
      const overwritten = savedFiles
        .filter((file) => {
          const next = nextFiles.get(file.name);
          return !next || JSON.stringify(next.body) !== JSON.stringify(file.body);
        })
        .map((file) => file.name);
      if (overwritten.length) {
        const text = [
          `Saving will overwrite ${overwritten.join(', ')}.`,
        ];
        if (sourceReadout.value) {
          text.push(`Existing registration source: ${sourceReadout.value}`);
        }
        const confirmed = await prompt({
          title: 'Overwrite Saved Registration?',
          text,
          positiveButton: 'Overwrite',
          negativeButton: 'Cancel',
          confirm: true,
        });
        if (!confirmed) {
          return;
        }
      }
      saving.value = true;
      try {
        await saveMetadata(datasetId.value, {
          cameraHomographies: registration.homographies.value,
          cameraCorrespondences: registration.correspondences.value,
          cameraTransformTypes: registration.transformTypes.value,
          cameraRegistrationSource: registration.source.value,
        });
        registration.markSaved();
      } finally {
        saving.value = false;
      }
    }

    return {
      cameras,
      cameraAlignmentStatuses,
      alignmentSummary,
      camLeft,
      camRight,
      registration,
      pickingEnabled: registration.pickingEnabled,
      alignment: registration.alignment,
      fitError: registration.fitError,
      selectedCorrespondenceId,
      deleteSelectedCorrespondence,
      cursorReadout,
      correspondences,
      transformType,
      transformTypeItems: TRANSFORM_TYPES,
      minPoints,
      remainingPoints,
      alignmentModeItems,
      hasTransform,
      hasLoadedTransform,
      refinedFromSource,
      canClearPair,
      canClearLast,
      canFit,
      fitQualityColor,
      transformStatus,
      setLinkedNav,
      linkedNav: registration.linkedNav,
      dirty: registration.dirty,
      saving,
      sourceReadout,
      setTransformType,
      setAlignmentMode,
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
      Register cameras by importing a registration file (Import menu) or by
      picking corresponding points between two cameras.
    </span>
    <v-divider class="my-3" />

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
      This pair has been refined in-app since the source registration was
      produced. Save, then download the camera's registration from the
      Export menu to hand the refinement (and its points) back to the
      producer.
    </span>

    <div
      v-if="cameras.length >= 2"
      class="mt-2"
    >
      <div
        class="d-flex align-center text-caption mb-1"
        :class="`${alignmentSummary.color}--text`"
      >
        <v-icon
          small
          :color="alignmentSummary.color"
          class="mr-1"
        >
          {{ alignmentSummary.icon }}
        </v-icon>
        {{ alignmentSummary.text }}
      </div>
      <div class="d-flex flex-wrap">
        <v-chip
          v-for="cam in cameraAlignmentStatuses"
          :key="cam.name"
          small
          label
          :ripple="false"
          :color="cam.status === 'resolved'
            ? 'success'
            : (cam.status === 'unresolved' ? 'warning' : undefined)"
          :outlined="cam.status !== 'resolved'"
          class="mr-1 mb-1"
          style="pointer-events: none;"
        >
          <v-icon
            x-small
            left
          >
            {{ cam.status === 'reference' ? 'mdi-star'
              : (cam.status === 'resolved' ? 'mdi-check' : 'mdi-alert-outline') }}
          </v-icon>
          {{ cam.name }}{{ cam.status === 'reference' ? ' · reference' : '' }}
        </v-chip>
      </div>
    </div>
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

    <div class="d-flex align-center text-caption">
      <v-icon
        small
        :color="transformStatus.color"
        class="mr-1"
      >
        {{ transformStatus.icon }}
      </v-icon>
      <span :class="`${transformStatus.color}--text`">
        {{ transformStatus.text }}
      </span>
    </div>
    <span
      v-if="hasLoadedTransform"
      class="text-caption grey--text d-block mt-1"
    >
      Linked pan/zoom and the overlay warp use the loaded transform. Picking
      points is optional: fitting {{ minPoints }} or more pairs replaces it.
    </span>

    <v-checkbox
      :input-value="linkedNav"
      :disabled="!hasTransform"
      :color="fitQualityColor"
      label="Link pan/zoom"
      dense
      hide-details
      class="mt-1"
      @change="setLinkedNav"
    />

    <v-divider class="my-3" />

    <v-switch
      v-model="pickingEnabled"
      label="Pick points"
      dense
      hide-details
      class="mt-0"
    />
    <span class="text-caption grey--text d-block">
      Click matching features in each camera to add correspondence pairs.
    </span>

    <template v-if="pickingEnabled">
      <div
        class="text-caption mt-2"
        style="font-family: monospace;"
      >
        {{ cursorReadout || 'Move the cursor over a camera to see its coordinates.' }}
      </div>

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
                @click="registration.clearLast()"
              />
              <tooltip-btn
                color="error"
                icon="mdi-delete-sweep"
                :disabled="!canClearPair"
                tooltip-text="Clear all correspondences and any loaded transform for this pair"
                @click="registration.clearPair()"
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
                    :style="c.id === selectedCorrespondenceId
                      ? { backgroundColor: 'rgba(255, 152, 0, 0.25)' }
                      : undefined"
                    @click="registration.selectCorrespondence(c.id)"
                  >
                    <td>{{ i + 1 }}</td>
                    <td>{{ c.a[0].toFixed(1) }}, {{ c.a[1].toFixed(1) }}</td>
                    <td>{{ c.b[0].toFixed(1) }}, {{ c.b[1].toFixed(1) }}</td>
                    <td>
                      <tooltip-btn
                        color="error"
                        icon="mdi-delete"
                        tooltip-text="Remove this pair"
                        @click="registration.removeCorrespondence(c.id)"
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

      <h4 class="mt-3">
        Transform Type
      </h4>
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
      <div class="d-flex align-center text-caption mt-1">
        <v-icon
          small
          :color="canFit ? 'success' : 'grey'"
          class="mr-1"
        >
          {{ canFit ? 'mdi-check-circle' : 'mdi-progress-clock' }}
        </v-icon>
        <span :class="canFit ? 'success--text' : 'grey--text'">
          <template v-if="canFit">
            Ready to fit ({{ correspondences.length }} / {{ minPoints }} point pairs)
          </template>
          <template v-else>
            {{ remainingPoints }} more point pair{{ remainingPoints === 1 ? '' : 's' }} needed
            ({{ correspondences.length }} / {{ minPoints }})
          </template>
        </span>
      </div>
    </template>
    <!-- Kept outside the picking section so fit failures stay visible. -->
    <span
      v-if="fitError"
      class="text-caption error--text d-block"
    >
      Could not fit transform: {{ fitError }}
    </span>

    <v-divider class="my-3" />

    <h4>Overlay Warp</h4>

    <v-btn-toggle
      :value="alignment.mode"
      mandatory
      dense
      class="d-flex my-2"
      @change="setAlignmentMode"
    >
      <v-btn
        v-for="item in alignmentModeItems"
        :key="item.value"
        :value="item.value"
        :disabled="item.disabled"
        small
        class="flex-grow-1"
        style="text-transform: none;"
      >
        {{ item.text }}
      </v-btn>
    </v-btn-toggle>

    <span
      class="text-caption"
      :class="{ 'grey--text': alignment.mode === 'original' }"
    >Warp Opacity</span>
    <v-slider
      v-model="alignment.opacity"
      :min="0"
      :max="1"
      :step="0.05"
      :disabled="alignment.mode === 'original'"
      dense
      hide-details
    />

    <v-divider class="my-3" />

    <v-btn
      block
      :color="dirty ? 'success' : undefined"
      :disabled="!dirty || saving"
      small
      :loading="saving"
      class="mb-2"
      @click="save"
    >
      {{ dirty ? 'Save registration' : 'Registration saved' }}
    </v-btn>
  </div>
</template>
