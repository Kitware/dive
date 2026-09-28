<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  PropType,
  ref,
  watch,
} from 'vue';
import { flatten } from 'lodash';

import { Mousetrap, SuppressionDisplaySettings } from 'vue-media-annotator/types';
import { EditAnnotationTypes, VisibleAnnotationTypes } from 'vue-media-annotator/layers';
import Recipe from 'vue-media-annotator/recipe';
import SegmentationPointClick from 'dive-common/recipes/segmentationpointclick';
import type { TextQueryModelOptions } from 'dive-common/apispec';

import AnnotationVisibilityMenu from './AnnotationVisibilityMenu.vue';
import VlmSetupHelp from './VlmSetupHelp.vue';
import OutlinedLabeledGroup from './OutlinedLabeledGroup.vue';
import ToolbarExpandToggle from './ToolbarExpandToggle.vue';

interface ButtonData {
  id: string;
  icon: string;
  type?: VisibleAnnotationTypes;
  active: boolean;
  loading?: boolean;
  unavailable?: boolean;
  unavailableTooltip?: string;
  mousetrap?: Mousetrap[];
  description: string;
  click: () => void;
}

export default defineComponent({
  name: 'EditorMenu',
  components: {
    AnnotationVisibilityMenu,
    OutlinedLabeledGroup,
    ToolbarExpandToggle,
    VlmSetupHelp,
  },
  props: {
    hasSelectedTrack: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    editingTrack: {
      type: Boolean,
      required: true,
    },
    visibleModes: {
      type: Array as PropType<(VisibleAnnotationTypes)[]>,
      required: true,
    },
    editingMode: {
      type: [String, Boolean] as PropType<false | EditAnnotationTypes>,
      required: true,
    },
    editingDetails: {
      type: String as PropType<'disabled' | 'Creating' | 'Editing'>,
      required: true,
    },
    recipes: {
      type: Array as PropType<Recipe[]>,
      required: true,
    },
    multiSelectActive: {
      type: Boolean,
      default: false,
    },
    groupEditActive: {
      type: Boolean,
      default: false,
    },
    lassoModeActive: {
      type: Boolean,
      default: false,
    },
    lassoDrawing: {
      type: Boolean,
      default: false,
    },
    tailSettings: {
      type: Object as PropType<{ before: number; after: number }>,
      default: () => ({ before: 20, after: 10 }),
    },
    showUserCreatedIcon: {
      type: Boolean,
      default: true,
    },
    showSuppressedTags: {
      type: Boolean,
      default: true,
    },
    suppressionDisplay: {
      type: Object as PropType<SuppressionDisplaySettings>,
      default: undefined,
    },
    textQueryEnabled: {
      type: Boolean,
      default: false,
    },
    textQueryAvailable: {
      type: Boolean,
      default: false,
    },
    /** Re-lists the text query backends, e.g. after a model download. */
    loadTextQueryModels: {
      type: Function as PropType<() => Promise<TextQueryModelOptions>>,
      default: undefined,
    },
    /** True while browser auto-populate (mask/points) is embedding or predicting. */
    autoPopulateBusy: {
      type: Boolean,
      default: false,
    },
    /** Live status from the SAM session during auto-populate (encode/predict). */
    autoPopulateStatus: {
      type: String as PropType<string | null>,
      default: null,
    },
  },
  emits: [
    'set-annotation-state',
    'update:tail-settings',
    'update:show-user-created-icon',
    'update:show-suppressed-tags',
    'update:suppression-display',
    'text-query-init',
    'text-query',
    'text-query-all-frames',
    'open-external-link',
    'cancel-auto-populate',
  ],
  setup(props, { emit }) {
    const toolsDisabled = computed(() => props.disabled || props.multiSelectActive
      || props.groupEditActive || props.lassoModeActive || props.lassoDrawing);
    const creatingAnnotation = computed(() => !props.hasSelectedTrack);
    const toolTitle = (button: ButtonData) => (creatingAnnotation.value
      ? `Create annotation: ${button.description}` : button.description);
    const activateTool = (action: () => void) => {
      if (!toolsDisabled.value) action();
    };
    const toolTimeTimeout = ref<number | null>(null);
    const STORAGE_KEY = 'editorMenu.editButtonsExpanded';

    // Load from localStorage or default to true
    const loadExpandedState = (): boolean => {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored !== null ? stored === 'true' : true;
    };

    const isEditButtonsExpanded = ref(loadExpandedState());

    // Save to localStorage when state changes
    watch(isEditButtonsExpanded, (value) => {
      localStorage.setItem(STORAGE_KEY, String(value));
    });

    // Text query state
    const textQueryDialogOpen = ref(false);
    const textQueryInput = ref('');
    const textQueryLoading = ref(false);
    const textQueryThreshold = ref(0.3);
    const textQueryInitializing = ref(false);
    const textQueryServiceError = ref('');
    const textQueryAllFrames = ref(false);
    // When on, existing annotations are removed before the query results are
    // applied. On by default so a query replaces rather than accumulates.
    const textQueryReplaceExisting = ref(true);
    const SAM3_MODEL = 'sam3';
    const TEXT_QUERY_MODEL_KEY = 'editorMenu.textQueryModel';
    const textQueryModelOptions = ref<TextQueryModelOptions>({
      sam3: true, vlm: { available: false, models: [] },
    });
    const textQueryModelsChecking = ref(false);
    const preferredTextQueryModel = ref(localStorage.getItem(TEXT_QUERY_MODEL_KEY) || SAM3_MODEL);
    const textQueryModelItems = computed(() => [
      {
        text: textQueryModelOptions.value.sam3 ? 'SAM3' : 'SAM3 (not installed)',
        value: SAM3_MODEL,
        installed: textQueryModelOptions.value.sam3,
      },
      ...textQueryModelOptions.value.vlm.models.map((m) => ({
        text: m.installed ? m.name : `${m.name} (not installed)`,
        value: m.name,
        installed: m.installed,
      })),
    ]);
    // The preference survives a model list that briefly lacks it (e.g. Ollama
    // slow to answer); only the effective choice falls back.
    const textQueryModel = computed({
      get: () => {
        const items = textQueryModelItems.value;
        return items.some((item) => item.value === preferredTextQueryModel.value)
          ? preferredTextQueryModel.value
          : (items.find((item) => item.installed) ?? items[0]).value;
      },
      set: (value: string) => {
        preferredTextQueryModel.value = value;
        localStorage.setItem(TEXT_QUERY_MODEL_KEY, value);
      },
    });
    const textQueryUsesVlm = computed(() => textQueryModel.value !== SAM3_MODEL);
    const textQueryVlmMissing = computed(() => textQueryUsesVlm.value
      && textQueryModelOptions.value.vlm.models.some(
        (m) => m.name === textQueryModel.value && !m.installed,
      ));
    const textQuerySam3Missing = computed(() => !textQueryUsesVlm.value
      && !textQueryModelOptions.value.sam3);
    const textQueryModelMissing = computed(
      () => textQueryVlmMissing.value || textQuerySam3Missing.value,
    );

    const recheckTextQueryModels = async () => {
      if (!props.loadTextQueryModels) return;
      textQueryModelsChecking.value = true;
      try {
        textQueryModelOptions.value = await props.loadTextQueryModels();
      } finally {
        textQueryModelsChecking.value = false;
      }
    };

    // The dialog explains how to install whichever model is missing, so it
    // opens even when nothing is installed yet.
    const handleTextQueryClick = () => {
      if (toolsDisabled.value) return;
      openTextQueryDialog();
    };

    const openTextQueryDialog = () => {
      textQueryDialogOpen.value = true;
      textQueryInput.value = '';
      textQueryServiceError.value = '';
      textQueryAllFrames.value = false;
      textQueryReplaceExisting.value = true;
      textQueryInitializing.value = true;
      emit('text-query-init');
    };

    const closeTextQueryDialog = () => {
      textQueryDialogOpen.value = false;
      textQueryInput.value = '';
      textQueryServiceError.value = '';
      textQueryInitializing.value = false;
      textQueryAllFrames.value = false;
      textQueryReplaceExisting.value = true;
    };

    const onTextQueryServiceReady = (
      success: boolean,
      error?: string,
      options?: TextQueryModelOptions,
    ) => {
      textQueryInitializing.value = false;
      if (!success) {
        textQueryServiceError.value = error || 'Text query service is not available';
      }
      if (options) {
        textQueryModelOptions.value = options;
      }
    };

    const submitTextQuery = () => {
      if (!textQueryInput.value.trim() || textQueryModelMissing.value) {
        return;
      }
      textQueryLoading.value = true;
      if (textQueryAllFrames.value) {
        emit('text-query-all-frames', {
          text: textQueryInput.value.trim(),
          boxThreshold: textQueryThreshold.value,
          replaceExisting: textQueryReplaceExisting.value,
          vlmModel: textQueryUsesVlm.value ? textQueryModel.value : undefined,
        });
      } else {
        emit('text-query', {
          text: textQueryInput.value.trim(),
          boxThreshold: textQueryThreshold.value,
          replaceExisting: textQueryReplaceExisting.value,
          vlmModel: textQueryUsesVlm.value ? textQueryModel.value : undefined,
        });
      }
      closeTextQueryDialog();
      textQueryLoading.value = false;
    };

    const modeToolTips = {
      Creating: {
        rectangle: 'Drag to draw rectangle. Press ESC to exit.',
        Polygon: 'Click to place vertices. Right click to close.',
        LineString: 'Place head/tail points, then drag segment midpoints to add vertices.',
      },
      Editing: {
        rectangle: 'Drag vertices to resize the rectangle',
        Polygon: 'Drag midpoints to create new vertices. Click vertices to select for deletion.',
        LineString: 'Click a vertex to select it for deletion.',
      },
    };

    const editButtons = computed((): ButtonData[] => {
      const em = props.editingMode;
      return [
        {
          id: 'rectangle',
          icon: 'mdi-vector-square',
          active: props.editingTrack && em === 'rectangle',
          description: 'Rectangle',
          mousetrap: [{
            bind: '1',
            handler: () => {
              activateTool(() => emit('set-annotation-state', { editing: 'rectangle' }));
            },
          }],
          click: () => {
            activateTool(() => emit('set-annotation-state', { editing: 'rectangle' }));
          },
        },
        /* Include recipes as editing modes if they're toggleable */
        ...props.recipes.filter((r) => r.toggleable.value).map((r, i) => ({
          id: r.name,
          icon: r.icon.value || 'mdi-pencil',
          active: props.editingTrack && r.active.value,
          // Model download/init only — keep the tool usable while a mask runs.
          loading: r.loading?.value ?? false,
          description: r.name,
          click: () => activateTool(() => r.activate()),
          mousetrap: [
            {
              bind: (i + 2).toString(),
              handler: () => activateTool(() => r.activate()),
            },
            ...r.mousetrap().map((shortcut) => ({
              ...shortcut, handler: () => activateTool(shortcut.handler),
            })),
          ],
        })),
        /* Text Query button included alongside other annotation types (desktop only) */
        ...(props.textQueryEnabled ? [{
          id: 'Text Query',
          icon: 'mdi-text-search',
          active: false,
          unavailable: !props.textQueryAvailable,
          unavailableTooltip: 'No text query model installed. Click for setup instructions.',
          description: 'Text Query',
          mousetrap: [{
            bind: 'q',
            handler: () => handleTextQueryClick(),
          }],
          click: () => handleTextQueryClick(),
        }] : []),
      ];
    });

    const mousetrap = computed((): Mousetrap[] => [
      ...flatten(editButtons.value.map((b) => b.mousetrap || [])),
      ...(autoPopulateBusyVisible.value ? [{
        bind: 'esc',
        handler: () => { cancelAutoPopulate(); },
      }] : []),
    ]);

    const activeEditButton = computed(() => editButtons.value.find((b) => b.active) || editButtons.value[0]);

    const toggleEditButtonsExpanded = () => {
      isEditButtonsExpanded.value = !isEditButtonsExpanded.value;
    };

    const editButtonsMenuKey = computed(() => `${props.editingMode}-${editButtons.value.length}-${activeEditButton.value?.id || ''}`);

    const editingHeader = computed(() => {
      if (props.lassoDrawing) {
        return { text: 'Lasso Selection', icon: 'mdi-gesture', color: 'info' };
      }
      if (props.lassoModeActive) {
        return { text: 'Lasso Mode', icon: 'mdi-gesture', color: 'info' };
      }
      if (props.groupEditActive) {
        return { text: 'Group Edit Mode', icon: 'mdi-group', color: 'primary' };
      }
      if (props.multiSelectActive) {
        return { text: 'Multi-select Mode', icon: 'mdi-call-merge', color: 'error' };
      }
      if (props.autoPopulateBusy && !activeSegmentationRecipe.value) {
        return {
          text: 'Auto-populating',
          icon: 'mdi-loading mdi-spin',
          color: 'warning',
        };
      }
      if (activeSegmentationRecipe.value) {
        return {
          text: `${props.editingDetails === 'Editing' ? 'Editing' : 'Creating'} Segment`,
          icon: 'mdi-auto-fix',
          color: props.editingDetails === 'Creating' ? 'success' : 'primary',
        };
      }
      if (props.editingDetails !== 'disabled') {
        return {
          text: `${props.editingDetails} ${props.editingMode} `,
          icon: props.editingDetails === 'Creating' ? 'mdi-pencil-plus' : 'mdi-pencil',
          color: props.editingDetails === 'Creating' ? 'success' : 'primary',
        };
      }
      return { text: 'Not editing', icon: 'mdi-pencil-off-outline', color: '' };
    });

    const activeSegmentationRecipe = computed((): SegmentationPointClick | null => {
      const segRecipe = props.recipes.find(
        (r) => r instanceof SegmentationPointClick && r.active.value,
      ) as SegmentationPointClick | undefined;
      return segRecipe || null;
    });

    const segmentationPredicting = computed(
      () => activeSegmentationRecipe.value?.predicting.value ?? false,
    );

    const segmentationLoading = computed(() => {
      const segRecipe = props.recipes.find(
        (r) => r instanceof SegmentationPointClick,
      ) as SegmentationPointClick | undefined;
      return segRecipe?.loading.value ?? false;
    });

    /** After a long predict, promote Reset to an explicit Cancel control. */
    const SEGMENTATION_CANCEL_WARNING_MS = 3000;
    const segmentationCancelWarning = ref(false);
    let segmentationCancelWarningTimer: ReturnType<typeof setTimeout> | null = null;
    watch(segmentationPredicting, (predicting) => {
      if (segmentationCancelWarningTimer !== null) {
        clearTimeout(segmentationCancelWarningTimer);
        segmentationCancelWarningTimer = null;
      }
      if (predicting) {
        segmentationCancelWarning.value = false;
        segmentationCancelWarningTimer = setTimeout(() => {
          segmentationCancelWarningTimer = null;
          if (segmentationPredicting.value) {
            segmentationCancelWarning.value = true;
          }
        }, SEGMENTATION_CANCEL_WARNING_MS);
      } else {
        segmentationCancelWarning.value = false;
      }
    });

    /** Same 3s promotion for auto-populate encode/predict (especially CPU). */
    const autoPopulateCancelWarning = ref(false);
    let autoPopulateCancelWarningTimer: ReturnType<typeof setTimeout> | null = null;
    const autoPopulateBusyVisible = computed(
      () => props.autoPopulateBusy && !activeSegmentationRecipe.value,
    );
    watch(autoPopulateBusyVisible, (busy) => {
      if (autoPopulateCancelWarningTimer !== null) {
        clearTimeout(autoPopulateCancelWarningTimer);
        autoPopulateCancelWarningTimer = null;
      }
      if (busy) {
        autoPopulateCancelWarning.value = false;
        autoPopulateCancelWarningTimer = setTimeout(() => {
          autoPopulateCancelWarningTimer = null;
          if (autoPopulateBusyVisible.value) {
            autoPopulateCancelWarning.value = true;
          }
        }, SEGMENTATION_CANCEL_WARNING_MS);
      } else {
        autoPopulateCancelWarning.value = false;
      }
    });
    onBeforeUnmount(() => {
      if (segmentationCancelWarningTimer !== null) {
        clearTimeout(segmentationCancelWarningTimer);
      }
      if (autoPopulateCancelWarningTimer !== null) {
        clearTimeout(autoPopulateCancelWarningTimer);
      }
    });

    const segmentationTooltip = 'Left click for positive, middle or shift+click for negative points. Right click to confirm or Esc to cancel.';
    const segmentationStatusHint = computed(() => {
      if (segmentationLoading.value) return 'Loading segmentation model…';
      if (segmentationCancelWarning.value) {
        return 'Still computing — click Cancel or press Esc to abort.';
      }
      if (segmentationPredicting.value) {
        return 'Computing segmentation… Press Esc to cancel.';
      }
      if (autoPopulateBusyVisible.value) {
        if (autoPopulateCancelWarning.value) {
          return 'Still auto-populating — click Cancel or press Esc to abort.';
        }
        return props.autoPopulateStatus
          || 'Auto-populating mask/points… Press Esc to cancel.';
      }
      return null;
    });

    function cancelAutoPopulate() {
      emit('cancel-auto-populate');
    }
    const editingTooltip = computed(() => {
      if (props.editingDetails === 'disabled' || !props.editingMode || typeof props.editingMode !== 'string') {
        return '';
      }
      const tips = modeToolTips[props.editingDetails];
      if (!tips) {
        return '';
      }
      const mode = props.editingMode as keyof typeof modeToolTips.Creating;
      return tips[mode] || '';
    });

    watch(() => props.editingDetails, () => {
      if (toolTimeTimeout.value !== null) {
        clearTimeout(toolTimeTimeout.value);
      }
      if (props.editingDetails !== 'disabled') {
        toolTimeTimeout.value = setTimeout(() => {
          // Tooltip timeout handler - can be extended if needed
        }, 2000) as unknown as number;
      }
    });

    return {
      toolsDisabled,
      creatingAnnotation,
      toolTitle,
      modeToolTips,
      editButtons,
      mousetrap,
      editingHeader,
      editingTooltip,
      isEditButtonsExpanded,
      toggleEditButtonsExpanded,
      activeEditButton,
      editButtonsMenuKey,
      activeSegmentationRecipe,
      segmentationPredicting,
      segmentationLoading,
      segmentationCancelWarning,
      segmentationTooltip,
      segmentationStatusHint,
      autoPopulateBusyVisible,
      autoPopulateCancelWarning,
      cancelAutoPopulate,
      // Text query
      textQueryDialogOpen,
      textQueryInput,
      textQueryLoading,
      textQueryThreshold,
      textQueryInitializing,
      textQueryServiceError,
      textQueryAllFrames,
      textQueryReplaceExisting,
      textQueryModel,
      textQueryModelItems,
      textQueryUsesVlm,
      textQueryVlmMissing,
      textQuerySam3Missing,
      textQueryModelMissing,
      textQueryModelOptions,
      textQueryModelsChecking,
      recheckTextQueryModels,
      openTextQueryDialog,
      closeTextQueryDialog,
      onTextQueryServiceReady,
      submitTextQuery,
    };
  },
});
</script>

<template>
  <v-row
    v-mousetrap="mousetrap"
    class="pa-0 ma-0 grow"
    no-gutters
  >
    <div class="d-flex align-center grow">
      <div
        class="pa-1 d-flex"
        style="width: 280px;"
      >
        <v-icon class="pr-1">
          {{ editingHeader.icon }}
        </v-icon>
        <div>
          <div class="text-subtitle-2">
            {{ editingHeader.text }}
          </div>
          <div
            style="line-height: 1.22em;"
            :style="{ fontSize: activeSegmentationRecipe ? '12px' : '10px' }"
          >
            <span v-if="lassoDrawing">
              Release the mouse to select all tracks inside the lasso.
            </span>
            <span v-else-if="lassoModeActive">
              Drag around tracks to select them. Release Alt when finished.
              Hold Ctrl while dragging to add to the current selection.
            </span>
            <span v-else-if="groupEditActive">
              Editing group.  Add or remove tracks.  Esc. to exit.
            </span>
            <span v-else-if="multiSelectActive">
              Multi-select in progress.  Editing is disabled.
              Select additional tracks to merge or group.
            </span>
            <span v-else-if="segmentationStatusHint">
              {{ segmentationStatusHint }}
            </span>
            <span v-else-if="activeSegmentationRecipe">
              {{ segmentationTooltip }}
            </span>
            <span v-else-if="editingDetails !== 'disabled' && editingMode && typeof editingMode === 'string'">
              {{ editingTooltip }}
            </span>
            <span v-else>Pick a tool, or right click to edit</span>
          </div>
        </div>
      </div>
      <!-- Collapsed mode for edit buttons -->
      <span
        class="toolbar-group-host"
      >
        <v-menu
          v-if="!isEditButtonsExpanded"
          :key="editButtonsMenuKey"
          offset-y
          :close-on-content-click="false"
        >
          <template #activator="{ on, attrs }">
            <v-btn
              v-bind="attrs"
              :disabled="toolsDisabled || !!activeEditButton?.loading"
              :loading="!!activeEditButton?.loading"
              :color="activeEditButton?.active ? editingHeader.color : ''"
              class="mx-1 mode-button toolbar-group-activator tool-button"
              small
              v-on="on"
            >
              <pre
                v-if="activeEditButton?.mousetrap"
                :class="{ 'edit-btn-unavailable': toolsDisabled }"
              >{{ activeEditButton.mousetrap[0].bind }}:</pre>
              <span class="creation-anchor">
                <v-icon :class="{ 'edit-btn-unavailable': toolsDisabled }">
                  {{ activeEditButton?.icon }}
                </v-icon>
                <v-icon v-if="creatingAnnotation" x-small class="creation-indicator">
                  mdi-plus
                </v-icon>
              </span>
              <toolbar-expand-toggle
                :expanded="false"
                @click="toggleEditButtonsExpanded"
              />
            </v-btn>
          </template>
          <v-list dense>
            <v-list-item
              v-for="button in editButtons"
              :key="`${button.id}-menu`"
            >
              <v-list-item-icon>
                <v-tooltip
                  bottom
                  :disabled="!button.unavailable"
                >
                  <template #activator="{ on: tooltipOn, attrs: tooltipAttrs }">
                    <span
                      v-bind="button.unavailable ? tooltipAttrs : {}"
                      v-on="button.unavailable ? tooltipOn : {}"
                    >
                      <v-btn
                        :disabled="toolsDisabled || !!button.loading"
                        :title="toolTitle(button)"
                        :loading="!!button.loading"
                        :outlined="!button.active"
                        :color="button.active ? editingHeader.color : ''"
                        :class="{ 'edit-btn-unavailable': button.unavailable && !button.loading }"
                        class="mx-1 tool-button"
                        small
                        @click="button.click"
                      >
                        <pre v-if="button.mousetrap">{{ button.mousetrap[0].bind }}:</pre>
                        <span class="creation-anchor">
                          <v-icon>
                            {{ button.icon }}
                          </v-icon>
                          <v-icon v-if="creatingAnnotation" x-small class="creation-indicator">
                            mdi-plus
                          </v-icon>
                        </span>
                      </v-btn>
                    </span>
                  </template>
                  <span>{{ button.unavailableTooltip }}</span>
                </v-tooltip>
              </v-list-item-icon>
              <v-list-item-content>
                <v-list-item-title>{{ button.id }}</v-list-item-title>
              </v-list-item-content>
            </v-list-item>
          </v-list>
        </v-menu>

        <!-- Expanded mode for edit buttons -->
        <outlined-labeled-group v-else>
          <template #legend>
            <span class="d-inline-flex align-center">
              <v-icon
                small
                class="pr-1"
              >
                mdi-pencil
              </v-icon>
              <span>{{ creatingAnnotation ? 'Create Annotation' : 'Edit Types' }}</span>
              <toolbar-expand-toggle
                :expanded="true"
                @click="toggleEditButtonsExpanded"
              />
            </span>
          </template>
          <v-tooltip
            v-for="button in editButtons"
            :key="button.id + 'view'"
            bottom
            :disabled="!button.unavailable"
          >
            <template #activator="{ on: tooltipOn, attrs: tooltipAttrs }">
              <span
                v-bind="button.unavailable ? tooltipAttrs : {}"
                class="d-inline-block"
                v-on="button.unavailable ? tooltipOn : {}"
              >
                <v-btn
                  :disabled="toolsDisabled || !!button.loading"
                  :title="toolTitle(button)"
                  :loading="!!button.loading"
                  :outlined="!button.active"
                  :color="button.active ? editingHeader.color : ''"
                  :class="{ 'edit-btn-unavailable': button.unavailable && !button.loading }"
                  class="mx-1 tool-button"
                  small
                  @click="button.click"
                >
                  <pre v-if="button.mousetrap">{{ button.mousetrap[0].bind }}:</pre>
                  <span class="creation-anchor">
                    <v-icon>
                      {{ button.icon }}
                    </v-icon>
                    <v-icon v-if="creatingAnnotation" x-small class="creation-indicator">
                      mdi-plus
                    </v-icon>
                  </span>
                </v-btn>
              </span>
            </template>
            <span>{{ button.unavailableTooltip }}</span>
          </v-tooltip>
        </outlined-labeled-group>
      </span>
      <!-- Segmentation Reset / Cancel button -->
      <template v-if="activeSegmentationRecipe && editingMode === 'Point'">
        <v-btn
          :color="segmentationCancelWarning ? 'warning' : 'error'"
          class="mx-1"
          small
          :disabled="!segmentationPredicting
            && !activeSegmentationRecipe.hasPoints()
            && !activeSegmentationRecipe.hasPendingPrediction()"
          :title="segmentationPredicting
            ? (segmentationCancelWarning
              ? 'Cancel the in-progress segmentation'
              : 'Cancel (Esc)')
            : 'Clear points (Esc)'"
          @click="activeSegmentationRecipe.resetPoints()"
        >
          <v-icon left>
            {{ segmentationCancelWarning ? 'mdi-cancel' : 'mdi-close' }}
          </v-icon>
          {{ segmentationCancelWarning ? 'Cancel' : 'Reset' }}
          <span
            v-if="segmentationPredicting && !segmentationCancelWarning"
            class="text-caption ml-1"
          >(Esc)</span>
        </v-btn>
      </template>
      <!-- Auto-populate Cancel (promotes after 3s like magic wand) -->
      <template v-else-if="autoPopulateBusyVisible">
        <v-btn
          :color="autoPopulateCancelWarning ? 'warning' : 'error'"
          class="mx-1"
          small
          :title="autoPopulateCancelWarning
            ? 'Cancel the in-progress auto-populate'
            : 'Cancel (Esc)'"
          @click="cancelAutoPopulate"
        >
          <v-icon left>
            {{ autoPopulateCancelWarning ? 'mdi-cancel' : 'mdi-close' }}
          </v-icon>
          Cancel
          <span
            v-if="!autoPopulateCancelWarning"
            class="text-caption ml-1"
          >(Esc)</span>
        </v-btn>
      </template>
      <!-- Hide delete controls when in segmentation mode -->
      <slot
        v-if="!activeSegmentationRecipe"
        name="delete-controls"
      />
      <v-spacer />
      <slot name="multicam-controls" />
      <annotation-visibility-menu
        :visible-modes="visibleModes"
        :tail-settings="tailSettings"
        :show-user-created-icon="showUserCreatedIcon"
        :show-suppressed-tags="showSuppressedTags"
        :suppression-display="suppressionDisplay"
        @set-annotation-state="$emit('set-annotation-state', $event)"
        @update:tail-settings="$emit('update:tail-settings', $event)"
        @update:show-user-created-icon="$emit('update:show-user-created-icon', $event)"
        @update:show-suppressed-tags="$emit('update:show-suppressed-tags', $event)"
        @update:suppression-display="$emit('update:suppression-display', $event)"
      />
    </div>

    <!-- Text Query Dialog -->
    <v-dialog
      v-if="textQueryEnabled"
      v-model="textQueryDialogOpen"
      max-width="500"
      :persistent="textQueryInitializing || textQueryLoading"
    >
      <v-card>
        <v-card-title class="text-h6">
          <v-icon left>
            mdi-text-search
          </v-icon>
          Text Query
        </v-card-title>
        <v-card-text>
          <!-- Loading state while initializing service -->
          <div
            v-if="textQueryInitializing"
            class="text-center py-4"
          >
            <v-progress-circular
              indeterminate
              color="primary"
              size="48"
            />
            <p class="text-body-2 mt-3">
              Loading text query model...
            </p>
          </div>
          <!-- Error state if service failed to initialize -->
          <div
            v-else-if="textQueryServiceError"
            class="text-center py-4"
          >
            <v-icon
              color="error"
              size="48"
            >
              mdi-alert-circle
            </v-icon>
            <p class="text-body-2 mt-3 error--text">
              {{ textQueryServiceError }}
            </p>
          </div>
          <!-- Normal input form when service is ready -->
          <template v-else>
            <p class="text-body-2 mb-3">
              Enter a description of objects to find in the current frame.
            </p>
            <v-select
              v-if="textQueryModelItems.length > 1"
              v-model="textQueryModel"
              :items="textQueryModelItems"
              label="Model"
              outlined
              dense
              :disabled="textQueryLoading"
            />
            <v-alert
              v-if="textQuerySam3Missing"
              type="info"
              dense
              text
              class="text-body-2 mb-2"
            >
              SAM3 text query needs the SAM3 Text Query Segmentation and Tracking
              Models add-on. Install it from the Add-Ons page.
              <v-btn
                small
                outlined
                color="primary"
                class="mt-2"
                :to="{ name: 'addons' }"
                @click="closeTextQueryDialog"
              >
                Open Add-Ons
              </v-btn>
            </v-alert>
            <VlmSetupHelp
              v-if="textQueryVlmMissing"
              :model="textQueryModel"
              :server-available="textQueryModelOptions.vlm.available"
              :checking="textQueryModelsChecking"
              @check="recheckTextQueryModels"
              @open-link="$emit('open-external-link', $event)"
            />
            <v-text-field
              v-model="textQueryInput"
              label="Object description"
              placeholder="e.g., fish swimming near coral"
              outlined
              dense
              autofocus
              :disabled="textQueryLoading"
              @keyup.enter="submitTextQuery"
            />
            <v-slider
              v-if="!textQueryUsesVlm"
              v-model="textQueryThreshold"
              :label="`Confidence threshold: ${Number(textQueryThreshold).toFixed(2)}`"
              min="0.1"
              max="0.9"
              step="0.05"
              thumb-label
              :disabled="textQueryLoading"
            />
            <v-checkbox
              v-model="textQueryAllFrames"
              label="Apply to all frames"
              hint="Run across all frames instead of only the current (this will run as a job)"
              persistent-hint
              :disabled="textQueryLoading"
            />
            <v-checkbox
              v-model="textQueryReplaceExisting"
              label="Replace existing annotations"
              hint="Remove annotations already present before adding query results (off = keep them)"
              persistent-hint
              :disabled="textQueryLoading"
            />
          </template>
          <p
            v-if="textQueryUsesVlm"
            class="text-caption mt-3 mb-0 text--secondary"
          >
            Boxes come from a locally served vision-language model and carry no confidence score.
          </p>
          <p
            v-else
            class="text-caption mt-3 mb-0 text--secondary"
          >
            Textual query support uses architectures derived from Meta's SAM3 project
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            text
            :disabled="textQueryLoading"
            @click="closeTextQueryDialog"
          >
            {{ textQueryServiceError ? 'Close' : 'Cancel' }}
          </v-btn>
          <v-btn
            v-if="!textQueryInitializing && !textQueryServiceError"
            color="primary"
            :loading="textQueryLoading"
            :disabled="!textQueryInput.trim() || textQueryLoading || textQueryModelMissing"
            @click="submitTextQuery"
          >
            Search
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-row>
</template>

<style scoped lang="scss">
@import './toolbarGroup.scss';

.modechip {
  border-radius: 16px;
  white-space: nowrap;
  border: 1px solid;
}

.edit-btn-unavailable {
  opacity: 0.45 !important;
}

.mode-button{
  border: 1px solid grey;
  min-width: 36px;
}

/* Room on the right for the creation +, kept in every mode so the buttons never resize */
.v-btn.v-size--small.tool-button {
  padding-left: 9px;
  padding-right: 11px;
}

.creation-anchor {
  position: relative;
  display: inline-flex;
}

.creation-indicator {
  position: absolute;
  top: 50%;
  right: -9px;
  transform: translateY(-50%);
  pointer-events: none;
}

/*
 * Keep the segmentation reset divider from stretching to the full toolbar
 * height (the flex row can be tall when the edit-types group is expanded).
 */
.segmentation-divider {
  align-self: center;
  max-height: 28px;
}
</style>
