<script lang="ts">
import {
  defineComponent,
  reactive,
  toRefs,
  toRef,
} from '@vue/composition-api';

import { TypeList, TrackList } from 'vue-media-annotator/components';
import { useAllTypes, useHandler } from 'vue-media-annotator/provides';

import { clientSettings } from 'dive-common/store/settings';
import TrackDetailsPanel from 'dive-common/components/TrackDetailsPanel.vue';
import TrackSettingsPanel from 'dive-common/components/TrackSettingsPanel.vue';
import TypeSettingsPanel from 'dive-common/components/TypeSettingsPanel.vue';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

export default defineComponent({
  props: {
    width: {
      type: Number,
      default: 300,
    },
  },

  components: {
    TrackDetailsPanel,
    TrackSettingsPanel,
    TypeList,
    TrackList,
    TypeSettingsPanel,
  },

  setup() {
    const allTypesRef = useAllTypes();
    const { toggleMerge, commitMerge } = useHandler();
    const { visible } = usePrompt();
    const trackSettings = toRef(clientSettings, 'trackSettings');
    const typeSettings = toRef(clientSettings, 'typeSettings');

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
    return {
      allTypesRef,
      trackSettings,
      typeSettings,
      swapTabs,
      doToggleMerge,
      commitMerge,
      ...toRefs(data),
      visible,
    };
  },
});
</script>

<template>
  <v-card
    :width="width"
    tile
    outlined
    class="sidebar d-flex flex-column overflow-hidden"
    style="z-index:1;"
  >
    <v-btn
      v-mousetrap="[
        { bind: 'a', handler: swapTabs },
        { bind: 'm', handler: doToggleMerge },
        { bind: 'shift+m', handler: commitMerge },
      ]"
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
        v-if="currentTab === 'tracks'"
        key="type-tracks"
        class="wrapper d-flex flex-column"
      >
        <TypeList
          :show-empty-types="typeSettings.showEmptyTypes"
          class="flex-shrink-1 flex-grow-1 typelist"
        >
          <template slot="settings">
            <TypeSettingsPanel
              :all-types="allTypesRef"
              @import-types="$emit('import-types',$event)"
            />
          </template>
        </TypeList>
        <v-spacer />
        <slot />
        <v-divider />
        <TrackList
          class="flex-grow-0 flex-shrink-0"
          :new-track-mode="trackSettings.newTrackSettings.mode"
          :new-track-type="trackSettings.newTrackSettings.type"
          :lock-types="typeSettings.lockTypes"
          :hotkeys-disabled="visible()"
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
        v-else-if="currentTab === 'attributes'"
        :lock-types="typeSettings.lockTypes"
        :hotkeys-disabled="visible()"
        :width="width"
        @track-seek="$emit('track-seek', $event)"
        @toggle-merge="doToggleMerge"
        @back="swapTabs"
        @commit-merge="commitMerge"
      />
    </v-slide-x-transition>
  </v-card>
</template>

<style scoped>
.sidebar {
  max-height: calc(100vh - 112px);
}

.wrapper {
  /* height: 100%; */
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.typelist {
  min-height: 250px;
}

.swap-button {
  position: absolute;
  top: 4px;
  right: 8px;
  z-index: 1;
}
</style>
