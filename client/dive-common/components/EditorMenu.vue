<script lang="ts">
import { flatten } from 'lodash';
import Vue, { PropType } from 'vue';

import { Mousetrap } from 'vue-media-annotator/types';
import { EditAnnotationTypes, VisibleAnnotationTypes } from 'vue-media-annotator/layers';
import Recipe from 'vue-media-annotator/recipe';
import SegmentationPointClick from 'dive-common/recipes/segmentationpointclick';

interface ButtonData {
  id: string;
  icon: string;
  type?: VisibleAnnotationTypes;
  active: boolean;
  loading?: boolean;
  mousetrap?: Mousetrap[];
  click: () => void;
}

export default Vue.extend({
  name: 'EditorMenu',
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
    tailSettings: {
      type: Object as PropType<{ before: number; after: number }>,
      default: () => ({ before: 20, after: 10 }),
    },
  },
  data() {
    return {
      toolTipForce: false,
      toolTimeTimeout: 0,
      modeToolTips: {
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
      },
      // Text query state
      textQueryDialogOpen: false,
      textQueryInput: '',
      textQueryLoading: false,
      textQueryThreshold: 0.3,
      textQueryInitializing: false,
      textQueryServiceError: '',
      textQueryAllFrames: false,
    };
  },
  computed: {
    editButtons(): ButtonData[] {
      const em = this.editingMode;
      return [
        {
          id: 'rectangle',
          icon: 'mdi-vector-square',
          active: this.editingTrack && em === 'rectangle',
          mousetrap: [{
            bind: '1',
            handler: () => {
              this.$emit('set-annotation-state', { editing: 'rectangle' });
            },
          }],
          click: () => {
            this.$emit('set-annotation-state', { editing: 'rectangle' });
          },
        },
        /* Include recipes as editing modes if they're toggleable */
        ...this.recipes.filter((r) => r.toggleable.value).map((r, i) => ({
          id: r.name,
          icon: r.icon.value || 'mdi-pencil',
          active: this.editingTrack && r.active.value,
          loading: r.loading?.value ?? false,
          click: () => r.activate(),
          mousetrap: [
            {
              bind: (i + 2).toString(),
              handler: () => r.activate(),
            },
            ...r.mousetrap(),
          ],
        })),
      ];
    },
    viewButtons(): ButtonData[] {
      /* Only geometry primitives can be visible types right now */
      return [
        {
          id: 'rectangle',
          type: 'rectangle',
          icon: 'mdi-vector-square',
          active: this.isVisible('rectangle'),
          click: () => this.toggleVisible('rectangle'),
        },
        {
          id: 'Polygon',
          type: 'Polygon',
          icon: 'mdi-vector-polygon',
          active: this.isVisible('Polygon'),
          click: () => this.toggleVisible('Polygon'),
        },
        {
          id: 'LineString',
          type: 'LineString',
          active: this.isVisible('LineString'),
          icon: 'mdi-vector-line',
          click: () => this.toggleVisible('LineString'),
        },
        {
          id: 'text',
          type: 'text',
          active: this.isVisible('text'),
          icon: 'mdi-format-text',
          click: () => this.toggleVisible('text'),
        },
        {
          id: 'tooltip',
          type: 'tooltip',
          active: this.isVisible('tooltip'),
          icon: 'mdi-tooltip-text-outline',
          click: () => this.toggleVisible('tooltip'),
        },
      ];
    },
    mousetrap(): Mousetrap[] {
      return [
        ...flatten(this.editButtons.map((b) => b.mousetrap || [])),
        {
          bind: 't',
          handler: () => this.openTextQueryDialog(),
        },
      ];
    },
    /**
     * Get the active segmentation recipe if one exists and is active
     */
    activeSegmentationRecipe(): SegmentationPointClick | null {
      const segRecipe = this.recipes.find(
        (r) => r instanceof SegmentationPointClick && r.active.value,
      ) as SegmentationPointClick | undefined;
      return segRecipe || null;
    },
    editingHeader() {
      if (this.groupEditActive) {
        return { text: 'Group Edit Mode', icon: 'mdi-group', color: 'primary' };
      }
      if (this.multiSelectActive) {
        return { text: 'Multi-select Mode', icon: 'mdi-call-merge', color: 'error' };
      }
      if (this.editingDetails !== 'disabled') {
        return {
          text: `${this.editingDetails} ${this.editingMode} `,
          icon: this.editingDetails === 'Creating' ? 'mdi-pencil-plus' : 'mdi-pencil',
          color: this.editingDetails === 'Creating' ? 'success' : 'primary',
        };
      }
      return { text: 'Not editing', icon: 'mdi-pencil-off-outline', color: '' };
    },
  },
  watch: {
    editingDetails() {
      clearTimeout(this.toolTimeTimeout);
      if (this.editingDetails !== 'disabled') {
        this.toolTipForce = true;
        this.toolTimeTimeout = setTimeout(() => { this.toolTipForce = false; }, 2000) as unknown as number;
      } else {
        this.toolTipForce = false;
      }
    },
  },
  methods: {
    isVisible(mode: VisibleAnnotationTypes) {
      return this.visibleModes.includes(mode);
    },

    toggleVisible(mode: VisibleAnnotationTypes) {
      if (this.isVisible(mode)) {
        this.$emit('set-annotation-state', {
          visible: this.visibleModes.filter((m) => m !== mode),
        });
      } else {
        this.$emit('set-annotation-state', {
          visible: this.visibleModes.concat([mode]),
        });
      }
    },

    openTextQueryDialog() {
      this.textQueryDialogOpen = true;
      this.textQueryInput = '';
      this.textQueryServiceError = '';
      this.textQueryAllFrames = false;
      this.textQueryInitializing = true;
      // Emit event to initialize the text query service
      this.$emit('text-query-init');
    },

    closeTextQueryDialog() {
      this.textQueryDialogOpen = false;
      this.textQueryInput = '';
      this.textQueryServiceError = '';
      this.textQueryInitializing = false;
      this.textQueryAllFrames = false;
    },

    /**
     * Called by parent when text query service initialization completes
     */
    onTextQueryServiceReady(success: boolean, error?: string) {
      this.textQueryInitializing = false;
      if (!success) {
        this.textQueryServiceError = error || 'Text query service is not available';
      }
    },

    async submitTextQuery() {
      if (!this.textQueryInput.trim()) {
        return;
      }

      this.textQueryLoading = true;

      if (this.textQueryAllFrames) {
        // Emit event to run text query pipeline on all frames
        this.$emit('text-query-all-frames', {
          text: this.textQueryInput.trim(),
          boxThreshold: this.textQueryThreshold,
        });
      } else {
        // Emit event to parent to handle text query on current frame
        this.$emit('text-query', {
          text: this.textQueryInput.trim(),
          boxThreshold: this.textQueryThreshold,
        });
      }

      this.closeTextQueryDialog();
      this.textQueryLoading = false;
    },
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
            <span v-if="groupEditActive">
              Editing group.  Add or remove tracks.  Esc. to exit.
            </span>
            <span v-else-if="multiSelectActive">
              Multi-select in progress.  Editing is disabled.
              Select additional tracks to merge or group.
            </span>
            <span v-else-if="editingDetails !== 'disabled'">
              {{ modeToolTips[editingDetails][editingMode] }}
            </span>
            <span v-else>Right click on an annotation to edit</span>
          </div>
        </div>
      </div>
      <v-btn
        v-for="button in editButtons"
        :key="button.id + 'view'"
        :disabled="!editingMode || button.loading"
        :outlined="!button.active"
        :color="button.active ? editingHeader.color : ''"
        class="mx-1"
        small
        @click="button.click"
      >
        <pre v-if="button.mousetrap">{{ button.mousetrap[0].bind }}:</pre>
        <v-icon :class="{ 'mdi-spin': button.loading }">
          {{ button.icon }}
        </v-icon>
      </v-btn>
      <!-- Text Query button -->
      <v-btn
        outlined
        class="mx-1"
        small
        @click="openTextQueryDialog"
      >
        <pre>T:</pre>
        <v-icon>mdi-text-search</v-icon>
      </v-btn>
      <!-- Segmentation Confirm/Reset buttons -->
      <template v-if="activeSegmentationRecipe">
        <v-divider
          vertical
          class="mx-2"
        />
        <v-btn
          color="success"
          class="mx-1"
          small
          :disabled="!activeSegmentationRecipe.hasPendingPrediction()"
          @click="activeSegmentationRecipe.confirmPrediction()"
        >
          <v-icon left>
            mdi-check
          </v-icon>
          Confirm
        </v-btn>
        <v-btn
          color="error"
          class="mx-1"
          small
          :disabled="!activeSegmentationRecipe.hasPoints()"
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
      <span class="pb-1">
        <span class="mr-1 px-3 py-1">
          <v-icon class="pr-1">
            mdi-eye
          </v-icon>
          <span class="text-subtitle-2">
            Visibility
          </span>
        </span>
        <v-btn
          v-for="button in viewButtons"
          :key="button.id"
          :color="button.active ? 'grey darken-2' : ''"
          class="mx-1 mode-button"
          small
          @click="button.click"
        >
          <v-icon>{{ button.icon }}</v-icon>
        </v-btn>
        <v-menu
          open-on-hover
          bottom
          offset-y
          :close-on-content-click="false"
        >
          <template #activator="{ on, attrs }">
            <v-btn
              v-bind="attrs"
              :color="isVisible('TrackTail') ? 'grey darken-2' : ''"
              class="mx-1 mode-button"
              small
              v-on="on"
              @click="toggleVisible('TrackTail')"
            >
              <v-icon>mdi-navigation</v-icon>
            </v-btn>
          </template>
          <v-card
            class="pa-4 flex-column d-flex"
            outlined
          >
            <label for="frames-before">Frames before: {{ tailSettings.before }}</label>
            <input
              id="frames-before"
              type="range"
              name="frames-before"
              class="tail-slider-width"
              label
              min="0"
              max="100"
              :value="tailSettings.before"
              @input="$emit('update:tail-settings', { ...tailSettings, before: Number.parseFloat($event.target.value) })"
            >
            <div class="py-2" />
            <label for="frames-after">Frames after: {{ tailSettings.after }}</label>
            <input
              id="frames-after"
              type="range"
              name="frames-after"
              class="tail-slider-width"
              min="0"
              max="100"
              :value="tailSettings.after"
              @input="$emit('update:tail-settings', { ...tailSettings, after: Number.parseFloat($event.target.value) })"
            >
          </v-card>
        </v-menu>
      </span>
    </div>

    <!-- Text Query Dialog -->
    <v-dialog
      v-model="textQueryDialogOpen"
      max-width="500"
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
          </template>
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
  </v-row>
</template>

<style scoped>
.modechip {
  border-radius: 16px;
  white-space: nowrap;
  border: 1px solid;
  cursor: default;
}
.mode-group {
  border: 1px solid grey;
  border-radius: 4px;
}
.mode-button{
  border: 1px solid grey;
}
.tail-slider-width {
  width: 240px;
}
</style>
