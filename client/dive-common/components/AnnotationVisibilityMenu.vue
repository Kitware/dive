<script lang="ts">
import {
  computed,
  defineComponent,
  PropType,
  ref,
  watch,
} from 'vue';

import { VisibleAnnotationTypes } from 'vue-media-annotator/layers';
import { DEFAULT_SUPPRESSION_DISPLAY, SuppressionDisplaySettings } from 'vue-media-annotator/types';

import OutlinedLabeledGroup from './OutlinedLabeledGroup.vue';
import ToolbarExpandToggle from './ToolbarExpandToggle.vue';

interface ButtonData {
  id: string;
  icon: string;
  type?: VisibleAnnotationTypes;
  active: boolean;
  description: string;
  click: () => void;
}

export default defineComponent({
  name: 'AnnotationVisibilityMenu',
  components: {
    OutlinedLabeledGroup,
    ToolbarExpandToggle,
  },
  props: {
    visibleModes: {
      type: Array as PropType<(VisibleAnnotationTypes)[]>,
      required: true,
    },
    tailSettings: {
      type: Object as PropType<{ before: number; after: number }>,
      required: true,
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
      default: () => ({ ...DEFAULT_SUPPRESSION_DISPLAY }),
    },
  },
  emits: [
    'set-annotation-state',
    'update:tail-settings',
    'update:show-user-created-icon',
    'update:show-suppressed-tags',
    'update:suppression-display',
  ],
  setup(props, { emit }) {
    const STORAGE_KEY = 'annotationVisibilityMenu.expanded';

    // Load from localStorage or default to true
    const loadExpandedState = (): boolean => {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored !== null ? stored === 'true' : true;
    };

    const isExpanded = ref(loadExpandedState());

    // Save to localStorage when state changes
    watch(isExpanded, (value) => {
      localStorage.setItem(STORAGE_KEY, String(value));
    });

    const isVisible = (mode: VisibleAnnotationTypes) => props.visibleModes.includes(mode);

    const toggleVisible = (mode: VisibleAnnotationTypes) => {
      if (isVisible(mode)) {
        emit('set-annotation-state', {
          visible: props.visibleModes.filter((m) => m !== mode),
        });
      } else {
        emit('set-annotation-state', {
          visible: props.visibleModes.concat([mode]),
        });
      }
    };

    const toggleExpanded = () => {
      isExpanded.value = !isExpanded.value;
    };

    // Force distinct v-menu instances when toggling collapsed/expanded (Vue 2 patch reuse)
    const layoutKey = computed(() => (isExpanded.value ? 'expanded' : 'collapsed'));

    const viewButtons = computed((): ButtonData[] => (
      /* Only geometry primitives can be visible types right now */
      [
        {
          id: 'rectangle',
          type: 'rectangle',
          icon: 'mdi-vector-square',
          active: isVisible('rectangle'),
          description: 'Rectangle',
          click: () => toggleVisible('rectangle'),
        },
        {
          id: 'Polygon',
          type: 'Polygon',
          icon: 'mdi-vector-polygon',
          active: isVisible('Polygon'),
          description: 'Polygon',
          click: () => toggleVisible('Polygon'),
        },
        {
          id: 'LineString',
          type: 'LineString',
          active: isVisible('LineString'),
          icon: 'mdi-vector-line',
          description: 'Head Tail',
          click: () => toggleVisible('LineString'),
        },
        {
          id: 'text',
          type: 'text',
          active: isVisible('text'),
          icon: 'mdi-format-text',
          description: 'Text',
          click: () => toggleVisible('text'),
        },
        {
          id: 'tooltip',
          type: 'tooltip',
          active: isVisible('tooltip'),
          icon: 'mdi-tooltip-text-outline',
          description: 'Tooltip',
          click: () => toggleVisible('tooltip'),
        },
      ]));

    const primaryViewButtons = computed(
      () => viewButtons.value.filter((button) => button.id !== 'tooltip'),
    );

    const advancedVisibilityActive = computed(
      () => isVisible('tooltip')
        || isVisible('TrackTail')
        || !!props.suppressionDisplay?.enabled,
    );

    const updateTailSettings = (type: 'before' | 'after', event: Event) => {
      const value = Number.parseFloat((event.target as HTMLInputElement).value);
      const settings = { ...props.tailSettings, [type]: value };
      emit('update:tail-settings', settings);
    };

    const toggleShowUserCreatedIcon = () => {
      emit('update:show-user-created-icon', !props.showUserCreatedIcon);
    };

    const toggleShowSuppressedTags = () => {
      emit('update:show-suppressed-tags', !props.showSuppressedTags);
    };

    const patchSuppressionDisplay = (patch: Partial<SuppressionDisplaySettings>) => {
      emit('update:suppression-display', {
        ...DEFAULT_SUPPRESSION_DISPLAY,
        ...props.suppressionDisplay,
        ...patch,
      });
    };

    const toggleSuppressionDisplay = () => {
      patchSuppressionDisplay({ enabled: !props.suppressionDisplay?.enabled });
    };

    const updateSuppressionSlider = (
      key: 'outlineOpacity' | 'fillOpacity',
      event: Event,
    ) => {
      const value = Number.parseFloat((event.target as HTMLInputElement).value);
      patchSuppressionDisplay({ [key]: value });
    };

    const updateSuppressionFillColor = (event: Event) => {
      patchSuppressionDisplay({
        fillColor: (event.target as HTMLInputElement).value,
      });
    };

    return {
      isExpanded,
      layoutKey,
      viewButtons,
      primaryViewButtons,
      advancedVisibilityActive,
      isVisible,
      toggleVisible,
      toggleExpanded,
      updateTailSettings,
      toggleShowUserCreatedIcon,
      toggleShowSuppressedTags,
      toggleSuppressionDisplay,
      patchSuppressionDisplay,
      updateSuppressionSlider,
      updateSuppressionFillColor,
    };
  },
});
</script>

<template>
  <span
    class="toolbar-group-host"
    :class="{ 'toolbar-group-host--expanded': isExpanded }"
  >
    <!-- Dropdown mode when collapsed -->
    <v-menu
      v-if="!isExpanded"
      :key="`visibility-${layoutKey}`"
      offset-y
      :close-on-content-click="false"
      min-width="300"
    >
      <template #activator="{ on, attrs }">
        <v-btn
          v-bind="attrs"
          class="mx-1 mode-button toolbar-group-activator"
          small
          v-on="on"
        >
          <v-icon>mdi-eye</v-icon>
          <toolbar-expand-toggle
            :expanded="false"
            @click="toggleExpanded"
          />
        </v-btn>
      </template>
      <v-list dense>
        <v-list-item
          v-for="button in viewButtons"
          :key="`${button.id}-menu`"
          @click="button.click"
        >
          <v-list-item-icon>
            <v-btn
              :color="button.active ? 'grey darken-2' : ''"
              class="mx-1 mode-button"
              small
              @click.stop
              @click="button.click"
            >
              <v-icon>{{ button.icon }}</v-icon>
            </v-btn>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>{{ button.description }}</v-list-item-title>
            <v-checkbox
              v-if="button.id === 'text'"
              :input-value="showUserCreatedIcon"
              dense
              hide-details
              class="mt-0"
              @click.stop
              @change="toggleShowUserCreatedIcon"
            >
              <template #label>
                <span class="d-inline-flex align-center">
                  Show user created/modified
                  <v-icon
                    small
                    class="ml-1"
                  >
                    mdi-pencil
                  </v-icon>
                </span>
              </template>
            </v-checkbox>
            <v-checkbox
              v-if="button.id === 'text'"
              :input-value="showSuppressedTags"
              dense
              hide-details
              class="mt-0"
              @click.stop
              @change="toggleShowSuppressedTags"
            >
              <template #label>
                <span class="d-inline-flex align-center">
                  Show suppressed tags
                  <v-icon
                    small
                    class="ml-1"
                  >
                    mdi-eye-off
                  </v-icon>
                  <span class="ml-1 text--secondary">(labels & tooltips)</span>
                </span>
              </template>
            </v-checkbox>
          </v-list-item-content>
        </v-list-item>
        <v-list-item>
          <v-list-item-icon>
            <v-btn
              :color="isVisible('TrackTail') ? 'grey darken-2' : ''"
              class="mx-1 mode-button"
              small
              @click="toggleVisible('TrackTail')"
            >
              <v-icon>mdi-navigation</v-icon>
            </v-btn>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>Track Trails</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-list-item>
          <v-list-item-icon>
            <v-btn
              :color="suppressionDisplay.enabled ? 'grey darken-2' : ''"
              class="mx-1 mode-button"
              small
              @click="toggleSuppressionDisplay"
            >
              <v-icon>mdi-eye-off</v-icon>
            </v-btn>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>Suppression</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-divider />
        <v-list-item v-if="isVisible('TrackTail')">
          <v-list-item-content>
            <v-card
              class="pa-4 flex-column d-flex"
              outlined
              flat
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
                @input="updateTailSettings('before', $event)"
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
                @input="updateTailSettings('after', $event)"
              >
            </v-card>
          </v-list-item-content>
        </v-list-item>
        <v-list-item v-if="suppressionDisplay.enabled">
          <v-list-item-content>
            <v-card
              class="pa-4 flex-column d-flex"
              outlined
              flat
            >
              <v-checkbox
                :input-value="suppressionDisplay.dashed"
                label="Dashed outline"
                dense
                hide-details
                class="mt-0"
                @click.stop
                @change="patchSuppressionDisplay({ dashed: !suppressionDisplay.dashed })"
              />
              <label
                for="suppression-outline-opacity"
                class="mt-3"
              >
                Outline opacity: {{ Math.round(suppressionDisplay.outlineOpacity * 100) }}%
              </label>
              <input
                id="suppression-outline-opacity"
                type="range"
                class="tail-slider-width"
                min="0"
                max="1"
                step="0.05"
                :value="suppressionDisplay.outlineOpacity"
                @input="updateSuppressionSlider('outlineOpacity', $event)"
              >
              <div class="d-flex align-center mt-3">
                <label for="suppression-fill-color">Fill color</label>
                <input
                  id="suppression-fill-color"
                  type="color"
                  class="ml-2 suppression-color-input"
                  :value="suppressionDisplay.fillColor || '#888888'"
                  :title="suppressionDisplay.fillColor || '#888888'"
                  @input="updateSuppressionFillColor"
                >
              </div>
              <label
                for="suppression-fill-opacity"
                class="mt-3"
              >
                Fill opacity: {{ Math.round(suppressionDisplay.fillOpacity * 100) }}%
              </label>
              <input
                id="suppression-fill-opacity"
                type="range"
                class="tail-slider-width"
                min="0"
                max="1"
                step="0.05"
                :value="suppressionDisplay.fillOpacity"
                @input="updateSuppressionSlider('fillOpacity', $event)"
              >
            </v-card>
          </v-list-item-content>
        </v-list-item>
      </v-list>
    </v-menu>

    <!-- Full button mode when expanded -->
    <outlined-labeled-group
      v-else
      :key="`visibility-${layoutKey}`"
    >
      <template #legend>
        <span class="d-inline-flex align-center">
          <v-icon
            small
            class="pr-1"
          >
            mdi-eye
          </v-icon>
          <span>Visibility</span>
          <toolbar-expand-toggle
            :expanded="true"
            @click="toggleExpanded"
          />
        </span>
      </template>
      <template
        v-for="button in primaryViewButtons"
      >
        <v-menu
          v-if="button.id === 'text'"
          :key="`${button.id}-view`"
          open-on-hover
          bottom
          offset-y
          :close-on-content-click="false"
        >
          <template #activator="{ on, attrs }">
            <v-btn
              v-bind="attrs"
              :color="button.active ? 'grey darken-2' : ''"
              class="mx-1 mode-button"
              small
              v-on="on"
              @click="button.click"
            >
              <v-icon>{{ button.icon }}</v-icon>
            </v-btn>
          </template>
          <v-card
            class="pa-4 flex-column d-flex"
            outlined
          >
            <v-checkbox
              :input-value="showUserCreatedIcon"
              dense
              hide-details
              @change="toggleShowUserCreatedIcon"
            >
              <template #label>
                <span class="d-inline-flex align-center">
                  Show user created/modified
                  <v-icon
                    small
                    class="ml-1"
                  >
                    mdi-pencil
                  </v-icon>
                </span>
              </template>
            </v-checkbox>
            <v-checkbox
              :input-value="showSuppressedTags"
              dense
              hide-details
              class="mt-2"
              @change="toggleShowSuppressedTags"
            >
              <template #label>
                <span class="d-inline-flex align-center">
                  Show suppressed tags
                  <v-icon
                    small
                    class="ml-1"
                  >
                    mdi-eye-off
                  </v-icon>
                  <span class="ml-1 text--secondary">(labels & tooltips)</span>
                </span>
              </template>
            </v-checkbox>
          </v-card>
        </v-menu>
        <v-btn
          v-else
          :key="`${button.id}-view-button`"
          :color="button.active ? 'grey darken-2' : ''"
          class="mx-1 mode-button"
          small
          @click="button.click"
        >
          <v-icon>{{ button.icon }}</v-icon>
        </v-btn>
      </template>
      <v-menu
        key="visibility-advanced"
        offset-y
        :close-on-content-click="false"
        min-width="280"
      >
        <template #activator="{ on: menuOn, attrs: menuAttrs }">
          <v-tooltip bottom>
            <template #activator="{ on: tooltipOn, attrs: tooltipAttrs }">
              <v-btn
                v-bind="{ ...menuAttrs, ...tooltipAttrs }"
                :color="advancedVisibilityActive ? 'grey darken-2' : ''"
                class="mx-1 mode-button"
                small
                v-on="{ ...menuOn, ...tooltipOn }"
              >
                <v-icon>mdi-tune</v-icon>
              </v-btn>
            </template>
            <span>Advanced settings</span>
          </v-tooltip>
        </template>
        <v-card
          class="pa-3 flex-column d-flex"
          outlined
        >
          <div class="d-flex align-center advanced-menu-row">
            <v-btn
              :color="isVisible('tooltip') ? 'grey darken-2' : ''"
              class="mode-button"
              small
              @click="toggleVisible('tooltip')"
            >
              <v-icon>mdi-tooltip-text-outline</v-icon>
            </v-btn>
            <span class="ml-2">Tooltip</span>
          </div>
          <div class="d-flex align-center advanced-menu-row">
            <v-btn
              :color="isVisible('TrackTail') ? 'grey darken-2' : ''"
              class="mode-button"
              small
              @click="toggleVisible('TrackTail')"
            >
              <v-icon>mdi-navigation</v-icon>
            </v-btn>
            <span class="ml-2">Track Trails</span>
          </div>
          <template v-if="isVisible('TrackTail')">
            <v-divider class="my-2" />
            <label for="frames-before-full">Frames before: {{ tailSettings.before }}</label>
            <input
              id="frames-before-full"
              type="range"
              name="frames-before-full"
              class="tail-slider-width"
              min="0"
              max="100"
              :value="tailSettings.before"
              @input="updateTailSettings('before', $event)"
            >
            <div class="py-2" />
            <label for="frames-after-full">Frames after: {{ tailSettings.after }}</label>
            <input
              id="frames-after-full"
              type="range"
              name="frames-after-full"
              class="tail-slider-width"
              min="0"
              max="100"
              :value="tailSettings.after"
              @input="updateTailSettings('after', $event)"
            >
          </template>
          <div class="d-flex align-center advanced-menu-row">
            <v-btn
              :color="suppressionDisplay.enabled ? 'grey darken-2' : ''"
              class="mode-button"
              small
              @click="toggleSuppressionDisplay"
            >
              <v-icon>mdi-eye-off</v-icon>
            </v-btn>
            <span class="ml-2">Suppression</span>
            <v-tooltip
              open-delay="200"
              bottom
              max-width="280"
            >
              <template #activator="{ on }">
                <v-icon
                  small
                  class="ml-1"
                  v-on="on"
                >
                  mdi-help
                </v-icon>
              </template>
              <span>
                Detections flagged with a suppression attribute stay visible
                with their real type. When enabled, they can be drawn with a
                dashed outline, custom fill, and opacity so they are easy to
                distinguish from normal detections.
              </span>
            </v-tooltip>
          </div>
          <template v-if="suppressionDisplay.enabled">
            <v-divider class="my-2" />
            <v-checkbox
              :input-value="suppressionDisplay.dashed"
              label="Dashed outline"
              dense
              hide-details
              class="mt-0"
              @change="patchSuppressionDisplay({ dashed: !suppressionDisplay.dashed })"
            />
            <label
              for="suppression-outline-opacity-full"
              class="mt-3"
            >
              Outline opacity: {{ Math.round(suppressionDisplay.outlineOpacity * 100) }}%
            </label>
            <input
              id="suppression-outline-opacity-full"
              type="range"
              class="tail-slider-width"
              min="0"
              max="1"
              step="0.05"
              :value="suppressionDisplay.outlineOpacity"
              @input="updateSuppressionSlider('outlineOpacity', $event)"
            >
            <div class="d-flex align-center mt-3">
              <label for="suppression-fill-color-full">Fill color</label>
              <input
                id="suppression-fill-color-full"
                type="color"
                class="ml-2 suppression-color-input"
                :value="suppressionDisplay.fillColor || '#888888'"
                :title="suppressionDisplay.fillColor || '#888888'"
                @input="updateSuppressionFillColor"
              >
            </div>
            <label
              for="suppression-fill-opacity-full"
              class="mt-3"
            >
              Fill opacity: {{ Math.round(suppressionDisplay.fillOpacity * 100) }}%
            </label>
            <input
              id="suppression-fill-opacity-full"
              type="range"
              class="tail-slider-width"
              min="0"
              max="1"
              step="0.05"
              :value="suppressionDisplay.fillOpacity"
              @input="updateSuppressionSlider('fillOpacity', $event)"
            >
          </template>
        </v-card>
      </v-menu>
    </outlined-labeled-group>
  </span>
</template>

<style scoped lang="scss">
@import './toolbarGroup.scss';

.mode-button {
  border: 1px solid grey;
  min-width: 36px;
}
.tail-slider-width {
  width: 240px;
}
.advanced-menu-row + .advanced-menu-row {
  margin-top: 8px;
}
.suppression-color-input {
  width: 36px;
  height: 24px;
  padding: 0;
  border: 1px solid grey;
  background: transparent;
  cursor: pointer;
}
</style>
