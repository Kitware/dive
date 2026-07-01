<script lang="ts">
import {
  computed,
  defineComponent,
  PropType,
  ref,
  watch,
} from 'vue';
import { flatten } from 'lodash';

import { Mousetrap } from 'vue-media-annotator/types';
import { EditAnnotationTypes, VisibleAnnotationTypes } from 'vue-media-annotator/layers';
import Recipe from 'vue-media-annotator/recipe';
import SegmentationPointClick from 'dive-common/recipes/segmentationpointclick';

import AnnotationVisibilityMenu from './AnnotationVisibilityMenu.vue';
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

const SAM3_ADDON_WIKI_URL = 'https://github.com/VIAME/VIAME/wiki/Model-Zoo-and-Add-Ons';

export default defineComponent({
  name: 'EditorMenu',
  components: {
    AnnotationVisibilityMenu,
    OutlinedLabeledGroup,
    ToolbarExpandToggle,
  },
  props: {
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
    textQueryEnabled: {
      type: Boolean,
      default: false,
    },
    textQueryAvailable: {
      type: Boolean,
      default: false,
    },
  },
  emits: [
    'set-annotation-state',
    'update:tail-settings',
    'update:show-user-created-icon',
    'text-query-init',
    'text-query',
    'text-query-all-frames',
    'open-external-link',
  ],
  setup(props, { emit }) {
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
    const sam3InfoDialogOpen = ref(false);

    const openSam3InfoDialog = () => {
      sam3InfoDialogOpen.value = true;
    };

    const closeSam3InfoDialog = () => {
      sam3InfoDialogOpen.value = false;
    };

    const openSam3AddonWiki = () => {
      emit('open-external-link', SAM3_ADDON_WIKI_URL);
    };

    const handleTextQueryClick = () => {
      if (!props.textQueryAvailable) {
        openSam3InfoDialog();
        return;
      }
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

    const onTextQueryServiceReady = (success: boolean, error?: string) => {
      textQueryInitializing.value = false;
      if (!success) {
        textQueryServiceError.value = error || 'Text query service is not available';
      }
    };

    const submitTextQuery = () => {
      if (!textQueryInput.value.trim()) {
        return;
      }
      textQueryLoading.value = true;
      if (textQueryAllFrames.value) {
        emit('text-query-all-frames', {
          text: textQueryInput.value.trim(),
          boxThreshold: textQueryThreshold.value,
          replaceExisting: textQueryReplaceExisting.value,
        });
      } else {
        emit('text-query', {
          text: textQueryInput.value.trim(),
          boxThreshold: textQueryThreshold.value,
          replaceExisting: textQueryReplaceExisting.value,
        });
      }
      closeTextQueryDialog();
      textQueryLoading.value = false;
    };

    const modeToolTips = {
      Creating: {
        rectangle: 'Drag to draw rectangle. Press ESC to exit.',
        Polygon: 'Click to place vertices. Right click to close.',
        LineString: 'Click to place head/tail points.',
      },
      Editing: {
        rectangle: 'Drag vertices to resize the rectangle',
        Polygon: 'Drag midpoints to create new vertices. Click vertices to select for deletion.',
        LineString: 'Click endpoints to select for deletion.',
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
              emit('set-annotation-state', { editing: 'rectangle' });
            },
          }],
          click: () => {
            emit('set-annotation-state', { editing: 'rectangle' });
          },
        },
        /* Include recipes as editing modes if they're toggleable */
        ...props.recipes.filter((r) => r.toggleable.value).map((r, i) => ({
          id: r.name,
          icon: r.icon.value || 'mdi-pencil',
          active: props.editingTrack && r.active.value,
          loading: (r.loading?.value ?? false)
            || (r instanceof SegmentationPointClick && r.predicting.value),
          description: r.name,
          click: () => r.activate(),
          mousetrap: [
            {
              bind: (i + 2).toString(),
              handler: () => r.activate(),
            },
            ...r.mousetrap(),
          ],
        })),
        /* Text Query button included alongside other annotation types (desktop only) */
        ...(props.textQueryEnabled ? [{
          id: 'Text Query',
          icon: 'mdi-text-search',
          active: false,
          unavailable: !props.textQueryAvailable,
          unavailableTooltip: 'SAM3 add-on not installed. Click for more information.',
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

    const segmentationTooltip = 'Left click to add positive points. Middle click or Shift+click for negative points. Right click or Enter to confirm. Escape to cancel.';

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
      segmentationTooltip,
      // Text query
      textQueryDialogOpen,
      textQueryInput,
      textQueryLoading,
      textQueryThreshold,
      textQueryInitializing,
      textQueryServiceError,
      textQueryAllFrames,
      textQueryReplaceExisting,
      openTextQueryDialog,
      closeTextQueryDialog,
      onTextQueryServiceReady,
      submitTextQuery,
      sam3InfoDialogOpen,
      closeSam3InfoDialog,
      openSam3AddonWiki,
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
            style="line-height: 1.22em; font-size: 10px;"
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
            <span v-else-if="segmentationLoading">
              Loading segmentation model...
            </span>
            <span v-else-if="segmentationPredicting">
              Computing segmentation...
            </span>
            <span v-else-if="activeSegmentationRecipe">
              {{ segmentationTooltip }}
            </span>
            <span v-else-if="editingDetails !== 'disabled' && editingMode && typeof editingMode === 'string'">
              {{ editingTooltip }}
            </span>
            <span v-else>Right click on an annotation to edit</span>
          </div>
        </div>
      </div>
      <!-- Collapsed mode for edit buttons -->
      <span class="toolbar-group-host">
        <v-menu
          v-if="!isEditButtonsExpanded"
          :key="editButtonsMenuKey"
          offset-y
          :close-on-content-click="false"
        >
          <template #activator="{ on, attrs }">
            <v-btn
              v-bind="attrs"
              :disabled="!editingMode || activeEditButton?.loading"
              :color="activeEditButton?.active ? editingHeader.color : ''"
              class="mx-1 mode-button toolbar-group-activator"
              small
              v-on="on"
            >
              <pre v-if="activeEditButton?.mousetrap">{{ activeEditButton.mousetrap[0].bind }}:</pre>
              <v-icon :class="{ 'mdi-spin': activeEditButton?.loading }">
                {{ activeEditButton?.icon }}
              </v-icon>
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
                        :disabled="button.unavailable ? !!button.loading : (!editingMode || !!button.loading)"
                        :outlined="!button.active"
                        :color="button.active ? editingHeader.color : ''"
                        :class="{ 'edit-btn-unavailable': button.unavailable && !button.loading }"
                        class="mx-1"
                        small
                        @click="button.click"
                      >
                        <pre v-if="button.mousetrap">{{ button.mousetrap[0].bind }}:</pre>
                        <v-icon :class="{ 'mdi-spin': button.loading }">
                          {{ button.icon }}
                        </v-icon>
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
              <span>Edit Types</span>
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
                v-on="button.unavailable ? tooltipOn : {}"
                class="d-inline-block"
              >
                <v-btn
                  :disabled="button.unavailable ? !!button.loading : (!editingMode || !!button.loading)"
                  :outlined="!button.active"
                  :color="button.active ? editingHeader.color : ''"
                  :class="{ 'edit-btn-unavailable': button.unavailable && !button.loading }"
                  class="mx-1"
                  small
                  @click="button.click"
                >
                  <pre v-if="button.mousetrap">{{ button.mousetrap[0].bind }}:</pre>
                  <v-icon :class="{ 'mdi-spin': button.loading }">
                    {{ button.icon }}
                  </v-icon>
                </v-btn>
              </span>
            </template>
            <span>{{ button.unavailableTooltip }}</span>
          </v-tooltip>
        </outlined-labeled-group>
      </span>
      <!-- Segmentation Reset button -->
      <template v-if="activeSegmentationRecipe && editingMode === 'Point'">
        <v-divider
          vertical
          class="mx-2"
        />
        <v-btn
          color="error"
          class="mx-1"
          small
          :disabled="!activeSegmentationRecipe.hasPoints() || segmentationPredicting"
          @click="activeSegmentationRecipe.resetPoints()"
        >
          <v-icon left>
            mdi-close
          </v-icon>
          Reset
        </v-btn>
      </template>
      <!-- Hide delete controls when in segmentation mode -->
      <slot
        v-if="!activeSegmentationRecipe"
        name="delete-controls"
      />
      <slot name="multicam-controls-left" />
      <v-spacer />
      <slot name="multicam-controls-right" />
      <v-spacer />
      <annotation-visibility-menu
        :visible-modes="visibleModes"
        :tail-settings="tailSettings"
        :show-user-created-icon="showUserCreatedIcon"
        @set-annotation-state="$emit('set-annotation-state', $event)"
        @update:tail-settings="$emit('update:tail-settings', $event)"
        @update:show-user-created-icon="$emit('update:show-user-created-icon', $event)"
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
              v-model="textQueryThreshold"
              label="Confidence threshold"
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
          <p class="text-caption mt-3 mb-0 text--secondary">
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
            :disabled="!textQueryInput.trim() || textQueryLoading"
            @click="submitTextQuery"
          >
            Search
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- SAM3 Add-On Info Dialog -->
    <v-dialog
      v-if="textQueryEnabled"
      v-model="sam3InfoDialogOpen"
      max-width="500"
    >
      <v-card>
        <v-card-title class="text-h6">
          <v-icon left>
            mdi-package-down
          </v-icon>
          SAM3 Add-On Required
        </v-card-title>
        <v-card-text>
          <p class="text-body-2 mb-3">
            Text query requires the SAM3 Text Query Segmentation and Tracking Models
            add-on to be installed in your VIAME directory.
          </p>
          <p class="text-body-2 mb-0">
            You can download the add-on from the
            <span
              class="sam3-wiki-link"
              @click="openSam3AddonWiki"
            >
              VIAME Model Zoo and Add-Ons
            </span>
            page. Extract the package and merge its folders into your existing VIAME
            installation.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            text
            @click="closeSam3InfoDialog"
          >
            Close
          </v-btn>
          <v-btn
            color="primary"
            @click="openSam3AddonWiki"
          >
            Open Model Zoo
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

.sam3-wiki-link {
  color: var(--v-primary-base);
  cursor: pointer;
  text-decoration: underline;
}

.mode-button{
  border: 1px solid grey;
  min-width: 36px;
}
</style>
