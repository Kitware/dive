<script lang="ts">
import {
  computed,
  defineComponent,
  reactive,
  toRef,
  watch,
} from 'vue';

import { FilterList, TrackList } from 'vue-media-annotator/components';
import {
  useCameraStore,
  useHandler,
  useReadOnlyMode,
  useTrackFilters,
  useTrackStyleManager,
  useEditingMultiTrack,
} from 'vue-media-annotator/provides';

import { clientSettings } from 'dive-common/store/settings';
import ConfidenceFilter from 'dive-common/components/ConfidenceFilter.vue';
import TrackDetailsPanel from 'dive-common/components/TrackDetailsPanel.vue';
import TrackSettingsPanel from 'dive-common/components/TrackSettingsPanel.vue';
import TypeSettingsPanel from 'dive-common/components/TypeSettingsPanel.vue';
import StackedVirtualSidebarContainer from 'dive-common/components/StackedVirtualSidebarContainer.vue';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

export default defineComponent({

  components: {
    ConfidenceFilter,
    StackedVirtualSidebarContainer,
    TrackDetailsPanel,
    TrackSettingsPanel,
    FilterList,
    TrackList,
    TypeSettingsPanel,
  },
  props: {
    width: {
      type: Number,
      default: 300,
    },
    enableSlot: {
      type: Boolean,
      default: true,
    },
    horizontal: {
      type: Boolean,
      default: false,
    },
  },

  setup() {
    const allTypesRef = useTrackFilters().allTypes;
    const readOnlyMode = useReadOnlyMode();
    const cameraStore = useCameraStore();
    const multiCam = cameraStore.camMap.value.size > 1;
    const {
      toggleMerge,
      commitMerge,
      groupAdd,
      deleteSelectedTracks,
    } = useHandler();
    const { visible } = usePrompt();
    const trackSettings = toRef(clientSettings, 'trackSettings');
    const typeSettings = toRef(clientSettings, 'typeSettings');
    const trackFilterControls = useTrackFilters();
    const styleManager = useTrackStyleManager();

    const data = reactive({
      currentTab: 'tracks' as 'tracks' | 'attributes' | 'types',
      // For horizontal mode, cycle through 3 tabs
      horizontalTab: 'tracks' as 'tracks' | 'attributes' | 'types',
    });

    function swapTabs() {
      if (data.currentTab === 'tracks') {
        data.currentTab = 'attributes';
      } else {
        data.currentTab = 'tracks';
      }
    }

    function cycleHorizontalTabs() {
      if (data.horizontalTab === 'tracks') {
        data.horizontalTab = 'attributes';
      } else if (data.horizontalTab === 'attributes') {
        data.horizontalTab = 'types';
      } else {
        data.horizontalTab = 'tracks';
      }
    }

    const horizontalTabIcon = computed(() => {
      if (data.horizontalTab === 'tracks') return 'mdi-format-list-bulleted';
      if (data.horizontalTab === 'attributes') return 'mdi-card-text';
      return 'mdi-filter-variant';
    });

    const horizontalTabTooltip = computed(() => {
      if (data.horizontalTab === 'tracks') return 'Detection List (click to cycle)';
      if (data.horizontalTab === 'attributes') return 'Detection Details (click to cycle)';
      return 'Type Filters (click to cycle)';
    });

    function doToggleMerge() {
      if (toggleMerge().length) {
        data.currentTab = 'attributes';
      }
    }

    const mouseTrap = computed(() => {
      const trap = [
        { bind: 'a', handler: swapTabs },
      ];
      if (!readOnlyMode.value && !multiCam) {
        trap.push(
          { bind: 'm', handler: doToggleMerge },
          { bind: 'g', handler: () => { groupAdd(); data.currentTab = 'attributes'; } },
          { bind: 'shift+m', handler: commitMerge },
        );
      }
      return trap;
    });

    const editingMultiTrack = useEditingMultiTrack();
    watch(editingMultiTrack, () => {
      if (editingMultiTrack.value) {
        data.currentTab = 'attributes';
      }
    });

    async function handleDeleteSelectedTracks() {
      await deleteSelectedTracks();
      data.currentTab = 'attributes';
      swapTabs();
    }

    return {
      /* data */
      data,
      allTypesRef,
      commitMerge,
      groupAdd,
      handleDeleteSelectedTracks,
      mouseTrap,
      trackFilterControls,
      trackSettings,
      typeSettings,
      readOnlyMode,
      styleManager,
      disableAnnotationFilters: trackFilterControls.disableAnnotationFilters,
      confidenceFilters: trackFilterControls.confidenceFilters,
      visible,
      horizontalTabIcon,
      horizontalTabTooltip,
      /* methods */
      doToggleMerge,
      swapTabs,
      cycleHorizontalTabs,
    };
  },
});
</script>

<template>
  <!-- Vertical layout (default) -->
  <StackedVirtualSidebarContainer
    v-if="!horizontal"
    :width="width"
    :enable-slot="enableSlot"
  >
    <template #default="{ topHeight, bottomHeight }">
      <v-btn
        v-mousetrap="mouseTrap"
        small
        icon
        title="press `a`"
        class="swap-button"
        @click="swapTabs"
      >
        <v-icon>mdi-swap-horizontal</v-icon>
      </v-btn>
      <v-slide-x-transition>
        <div
          v-if="data.currentTab === 'tracks'"
          key="type-tracks"
          class="wrapper d-flex flex-column"
        >
          <FilterList
            :show-empty-types="typeSettings.showEmptyTypes"
            :height="topHeight"
            :width="width"
            :style-manager="styleManager"
            :filter-controls="trackFilterControls"
            :disabled="disableAnnotationFilters"
            class="flex-shrink-1 flex-grow-1"
          >
            <template #settings>
              <TypeSettingsPanel
                :all-types="allTypesRef"
                @import-types="$emit('import-types', $event)"
              />
            </template>
          </FilterList>
          <slot v-if="enableSlot" />
          <v-divider />
          <TrackList
            class="flex-grow-0 flex-shrink-0"
            :new-track-mode="trackSettings.newTrackSettings.mode"
            :new-track-type="trackSettings.newTrackSettings.type"
            :lock-types="typeSettings.lockTypes"
            :hotkeys-disabled="visible() || readOnlyMode"
            :height="bottomHeight"
            :disabled="disableAnnotationFilters"
            @track-seek="$emit('track-seek', $event)"
          >
            <template slot="settings">
              <TrackSettingsPanel
                :all-types="allTypesRef"
              />
            </template>
          </TrackList>
        </div>
        <track-details-panel
          v-else-if="data.currentTab === 'attributes'"
          :lock-types="typeSettings.lockTypes"
          :hotkeys-disabled="visible() || readOnlyMode"
          :width="width"
          :disabled="disableAnnotationFilters"
          @track-seek="$emit('track-seek', $event)"
          @toggle-merge="doToggleMerge"
          @back="swapTabs"
          @commit-merge="commitMerge"
          @create-group="groupAdd"
          @delete-selected-tracks="handleDeleteSelectedTracks"
        />
      </v-slide-x-transition>
    </template>
  </StackedVirtualSidebarContainer>

  <!-- Horizontal layout (bottom sidebar) -->
  <div
    v-else
    class="horizontal-sidebar d-flex flex-column"
    :style="{ width: `${width}px`, height: '100%' }"
  >
    <v-tooltip bottom>
      <template #activator="{ on }">
        <v-btn
          small
          icon
          class="swap-button-horizontal"
          v-on="on"
          @click="cycleHorizontalTabs"
        >
          <v-icon>{{ horizontalTabIcon }}</v-icon>
        </v-btn>
      </template>
      <span>{{ horizontalTabTooltip }}</span>
    </v-tooltip>
    <!-- Detection List Tab -->
    <div
      v-if="data.horizontalTab === 'tracks'"
      class="d-flex flex-column fill-height"
      style="overflow: hidden; width: 100%;"
    >
      <!-- Mini confidence slider at top -->
      <div class="confidence-row px-2 py-1 pr-10">
        <ConfidenceFilter
          :confidence.sync="confidenceFilters.default"
          :disabled="disableAnnotationFilters"
          text="Confidence"
          @end="$emit('save-threshold')"
        />
      </div>
      <!-- Track list takes full width -->
      <div
        class="d-flex flex-column flex-grow-1"
        style="overflow: hidden;"
      >
        <TrackList
          class="fill-height"
          compact
          :new-track-mode="trackSettings.newTrackSettings.mode"
          :new-track-type="trackSettings.newTrackSettings.type"
          :lock-types="typeSettings.lockTypes"
          :hotkeys-disabled="visible() || readOnlyMode"
          :height="180"
          :disabled="disableAnnotationFilters"
          @track-seek="$emit('track-seek', $event)"
        >
          <template slot="settings">
            <TrackSettingsPanel
              :all-types="allTypesRef"
            />
          </template>
        </TrackList>
      </div>
    </div>
    <!-- Detection Details Tab -->
    <div
      v-else-if="data.horizontalTab === 'attributes'"
      class="horizontal-details-panel"
    >
      <track-details-panel
        :lock-types="typeSettings.lockTypes"
        :hotkeys-disabled="visible() || readOnlyMode"
        :width="width"
        :disabled="disableAnnotationFilters"
        class="details-panel-scrollable"
        @track-seek="$emit('track-seek', $event)"
        @toggle-merge="doToggleMerge"
        @back="cycleHorizontalTabs"
        @commit-merge="commitMerge"
        @create-group="groupAdd"
        @delete-selected-tracks="handleDeleteSelectedTracks"
      />
    </div>
    <!-- Type Filters Tab -->
    <div
      v-else-if="data.horizontalTab === 'types'"
      class="d-flex flex-column fill-height horizontal-types-panel"
    >
      <FilterList
        :show-empty-types="typeSettings.showEmptyTypes"
        :height="220"
        :width="width - 10"
        :style-manager="styleManager"
        :filter-controls="trackFilterControls"
        :disabled="disableAnnotationFilters"
        class="fill-height"
      >
        <template #settings>
          <TypeSettingsPanel
            :all-types="allTypesRef"
            @import-types="$emit('import-types', $event)"
          />
        </template>
      </FilterList>
    </div>
  </div>
</template>

<style scoped>

.wrapper {
  /* height: 100%; */
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.swap-button {
  position: absolute;
  top: 4px;
  right: 8px;
  z-index: 1;
}

.horizontal-sidebar {
  position: relative;
  border-right: 1px solid #444;
  flex-shrink: 0;
  background-color: #1e1e1e;
}

.swap-button-horizontal {
  position: absolute;
  top: 4px;
  right: 8px;
  z-index: 1;
}

.confidence-row {
  background-color: #1e1e1e;
  border-bottom: 1px solid #444;
  flex-shrink: 0;
}

.horizontal-details-panel {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  height: 100%;

  /* Always show scrollbar */
  &::-webkit-scrollbar {
    width: 8px;
  }
  &::-webkit-scrollbar-track {
    background: #1e1e1e;
  }
  &::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 4px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: #666;
  }
}

/* Override overflow-hidden on TrackDetailsPanel when in horizontal mode */
.details-panel-scrollable {
  overflow: visible !important;
}

.horizontal-types-panel {
  overflow-y: auto;
  overflow-x: hidden;

  /* Always show scrollbar */
  &::-webkit-scrollbar {
    width: 8px;
  }
  &::-webkit-scrollbar-track {
    background: #1e1e1e;
  }
  &::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 4px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: #666;
  }
}
</style>
