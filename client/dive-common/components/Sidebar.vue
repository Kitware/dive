<script lang="ts">
import {
  defineComponent,
  reactive,
  toRef,
  watch,
} from '@vue/composition-api';

import { TypeList, TrackList, injectAggregateController } from 'vue-media-annotator/components';
import { useAllTypes, useHandler } from 'vue-media-annotator/provides';

import { clientSettings } from 'dive-common/store/settings';
import TrackDetailsPanel from 'dive-common/components/TrackDetailsPanel.vue';
import TrackSettingsPanel from 'dive-common/components/TrackSettingsPanel.vue';
import TypeSettingsPanel from 'dive-common/components/TypeSettingsPanel.vue';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

/* Magic numbers used in height calculations */
const toolbarHeight = 112;
const confidenceThresholdHeight = 52;

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
    TrackDetailsPanel,
    TrackSettingsPanel,
    TypeList,
    TrackList,
    TypeSettingsPanel,
  },

  setup(props) {
    const allTypesRef = useAllTypes();
    const { toggleMerge, commitMerge } = useHandler();
    const { visible } = usePrompt();
    const trackSettings = toRef(clientSettings, 'trackSettings');
    const typeSettings = toRef(clientSettings, 'typeSettings');
    const aggregateController = injectAggregateController();

    function seek(frame: number) {
      aggregateController.value.seek(frame);
    }

    const data = reactive({
      currentTab: 'tracks' as 'tracks' | 'attributes',
      typeHeight: 0,
      trackHeight: 0,
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

    function onResize() {
      const totalHeight = window.innerHeight - toolbarHeight;
      data.typeHeight = Math.floor(totalHeight * 0.45);
      data.trackHeight = Math.floor(totalHeight * 0.55);
      if (props.enableSlot) {
        data.typeHeight -= confidenceThresholdHeight;
      }
    }
    onResize();
    watch(toRef(props, 'enableSlot'), onResize);

    return {
      /* data */
      allTypesRef,
      commitMerge,
      data,
      trackSettings,
      typeSettings,
      visible,
      /* methods */
      doToggleMerge,
      onResize,
      swapTabs,
      seek,
    };
  },
});
</script>

<template>
  <v-card
    v-resize="onResize"
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
        v-if="data.currentTab === 'tracks'"
        key="type-tracks"
        class="wrapper d-flex flex-column"
      >
        <TypeList
          :show-empty-types="typeSettings.showEmptyTypes"
          :height="data.typeHeight"
          :width="width"
          class="flex-shrink-1 flex-grow-1"
        >
          <template slot="settings">
            <TypeSettingsPanel
              :all-types="allTypesRef"
              @import-types="$emit('import-types',$event)"
            />
          </template>
        </TypeList>
        <slot v-if="enableSlot" />
        <v-divider />
        <TrackList
          class="flex-grow-0 flex-shrink-0"
          :new-track-mode="trackSettings.newTrackSettings.mode"
          :new-track-type="trackSettings.newTrackSettings.type"
          :lock-types="typeSettings.lockTypes"
          :hotkeys-disabled="visible()"
          :height="data.trackHeight"
          @track-seek="seek"
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
        :hotkeys-disabled="visible()"
        :width="width"
        @track-seek="seek"
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

.swap-button {
  position: absolute;
  top: 4px;
  right: 8px;
  z-index: 1;
}
</style>
