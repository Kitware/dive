<script lang="ts">
import {
  computed,
  defineComponent,
  reactive,
  toRef,
} from '@vue/composition-api';

import { FilterList, TrackList } from 'vue-media-annotator/components';
import {
  useCameraStore,
  useHandler, useReadOnlyMode, useTrackFilters, useTrackStyleManager,
} from 'vue-media-annotator/provides';

import { clientSettings } from 'dive-common/store/settings';
import TrackDetailsPanel from 'dive-common/components/TrackDetailsPanel.vue';
import TrackSettingsPanel from 'dive-common/components/TrackSettingsPanel.vue';
import TypeSettingsPanel from 'dive-common/components/TypeSettingsPanel.vue';
import StackedVirtualSidebarContainer from 'dive-common/components/StackedVirtualSidebarContainer.vue';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

export default defineComponent({
  props: {
    width: {
      type: Number,
      default: 300,
    },
    enableSlot: {
      type: Boolean,
      default: false,
    },
  },

  components: {
    StackedVirtualSidebarContainer,
    TrackDetailsPanel,
    TrackSettingsPanel,
    FilterList,
    TrackList,
    TypeSettingsPanel,
  },

  setup() {
    const allTypesRef = useTrackFilters().allTypes;
    const readOnlyMode = useReadOnlyMode();
    const cameraStore = useCameraStore();
    const multiCam = cameraStore.camMap.value.size > 1;
    const { toggleMerge, commitMerge, groupAdd } = useHandler();
    const { visible } = usePrompt();
    const trackSettings = toRef(clientSettings, 'trackSettings');
    const typeSettings = toRef(clientSettings, 'typeSettings');
    const trackFilterControls = useTrackFilters();
    const styleManager = useTrackStyleManager();

    const data = reactive({
      currentTab: 'tracks' as 'tracks' | 'attributes',
    });

    function swapTabs() {
      if (data.currentTab === 'tracks') {
        data.currentTab = 'attributes';
      } else {
        data.currentTab = 'tracks';
      }
    }

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

    return {
      /* data */
      data,
      allTypesRef,
      commitMerge,
      groupAdd,
      mouseTrap,
      trackFilterControls,
      trackSettings,
      typeSettings,
      readOnlyMode,
      styleManager,
      visible,
      /* methods */
      doToggleMerge,
      swapTabs,
    };
  },
});
</script>

<template>
  <StackedVirtualSidebarContainer
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
            class="flex-shrink-1 flex-grow-1"
          >
            <template #settings>
              <TypeSettingsPanel
                :all-types="allTypesRef"
                @import-types="$emit('import-types',$event)"
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
          @track-seek="$emit('track-seek', $event)"
          @toggle-merge="doToggleMerge"
          @back="swapTabs"
          @commit-merge="commitMerge"
          @create-group="groupAdd"
        />
      </v-slide-x-transition>
    </template>
  </StackedVirtualSidebarContainer>
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
</style>
