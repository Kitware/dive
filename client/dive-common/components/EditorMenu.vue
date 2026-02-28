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

import AnnotationVisibilityMenu from './AnnotationVisibilityMenu.vue';

interface ButtonData {
  id: string;
  icon: string;
  type?: VisibleAnnotationTypes;
  active: boolean;
  mousetrap?: Mousetrap[];
  description: string;
  click: () => void;
}

export default defineComponent({
  name: 'EditorMenu',
  components: {
    AnnotationVisibilityMenu,
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
    tailSettings: {
      type: Object as PropType<{ before: number; after: number }>,
      default: () => ({ before: 20, after: 10 }),
    },
    showUserCreatedIcon: {
      type: Boolean,
      default: true,
    },
  },
  emits: ['set-annotation-state', 'update:tail-settings', 'update:show-user-created-icon'],
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
      ];
    });

    const mousetrap = computed((): Mousetrap[] => flatten(editButtons.value.map((b) => b.mousetrap || [])));

    const activeEditButton = computed(() => editButtons.value.find((b) => b.active) || editButtons.value[0]);

    const toggleEditButtonsExpanded = () => {
      isEditButtonsExpanded.value = !isEditButtonsExpanded.value;
    };

    const editButtonsMenuKey = computed(() => `${props.editingMode}-${editButtons.value.length}-${activeEditButton.value?.id || ''}`);

    const editingHeader = computed(() => {
      if (props.groupEditActive) {
        return { text: 'Group Edit Mode', icon: 'mdi-group', color: 'primary' };
      }
      if (props.multiSelectActive) {
        return { text: 'Multi-select Mode', icon: 'mdi-call-merge', color: 'error' };
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
            <span v-if="groupEditActive">
              Editing group.  Add or remove tracks.  Esc. to exit.
            </span>
            <span v-else-if="multiSelectActive">
              Multi-select in progress.  Editing is disabled.
              Select additional tracks to merge or group.
            </span>
            <span v-else-if="editingDetails !== 'disabled' && editingMode && typeof editingMode === 'string'">
              {{ editingTooltip }}
            </span>
            <span v-else>Right click on an annotation to edit</span>
          </div>
        </div>
      </div>
      <!-- Collapsed mode for edit buttons -->
      <v-menu
        v-if="!isEditButtonsExpanded"
        :key="editButtonsMenuKey"
        offset-y
        :close-on-content-click="false"
      >
        <template #activator="{ on, attrs }">
          <v-btn
            v-bind="attrs"
            :disabled="!editingMode"
            :outlined="!activeEditButton?.active"
            :color="activeEditButton?.active ? editingHeader.color : ''"
            class="mx-1"
            small
            v-on="on"
          >
            <pre v-if="activeEditButton?.mousetrap">{{ activeEditButton.mousetrap[0].bind }}:</pre>
            <v-icon>{{ activeEditButton?.icon }}</v-icon>
            <v-btn
              icon
              x-small
              class="ml-1 expand-toggle"
              @click.stop="toggleEditButtonsExpanded"
            >
              <v-icon small>
                mdi-chevron-right
              </v-icon>
            </v-btn>
          </v-btn>
        </template>
        <v-list dense>
          <v-list-item
            v-for="button in editButtons"
            :key="`${button.id}-menu`"
          >
            <v-list-item-icon>
              <v-btn
                :disabled="!editingMode"
                :outlined="!button.active"
                :color="button.active ? editingHeader.color : ''"
                class="mx-1"
                small
                @click="button.click"
              >
                <pre v-if="button.mousetrap">{{ button.mousetrap[0].bind }}:</pre>
                <v-icon>{{ button.icon }}</v-icon>
              </v-btn>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>{{ button.id }}</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
        </v-list>
      </v-menu>

      <!-- Expanded mode for edit buttons -->
      <template v-else>
        <span class="mr-1 px-3 py-1">
          <v-icon class="pr-1">
            mdi-pencil
          </v-icon>
          <span class="text-subtitle-2">
            Edit Types
          </span>
          <v-btn
            icon
            x-small
            class="ml-1 expand-toggle"
            @click="toggleEditButtonsExpanded"
          >
            <v-icon small>mdi-chevron-left</v-icon>
          </v-btn>
        </span>
        <v-btn
          v-for="button in editButtons"
          :key="button.id + 'view'"
          :disabled="!editingMode"
          :outlined="!button.active"
          :color="button.active ? editingHeader.color : ''"
          class="mx-1"
          small
          @click="button.click"
        >
          <pre v-if="button.mousetrap">{{ button.mousetrap[0].bind }}:</pre>
          <v-icon>{{ button.icon }}</v-icon>
        </v-btn>
      </template>
      <slot name="delete-controls" />
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
.expand-toggle {
  opacity: 0.5;
  transition: opacity 0.2s;
}
.expand-toggle:hover {
  opacity: 1;
}
</style>
