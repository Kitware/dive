<script lang="ts">
import {
  computed,
  defineComponent,
  PropType,
  ref,
  watch,
} from 'vue';

import { VisibleAnnotationTypes } from 'vue-media-annotator/layers';

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
  },
  emits: ['set-annotation-state', 'update:tail-settings', 'update:show-user-created-icon'],
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

    const updateTailSettings = (type: 'before' | 'after', event: Event) => {
      const value = Number.parseFloat((event.target as HTMLInputElement).value);
      const settings = { ...props.tailSettings, [type]: value };
      emit('update:tail-settings', settings);
    };

    const toggleShowUserCreatedIcon = () => {
      emit('update:show-user-created-icon', !props.showUserCreatedIcon);
    };

    return {
      isExpanded,
      viewButtons,
      isVisible,
      toggleVisible,
      toggleExpanded,
      updateTailSettings,
      toggleShowUserCreatedIcon,
    };
  },
});
</script>

<template>
  <span class="pb-1">
    <!-- Dropdown mode when collapsed -->
    <v-menu
      v-if="!isExpanded"
      offset-y
      :close-on-content-click="false"
      min-width="300"
    >
      <template #activator="{ on, attrs }">
        <v-btn
          v-bind="attrs"
          class="mx-1 mode-button"
          small
          v-on="on"
        >
          <v-icon>mdi-eye</v-icon>
          <v-btn
            icon
            x-small
            class="ml-1 expand-toggle"
            @click.stop="toggleExpanded"
          >
            <v-icon small>mdi-chevron-right</v-icon>
          </v-btn>
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
              label="Show user created icon"
              dense
              hide-details
              class="mt-0"
              @click.stop
              @change="toggleShowUserCreatedIcon"
            />
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
      </v-list>
    </v-menu>

    <!-- Full button mode when expanded -->
    <template v-else>
      <span class="mr-1 px-3 py-1">
        <v-icon class="pr-1">
          mdi-eye
        </v-icon>
        <span class="text-subtitle-2">
          Visibility
        </span>
        <v-btn
          icon
          x-small
          class="ml-1 expand-toggle"
          @click="toggleExpanded"
        >
          <v-icon small>mdi-chevron-left</v-icon>
        </v-btn>
      </span>
      <template
        v-for="button in viewButtons"
      >
        <v-menu
          v-if="button.id === 'text'"
          open-on-hover
          bottom
          offset-y
          :close-on-content-click="false"
          :key="`${button.id}-view`"
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
              label="Show user created icon"
              dense
              hide-details
              @change="toggleShowUserCreatedIcon"
            />
          </v-card>
        </v-menu>
        <v-btn
          v-else
          :color="button.active ? 'grey darken-2' : ''"
          :key="`${button.id}-view-button`"
          class="mx-1 mode-button"
          small
          @click="button.click"
        >
          <v-icon>{{ button.icon }}</v-icon>
        </v-btn>
      </template>
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
          <label for="frames-before-full">Frames before: {{ tailSettings.before }}</label>
          <input
            id="frames-before-full"
            type="range"
            name="frames-before-full"
            class="tail-slider-width"
            label
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
        </v-card>
      </v-menu>
    </template>
  </span>
</template>

<style scoped>
.mode-button {
  border: 1px solid grey;
  min-width: 36px;
}
.tail-slider-width {
  width: 240px;
}
.expand-toggle {
  opacity: 0.5;
  transition: opacity 0.2s;
}
.expand-toggle:hover {
  opacity: 1;
}
</style>
