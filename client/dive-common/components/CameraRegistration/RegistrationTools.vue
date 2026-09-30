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
import { MANUAL_SOURCE } from 'vue-media-annotator/alignedView/CameraRegistrationStore';
import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';
import { injectAggregateController } from 'vue-media-annotator/components/annotators/useMediaController';
import { useApi } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { AutoRegisterRunOptions, useAutoRegisterJob } from 'dive-common/use/useAutoRegisterJob';
import { loopClosureResidual, Matrix3 } from 'vue-media-annotator/alignedView/homography';

import RegistrationFrameList, { FrameRow } from './RegistrationFrameList.vue';
import AutoRegisterDialog from './AutoRegisterDialog.vue';
/**
 * A solved triplet is "consistent" when the direct and routed transforms
 * agree to within this fraction of the last camera's width. 0.001 keeps the
 * behaviour the old fixed 5px threshold happened to have on a ~5000px-wide
 * camera, while meaning the same thing on rigs whose cameras are far larger
 * or smaller. Measured on a KAMERA calibration flight: a converged 10-100
 * frame fit sits near 0.05%, a single-frame (overfit) rig at 0.15%.
 */
const LOOP_CLOSURE_MAX_FRACTION = 0.001;

export default defineComponent({
  name: 'CameraRegistration',
  description: 'Camera Registration',
  components: { AutoRegisterDialog, TooltipBtn, RegistrationFrameList },
  setup() {
    const cameraStore = useCameraStore();
    const registration = useCameraRegistration();
    const datasetId = useDatasetId();
    const alignedView = useAlignedView();
    const { saveConfig } = useApi();
    const { prompt } = usePrompt();
    const aggregateController = injectAggregateController();

    /**
     * The rig in persisted display order. Not camMap's key order: that is
     * insertion order from an awaited per-camera load loop and can carry
     * entries across a dataset switch, and both the reference camera below
     * and the direction of the loop-closure residual depend on which camera
     * is first and last.
     */
    // orderedCameraNames reads camMap and displayOrder, so the computed picks
    // up both as dependencies without touching them explicitly.
    const cameras = computed(() => cameraStore.orderedCameraNames());
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
        text: `${total - unresolvedCount}/${total} cameras ready`,
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
     * file (review it; the "Edit points" toggle opts back in to refine).
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
      // Pooled across every enabled observation -- the fit input.
      return key ? registration.enabledPoints(key) : [];
    });
    /** Pooled fit quality: per-frame agreement with the pair's consensus. */
    const pairStats = computed(() => (
      activeKey.value ? registration.pairFitStats(activeKey.value) : null));
    /** The camA-space frame the viewer currently displays for this pair. */
    const currentPairFrame = computed(() => {
      // Touch currentFrame so scrubbing recomputes the readouts.
      // eslint-disable-next-line no-void
      void registration.currentFrame.value;
      const key = activeKey.value;
      return key !== null ? registration.currentFrameForPair(key) : null;
    });
    /**
     * The registration-frames list: the multi-image-pair selector AND the
     * quality readout, one row per observation with its agreement dot.
     */
    const frameRows = computed<FrameRow[]>(() => {
      const key = activeKey.value;
      if (!key) {
        return [];
      }
      const stats = registration.pairFitStats(key);
      const rmsByIdentity = new Map(stats.perObservation.map((obs) => [
        `${obs.imageA}::${obs.imageB}`, obs.rmsPx,
      ]));
      // camA-local drives every action in this panel, but the number shown must
      // match the frame readout / scrubber, which count global slots.
      const [camA] = key.split('::');
      const toSlot = (frame: number | null) => (
        frame === null ? null : aggregateController.value.cameraFrameToSlot(camA, frame) ?? frame
      );
      return registration.framesForPair(key).map((row) => ({
        frame: row.frame,
        displayFrame: toSlot(row.frame),
        imageA: row.imageA,
        imageB: row.imageB,
        enabled: row.enabled,
        source: row.source,
        count: row.count,
        rmsPx: rmsByIdentity.get(`${row.imageA}::${row.imageB}`) ?? null,
        skipped: (row.stats && typeof row.stats.skipped === 'string')
          ? row.stats.skipped as string : null,
        current: row.frame !== null && row.frame === currentPairFrame.value,
      }));
    });
    /**
     * Skipped rows are frames a producer rejected (e.g. the matcher found too
     * few matches). They carry no points and support no action, so they are
     * counted, not listed.
     */
    const skippedCount = computed(() => frameRows.value.filter((row) => row.skipped).length);
    const listedRows = computed(() => frameRows.value.filter((row) => !row.skipped));
    const autoRows = computed(() => listedRows.value.filter((row) => row.source !== MANUAL_SOURCE));
    const manualRows = computed(
      () => listedRows.value.filter((row) => row.source === MANUAL_SOURCE),
    );
    /** Enabled count + mean agreement with the pooled fit, for a section header. */
    function sectionSummary(rows: FrameRow[]) {
      const enabled = rows.filter((row) => row.enabled);
      const measured = enabled
        .map((row) => row.rmsPx)
        .filter((rms): rms is number => rms !== null);
      return {
        total: rows.length,
        enabled: enabled.length,
        rmsPx: measured.length
          ? measured.reduce((sum, rms) => sum + rms, 0) / measured.length
          : null,
      };
    }
    const autoSummary = computed(() => sectionSummary(autoRows.value));
    const manualSummary = computed(() => sectionSummary(manualRows.value));

    /**
     * Captures queued for the next matcher run, as global aligned-timeline
     * slots (what the frame readout shows). The user picks the captures, so
     * the run matches exactly these rather than proposing a spread.
     */
    const queuedSlots = ref<number[]>([]);
    const currentSlot = computed(() => {
      const pair = registration.activePair.value;
      const frame = currentPairFrame.value;
      if (!pair || frame === null) {
        return null;
      }
      return aggregateController.value.cameraFrameToSlot(pair.camA, frame) ?? frame;
    });
    const currentQueued = computed(() => (
      currentSlot.value !== null && queuedSlots.value.includes(currentSlot.value)
    ));
    function queueCurrentFrame() {
      const slot = currentSlot.value;
      if (slot !== null && !queuedSlots.value.includes(slot)) {
        queuedSlots.value = [...queuedSlots.value, slot].sort((a, b) => a - b);
      }
    }
    function unqueueSlot(slot: number) {
      queuedSlots.value = queuedSlots.value.filter((queued) => queued !== slot);
    }
    /**
     * Every observation of a section, INCLUDING the skipped ones the list
     * hides: they are still stored and still travel into the saved
     * registration file, so a "clear all" that left them behind would leave
     * invisible cruft the user has no way to see or remove.
     */
    const autoAll = computed(
      () => frameRows.value.filter((row) => row.source !== MANUAL_SOURCE),
    );
    const manualAll = computed(
      () => frameRows.value.filter((row) => row.source === MANUAL_SOURCE),
    );
    async function clearRows(rows: FrameRow[], label: string) {
      const key = activeKey.value;
      if (!key || !rows.length) {
        return;
      }
      const doomed = [...rows];
      const points = doomed.reduce((sum, row) => sum + row.count, 0);
      const hidden = doomed.filter((row) => row.skipped).length;
      const confirmed = await prompt({
        title: `Clear ${label} Frames`,
        text: `Remove all ${doomed.length} ${label.toLowerCase()} frame(s)`
          + `${hidden ? ` (${hidden} hidden as rejected candidates)` : ''}`
          + ` and their ${points} point pair(s) from this pair's registration?`,
        positiveButton: 'Remove all',
        negativeButton: 'Cancel',
        confirm: true,
      });
      if (!confirmed) {
        return;
      }
      doomed.forEach(
        (row) => registration.removeObservation(key, row.imageA, row.imageB, row.source),
      );
    }
    const clearAuto = () => clearRows(autoAll.value, 'Auto');
    const clearManual = () => clearRows(manualAll.value, 'Manual');
    function clearQueue() {
      queuedSlots.value = [];
    }
    function runQueuedFrames() {
      autoRegisterJob?.run({
        frames: queuedSlots.value.length,
        slots: [...queuedSlots.value],
      });
      queuedSlots.value = [];
    }

    /** Point pairs picked/matched on the frame currently being viewed. */
    const frameCorrespondences = computed(() => {
      const key = activeKey.value;
      if (!key) {
        return [];
      }
      return registration.correspondencesForFrame(key, currentPairFrame.value);
    });
    function toggleFrameRow(row: FrameRow, enabled: boolean) {
      const key = activeKey.value;
      if (key) {
        registration.setObservationEnabled(key, row.imageA, row.imageB, enabled);
      }
    }
    /**
     * Seek a camA-local frame. markerFrames / currentPairFrame are all in the
     * active pair's camA space (see CameraRegistrationStore.currentPairFrame),
     * so every seek out of this panel goes through camA rather than whichever
     * camera happens to be selected.
     */
    function seekPairFrame(frame: number) {
      const pair = registration.activePair.value;
      if (!pair) {
        return;
      }
      aggregateController.value.seekCameraFrame(pair.camA, frame);
    }
    function jumpToFrame(frame: number) {
      // Observation frames are camA-local, but handler.seekFrame() interprets
      // its argument in the SELECTED camera's local space -- wrong whenever
      // the rig's cameras drop frames independently. Seek camA's own frame
      // instead; seekCameraFrame translates through the aligned timeline so
      // every camera lands on the same capture.
      seekPairFrame(frame);
    }
    async function removeFrameRow(row: FrameRow) {
      const key = activeKey.value;
      if (!key) {
        return;
      }
      if (row.count > 0) {
        const confirmed = await prompt({
          title: 'Remove Registration Frame',
          text: `Remove the ${row.count} point pair(s) from `
            + `${row.displayFrame !== null ? `frame ${row.displayFrame}` : 'this frame'}? `
            + 'To exclude the frame from the fit without deleting its points, '
            + 'uncheck it instead.',
          positiveButton: 'Remove',
          negativeButton: 'Cancel',
          confirm: true,
        });
        if (!confirmed) {
          return;
        }
      }
      registration.removeObservation(key, row.imageA, row.imageB, row.source);
    }
    /** Frames carrying registration points, for prev/next navigation. */
    const markerFrames = computed(() => frameRows.value
      .map((row) => row.frame)
      .filter((frameNum): frameNum is number => frameNum !== null)
      .sort((a, b) => a - b));
    function seekPrevMarker() {
      const current = currentPairFrame.value ?? 0;
      const prev = [...markerFrames.value].reverse().find((frameNum) => frameNum < current);
      if (prev !== undefined) {
        seekPairFrame(prev);
      }
    }
    function seekNextMarker() {
      const current = currentPairFrame.value ?? 0;
      const next = markerFrames.value.find((frameNum) => frameNum > current);
      if (next !== undefined) {
        seekPairFrame(next);
      }
    }
    /** One-click way to start contributing the current frame: enable picking. */
    function addCurrentFrame() {
      registration.pickingEnabled.value = true;
    }
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
          text: 'Transform loaded from file',
          hint: 'Linked pan/zoom and the overlay warp use the loaded transform. Fitting '
            + `${minPoints.value} or more picked point pairs replaces it.`,
        };
      }
      if (canFit.value) {
        const stats = pairStats.value;
        const frames = stats ? stats.frameCount : 0;
        const rms = stats && stats.rmsPx !== null ? ` · rms ${stats.rmsPx.toFixed(1)} px` : '';
        return {
          icon: 'mdi-check-circle',
          color: fitQualityColor.value,
          text: `Fit: ${frames} frame${frames === 1 ? '' : 's'} · `
            + `${correspondences.value.length} pairs${rms}`,
          hint: 'Green with 12 or more point pairs; yellow when the transform can be fit '
            + 'but has few points to support it.',
        };
      }
      return {
        icon: 'mdi-progress-clock',
        color: 'grey',
        text: 'No transform yet',
        hint: 'Auto Register, pick points with Edit points, or import a registration '
          + '(Import menu).',
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

    // Short L/R labels keep the toggle from overflowing on long camera
    // names; the full names stay available as the button tooltip.
    const alignmentModeItems = computed(() => [
      {
        text: 'Picking', title: undefined, value: 'original', disabled: false,
      },
      {
        text: 'L → R',
        title: `${camLeft.value ?? 'A'} → ${camRight.value ?? 'B'}`,
        value: 'AtoB',
        disabled: !hasTransform.value,
      },
      {
        text: 'R → L',
        title: `${camRight.value ?? 'B'} → ${camLeft.value ?? 'A'}`,
        value: 'BtoA',
        disabled: !hasTransform.value,
      },
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

    /**
     * Short L/R label for a camera in the active pair (falls back to the full
     * name for anything else, though the readout only ever sees pair
     * cameras) -- keeps the monospace cursor readout from overflowing on
     * long camera names, matching the Overlay Warp toggle's labels.
     */
    function shortCameraLabel(cam: string): string {
      if (cam === camLeft.value) return 'L';
      if (cam === camRight.value) return 'R';
      return cam;
    }

    /** Live cursor readout text: this camera's coord, and its linked point in the other camera. */
    const cursorReadout = computed(() => {
      const cursor = registration.cursorCoord.value;
      if (!cursor) {
        return null;
      }
      const [x, y] = cursor.coord;
      const other = registration.linkedPoint(cursor.camera, cursor.coord);
      const here = `${shortCameraLabel(cursor.camera)}: (${x.toFixed(1)}, ${y.toFixed(1)})`;
      if (!other) {
        return here;
      }
      const [ox, oy] = other.coord;
      return `${here} -> ${shortCameraLabel(other.camera)}: (${ox.toFixed(1)}, ${oy.toFixed(1)})`;
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
    /** The rig reference the persistence layer groups per-camera files against. */
    const fileReference = computed(
      () => alignedView.reference.value ?? cameras.value[0] ?? null,
    );
    /** "rgb ↔ ir": the pair Save and Delete act on. */
    const pairLabel = computed(() => `${camLeft.value ?? 'A'} ↔ ${camRight.value ?? 'B'}`);
    /** The active pair differs from what is saved (other pairs don't count). */
    const pairDirty = computed(
      () => (activeKey.value ? registration.pairDirty(activeKey.value) : false),
    );
    /** Some other pair (or a frame offset) has unsaved changes Save won't write. */
    const otherPairsDirty = computed(
      () => (activeKey.value ? registration.dirtyOutsidePair(activeKey.value) : false),
    );
    /**
     * The per-camera registration file that holds the active pair -- what
     * Save rewrites and Delete removes it from. Looked up in the state a save
     * would write, then in the saved baseline (a deleted pair is only there).
     */
    const pairFileName = computed(() => {
      const key = activeKey.value;
      if (!key) {
        return null;
      }
      const [left, right] = key.split('::');
      const holdsPair = (file: ReturnType<typeof buildPerCameraRegistrationFiles>[number]) => (
        file.body.pairs.some((pair) => pair.left === left && pair.right === right));
      const reference = fileReference.value;
      const next = buildPerCameraRegistrationFiles(registration.valuesSavingPair(key), reference);
      const saved = buildPerCameraRegistrationFiles(registration.savedRegistrationValues(), reference);
      return (next.find(holdsPair) ?? saved.find(holdsPair))?.name ?? null;
    });

    async function save() {
      const key = activeKey.value;
      if (!key) {
        return;
      }
      // Fit before diffing so the comparison reflects what will be written.
      registration.maybeFitActivePair();
      // Group the saved baseline and the state this save writes into
      // per-camera files exactly the way the persistence layer does. Only
      // the active pair changes, so only its file can differ.
      const savedFiles = buildPerCameraRegistrationFiles(
        registration.savedRegistrationValues(),
        fileReference.value,
      );
      const nextFiles = new Map(buildPerCameraRegistrationFiles(
        registration.valuesSavingPair(key),
        fileReference.value,
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
      await persistPair(key);
    }

    /**
     * Write the saved registration with only this pair changed. The backend
     * rewrites the per-camera files from what it is sent, so sending the
     * saved baseline for every other pair leaves their files as they were
     * and keeps their unsaved edits pending in the store.
     */
    async function persistPair(key: string) {
      const values = registration.valuesSavingPair(key);
      saving.value = true;
      try {
        await saveConfig(datasetId.value, {
          cameraHomographies: values.homographies,
          cameraCorrespondences: values.observations,
          cameraTransformTypes: values.transformTypes,
          cameraRegistrationSource: values.source,
          cameraFrameOffsets: values.frameOffsets,
          cameraFrameOffsetsApplied: values.appliedFrameOffsets,
        });
        registration.markPairSaved(key);
      } finally {
        saving.value = false;
      }
    }

    /** The active pair has something to delete, saved or not. */
    const canDeletePair = computed(() => {
      const key = activeKey.value;
      if (!key) {
        return false;
      }
      const saved = registration.savedRegistrationValues();
      return [
        registration.homographies.value, registration.observations.value,
        registration.transformTypes.value,
        saved.homographies, saved.observations, saved.transformTypes,
      ].some((map) => key in map);
    });

    /**
     * Delete the active pair's registration, saved and unsaved, and persist
     * that right away so it leaves its per-camera file (and the file goes if
     * nothing else is in it). Other pairs are untouched. When no transform is
     * left anywhere the aligned view is unavailable; switch it off so it
     * doesn't come back on by itself after a later registration.
     */
    async function deletePair() {
      const key = activeKey.value;
      if (!key) {
        return;
      }
      const file = pairFileName.value;
      const confirmed = await prompt({
        title: `Delete ${pairLabel.value} Registration?`,
        text: `Remove the ${pairLabel.value} points and transform`
          + `${file ? `, and its entry in ${file}` : ''}? Other camera pairs are `
          + 'not affected. This cannot be undone.',
        positiveButton: 'Delete',
        negativeButton: 'Cancel',
        confirm: true,
      });
      if (!confirmed) {
        return;
      }
      registration.deletePair(key);
      if (!Object.keys(registration.homographies.value).length) {
        alignedView.setEnabled(false);
      }
      await persistPair(key);
    }

    /**
     * Auto Register Frames: launch the align_cameras pipeline over a
     * stratified spread of candidate frames (one job registers the whole
     * rig; a triplet solves up to three pairs at once). The service is
     * provided by the viewer; availability tracks whether the align pipes
     * are installed, which hides the button entirely when they aren't.
     */
    const autoRegisterJob = useAutoRegisterJob();
    const autoRegisterAvailable = computed(() => !!autoRegisterJob?.available.value);
    const autoRegistering = computed(() => !!autoRegisterJob?.running.value);
    const autoRegisterError = computed(() => autoRegisterJob?.error.value ?? null);
    const autoRegisterStatus = computed(() => autoRegisterJob?.status.value ?? null);
    const autoRegisterDialog = ref(false);

    /** Hover text for the Auto Register button: what it will actually run. */
    const autoRegisterTooltip = computed(() => {
      const pipe = autoRegisterJob?.pipe.value;
      return pipe
        ? `Auto Register: runs ${pipe.name} (${pipe.pipe})`
        : 'Auto Register';
    });

    function openAutoRegisterDialog() {
      autoRegisterDialog.value = true;
    }
    function runAutoRegister(options: AutoRegisterRunOptions) {
      autoRegisterJob?.run(options);
    }

    /**
     * Rig-level consistency readout for a solved triplet: with all three
     * pairs fitted, compare the direct A->C transform against the A->B->C
     * route. This is the whole reason to solve the redundant third pair --
     * three individually plausible fits can still disagree as a rig.
     *
     * The residual comes out in the LAST camera's native pixels (the grid is
     * pushed from camera 1 into camera 3), so both halves of this have to
     * respect real image sizes:
     *
     *  - Sample over camera 1's actual frame. The default nominal 1000x1000
     *    grid only covers a corner of a 12768x9564 EO frame, so it measured
     *    agreement over a fraction of the field of view and missed exactly
     *    the divergence at the edges that matters.
     *  - Judge the result relative to camera 3's width, not against a fixed
     *    pixel count. The same rig error reads ~7.6x larger against a
     *    4864-wide UV camera than a 640-wide IR one, so a fixed threshold
     *    silently means something different per rig -- and flags a rig
     *    inconsistent for nothing more than having a large last camera.
     */
    /**
     * A camera's native frame size, or null until its annotator has actually
     * drawn a frame. originalBounds starts life as a 1x1 placeholder
     * (useMediaController's reactive state), so "not ready" has to be
     * detected by an implausibly small box rather than a zero -- a 1x1 box
     * read as a real size collapses the loop-closure sample grid onto a
     * single corner pixel and yields a meaningless residual.
     */
    function nativeSize(camera: string): [number, number] | null {
      try {
        const bounds = aggregateController.value.getController(camera).originalBounds.value;
        const width = bounds.right - bounds.left;
        const height = bounds.bottom - bounds.top;
        return (width > 1 && height > 1) ? [width, height] : null;
      } catch {
        return null;
      }
    }
    const loopClosure = computed(() => {
      const list = cameras.value;
      if (list.length !== 3) {
        return null;
      }
      const directed = (a: string, b: string): Matrix3 | null => {
        const forward = registration.homographies.value[registration.pairKey(a, b)];
        if (forward) {
          return forward.AtoB;
        }
        const reverse = registration.homographies.value[registration.pairKey(b, a)];
        return reverse ? reverse.BtoA : null;
      };
      const h01 = directed(list[0], list[1]);
      const h12 = directed(list[1], list[2]);
      const h02 = directed(list[0], list[2]);
      if (!h01 || !h12 || !h02) {
        return null;
      }
      // Both ends must be measurable: the grid is sampled over the source
      // camera's frame and the residual judged against the target camera's
      // width, so a placeholder size on either side makes the ratio
      // meaningless. Report nothing while the panes are still coming up
      // rather than a confident-looking wrong verdict.
      const sourceSize = nativeSize(list[0]);
      const targetSize = nativeSize(list[2]);
      if (!sourceSize || !targetSize) {
        return null;
      }
      const residual = loopClosureResidual(h01, h12, h02, sourceSize);
      const fraction = residual.meanPx / targetSize[0];
      return {
        ...residual,
        fraction,
        consistent: fraction <= LOOP_CLOSURE_MAX_FRACTION,
        route: `${list[0]}↔${list[2]} vs ${list[0]}↔${list[1]}↔${list[2]}`,
      };
    });

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
      pairStats,
      currentPairFrame,
      frameRows,
      frameCorrespondences,
      markerFrames,
      toggleFrameRow,
      jumpToFrame,
      removeFrameRow,
      seekPrevMarker,
      seekNextMarker,
      addCurrentFrame,
      skippedCount,
      autoRows,
      manualRows,
      autoSummary,
      manualSummary,
      queuedSlots,
      currentSlot,
      currentQueued,
      queueCurrentFrame,
      unqueueSlot,
      runQueuedFrames,
      autoAll,
      manualAll,
      clearAuto,
      clearManual,
      clearQueue,
      transformType,
      transformTypeItems: TRANSFORM_TYPES,
      minPoints,
      alignmentModeItems,
      hasTransform,
      refinedFromSource,
      canClearPair,
      canClearLast,
      canFit,
      fitQualityColor,
      transformStatus,
      setLinkedNav,
      linkedNav: registration.linkedNav,
      pairLabel,
      pairDirty,
      otherPairsDirty,
      pairFileName,
      saving,
      sourceReadout,
      setTransformType,
      setAlignmentMode,
      save,
      canDeletePair,
      deletePair,
      autoRegisterAvailable,
      autoRegistering,
      autoRegisterError,
      autoRegisterStatus,
      autoRegisterDialog,
      autoRegisterTooltip,
      openAutoRegisterDialog,
      runAutoRegister,
      loopClosure,
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
    <!-- Rig status: one chip per camera, details on hover -->
    <div
      v-if="cameras.length >= 2"
      class="d-flex align-center flex-wrap"
    >
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
        {{ cam.name }}
      </v-chip>
      <v-spacer />
      <v-tooltip
        bottom
        max-width="320"
      >
        <template #activator="{ on }">
          <v-icon
            small
            class="mb-1"
            v-on="on"
          >
            mdi-information-outline
          </v-icon>
        </template>
        <div>
          {{ alignmentSummary.text }}; the starred camera is the reference.
          Register a camera by importing a registration file (Import menu),
          running Auto Register, or picking matching points between two cameras.
        </div>
        <div
          v-if="sourceReadout"
          class="mt-1"
        >
          Source: {{ sourceReadout }}
        </div>
      </v-tooltip>
    </div>
    <v-tooltip
      v-if="loopClosure"
      bottom
      max-width="320"
    >
      <template #activator="{ on }">
        <div
          class="d-flex align-center text-caption"
          :class="loopClosure.consistent ? 'success--text' : 'warning--text'"
          v-on="on"
        >
          <v-icon
            small
            :color="loopClosure.consistent ? 'success' : 'warning'"
            class="mr-1"
          >
            {{ loopClosure.consistent ? 'mdi-vector-triangle' : 'mdi-alert' }}
          </v-icon>
          Loop closure {{ loopClosure.meanPx.toFixed(1) }} px
          {{ loopClosure.consistent ? '' : '· inconsistent' }}
        </div>
      </template>
      {{ (loopClosure.fraction * 100).toFixed(3) }}% of {{ cameras[2] }} width.
      Compares {{ loopClosure.route }}.
    </v-tooltip>
    <v-tooltip
      v-if="refinedFromSource"
      bottom
      max-width="320"
    >
      <template #activator="{ on }">
        <div
          class="d-flex align-center text-caption warning--text"
          v-on="on"
        >
          <v-icon
            small
            color="warning"
            class="mr-1"
          >
            mdi-source-branch
          </v-icon>
          Refined since the source registration
        </div>
      </template>
      {{ pairDirty ? 'Save, then download' : 'Download' }} the camera's registration
      from the Export menu to hand the refinement (and its points) back to the
      producer.
    </v-tooltip>

    <!-- Active pair -->
    <div class="d-flex mt-3">
      <v-select
        v-model="camLeft"
        :items="cameras"
        label="Camera A"
        dense
        outlined
        hide-details
        class="mr-2"
      />
      <v-select
        v-model="camRight"
        :items="cameras"
        label="Camera B"
        dense
        outlined
        hide-details
      />
    </div>
    <v-tooltip
      bottom
      max-width="320"
    >
      <template #activator="{ on }">
        <div
          class="d-flex align-center text-caption mt-2"
          v-on="on"
        >
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
      </template>
      {{ transformStatus.hint }}
    </v-tooltip>

    <template v-if="camLeft && camRight && camLeft !== camRight">
      <v-divider class="my-3" />
      <div class="d-flex align-center">
        <v-tooltip
          bottom
          max-width="320"
        >
          <template #activator="{ on }">
            <h4 v-on="on">
              Registration Frames
            </h4>
          </template>
          The fit pools points from every checked frame, auto and manual alike.
          Uncheck a frame to exclude it without deleting its points.
        </v-tooltip>
        <v-spacer />
        <tooltip-btn
          icon="mdi-chevron-left"
          :disabled="!markerFrames.length"
          tooltip-text="Previous registration frame"
          @click="seekPrevMarker"
        />
        <tooltip-btn
          icon="mdi-chevron-right"
          :disabled="!markerFrames.length"
          tooltip-text="Next registration frame"
          @click="seekNextMarker"
        />
      </div>

      <!-- Auto: matched frames, and the queue for the next run -->
      <div class="d-flex align-center mt-1">
        <v-icon
          x-small
          class="mr-1"
        >
          mdi-auto-fix
        </v-icon>
        <span class="font-weight-medium">Auto</span>
        <span class="text-caption grey--text mx-2">
          {{ autoSummary.enabled }}/{{ autoSummary.total }}
          <template v-if="autoSummary.rmsPx !== null">
            · rms {{ autoSummary.rmsPx.toFixed(1) }} px
          </template>
        </span>
        <v-spacer />
        <tooltip-btn
          v-if="autoRegisterAvailable"
          icon="mdi-playlist-plus"
          :disabled="currentSlot === null || currentQueued"
          :tooltip-text="currentQueued
            ? 'This frame is already queued'
            : 'Queue the current frame for a matcher run'"
          @click="queueCurrentFrame"
        />
        <tooltip-btn
          icon="mdi-delete-sweep-outline"
          color="error"
          :disabled="!autoAll.length"
          tooltip-text="Clear all auto-registered frames for this pair"
          @click="clearAuto"
        />
        <tooltip-btn
          v-if="autoRegisterAvailable"
          icon="mdi-play-circle-outline"
          color="primary"
          :disabled="cameras.length < 2 || autoRegistering"
          :tooltip-text="autoRegisterTooltip"
          @click="openAutoRegisterDialog"
        />
      </div>
      <!-- Running state for the matcher job. It lives in the section, not on
           a button: a run has to still read as running when the user leaves
           this tab and comes back (the job service owns `running`, this
           component does not). -->
      <div
        v-if="autoRegistering"
        class="ml-2 mb-2"
      >
        <v-progress-linear
          indeterminate
          height="3"
          rounded
          color="primary"
        />
        <span class="text-caption grey--text d-block mt-1">
          {{ autoRegisterStatus || 'Auto Register running…' }}
        </span>
      </div>
      <registration-frame-list
        :rows="autoRows"
        @toggle="toggleFrameRow"
        @jump="jumpToFrame"
        @remove="removeFrameRow"
      />
      <span
        v-if="!autoRows.length && !autoRegistering"
        class="text-caption grey--text d-block ml-2"
      >
        None yet
      </span>
      <div
        v-if="queuedSlots.length"
        class="d-flex align-center flex-wrap ml-2 mt-1"
      >
        <span class="text-caption grey--text mr-1">Queued:</span>
        <v-chip
          v-for="slot in queuedSlots"
          :key="`queued-${slot}`"
          x-small
          label
          close
          class="mr-1 mb-1"
          @click:close="unqueueSlot(slot)"
        >
          {{ slot }}
        </v-chip>
        <v-spacer />
        <tooltip-btn
          icon="mdi-play"
          color="primary"
          :disabled="autoRegistering"
          :tooltip-text="`Run the matcher on ${queuedSlots.length} queued frame(s)`"
          @click="runQueuedFrames"
        />
        <tooltip-btn
          icon="mdi-close"
          tooltip-text="Clear the queue"
          @click="clearQueue"
        />
      </div>

      <!-- Manual: hand-picked points -->
      <div class="d-flex align-center mt-3">
        <v-icon
          x-small
          class="mr-1"
        >
          mdi-cursor-default-click-outline
        </v-icon>
        <span class="font-weight-medium">Manual</span>
        <span class="text-caption grey--text mx-2">
          {{ manualSummary.enabled }}/{{ manualSummary.total }}
          <template v-if="manualSummary.rmsPx !== null">
            · rms {{ manualSummary.rmsPx.toFixed(1) }} px
          </template>
        </span>
        <v-spacer />
        <tooltip-btn
          icon="mdi-delete-sweep-outline"
          color="error"
          :disabled="!manualAll.length"
          tooltip-text="Clear all hand-picked frames for this pair"
          @click="clearManual"
        />
        <tooltip-btn
          icon="mdi-plus"
          tooltip-text="Pick points on the current frame"
          @click="addCurrentFrame"
        />
      </div>
      <registration-frame-list
        :rows="manualRows"
        @toggle="toggleFrameRow"
        @jump="jumpToFrame"
        @remove="removeFrameRow"
      />
      <span
        v-if="!manualRows.length"
        class="text-caption grey--text d-block ml-2"
      >
        None yet
      </span>

      <span
        v-if="skippedCount"
        class="text-caption grey--text d-block mt-1"
      >
        {{ skippedCount }} frame(s) rejected by the matcher are hidden
      </span>
    </template>

    <auto-register-dialog
      v-model="autoRegisterDialog"
      :camera-count="cameras.length"
      :running="autoRegistering"
      @run="runAutoRegister"
    />
    <span
      v-if="autoRegisterError"
      class="text-caption error--text d-block mt-1"
    >
      {{ autoRegisterError }}
    </span>
    <span
      v-else-if="autoRegisterStatus && !autoRegistering"
      class="text-caption success--text d-block mt-1"
    >
      {{ autoRegisterStatus }}
    </span>

    <v-divider class="my-3" />
    <div class="d-flex align-center">
      <v-switch
        v-model="pickingEnabled"
        label="Edit points"
        dense
        hide-details
        class="mt-0 pt-0"
      />
      <v-spacer />
      <v-checkbox
        :input-value="linkedNav"
        :disabled="!hasTransform"
        :color="fitQualityColor"
        label="Link pan/zoom"
        dense
        hide-details
        class="mt-0 pt-0"
        @change="setLinkedNav"
      />
    </div>

    <template v-if="pickingEnabled">
      <div
        class="text-caption mt-2"
        style="font-family: monospace;"
      >
        {{ cursorReadout || 'Click matching features in each camera to add pairs.' }}
      </div>

      <v-expansion-panels
        flat
        accordion
      >
        <v-expansion-panel>
          <v-expansion-panel-header class="px-1">
            Points on frame
            {{ currentPairFrame !== null ? currentPairFrame : '—' }}
            ({{ frameCorrespondences.length }})
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
              v-if="frameCorrespondences.length"
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
                    v-for="(c, i) in frameCorrespondences"
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
              v-else
              class="text-caption grey--text"
            >
              None on this frame ({{ correspondences.length }} across all frames).
            </span>
          </v-expansion-panel-content>
        </v-expansion-panel>
      </v-expansion-panels>

      <div class="d-flex align-center mt-2">
        <v-select
          :value="transformType"
          :items="transformTypeItems"
          item-text="text"
          item-value="value"
          label="Transform type"
          dense
          outlined
          hide-details
          @change="setTransformType"
        />
        <span
          class="text-caption ml-2 text-no-wrap"
          :class="canFit ? 'success--text' : 'grey--text'"
        >
          {{ correspondences.length }} / {{ minPoints }} pairs
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

    <div class="d-flex align-center">
      <span class="text-caption mr-2">Overlay</span>
      <v-btn-toggle
        :value="alignment.mode"
        mandatory
        dense
        class="d-flex flex-grow-1"
        @change="setAlignmentMode"
      >
        <v-btn
          v-for="item in alignmentModeItems"
          :key="item.value"
          :value="item.value"
          :disabled="item.disabled"
          :title="item.title"
          small
          class="flex-grow-1"
          style="text-transform: none;"
        >
          {{ item.text }}
        </v-btn>
      </v-btn-toggle>
    </div>
    <v-slider
      v-model="alignment.opacity"
      label="Opacity"
      :min="0"
      :max="1"
      :step="0.05"
      :disabled="alignment.mode === 'original'"
      dense
      hide-details
      class="mt-2"
    />

    <v-tooltip
      bottom
      :disabled="!pairFileName"
    >
      <template #activator="{ on }">
        <div
          class="mt-3 mb-2"
          v-on="on"
        >
          <v-btn
            block
            :color="pairDirty ? 'success' : undefined"
            :disabled="!pairDirty || saving"
            small
            :loading="saving"
            @click="save"
          >
            {{ pairDirty ? `Save ${pairLabel}` : `${pairLabel} saved` }}
          </v-btn>
        </div>
      </template>
      Writes {{ pairFileName }}
    </v-tooltip>
    <span
      v-if="otherPairsDirty"
      class="text-caption warning--text d-block mb-2"
    >
      Other camera pairs have unsaved changes; select a pair to save it.
    </span>
    <v-btn
      block
      outlined
      color="error"
      :disabled="!canDeletePair || saving"
      small
      class="mb-2"
      @click="deletePair"
    >
      Delete {{ pairLabel }}
    </v-btn>
  </div>
</template>
