<script lang="ts">
import {
  defineComponent,
  reactive,
  toRefs,
  PropType,
} from '@vue/composition-api';

import { TypeList, TrackList } from 'vue-media-annotator/components';
import { useAllTypes } from 'vue-media-annotator/provides';

import { NewTrackSettings, TypeSettings } from 'viame-web-common/use/useSettings';
import AttributesPanel from 'viame-web-common/components/AttributesPanel.vue';
import OldAttributesPanel from 'viame-web-common/components/OldAttributesPanel.vue';
import CreationMode from 'viame-web-common/components/CreationMode.vue';
import TypeSettingsPanel from 'viame-web-common/components/TypeSettingsPanel.vue';

export default defineComponent({
  props: {
    newTrackSettings: {
      type: Object as PropType<NewTrackSettings>,
      required: true,
    },
    typeSettings: {
      type: Object as PropType<TypeSettings>,
      required: true,
    },
    width: {
      type: Number,
      default: 300,
    },
  },

  components: {
    AttributesPanel,
    OldAttributesPanel,
    CreationMode,
    TypeList,
    TrackList,
    TypeSettingsPanel,
  },

  setup() {
    const allTypesRef = useAllTypes();
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

    return {
      allTypesRef,
      swapTabs,
      ...toRefs(data),
    };
  },
});
</script>

<template>
  <v-card
    :width="width"
    class="sidebar d-flex flex-column overflow-hidden"
    style="z-index:1;"
  >
    <v-btn
      v-mousetrap="[
        { bind: 'a', handler: swapTabs },
      ]"
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
        <type-list
          :show-empty-types="typeSettings.showEmptyTypes"
          class="flex-shrink-1 flex-grow-1 typelist"
        >
          <template slot="settings">
            <type-settings-panel
              :all-types="allTypesRef"
              :type-settings="typeSettings"
              @update-type-settings="$emit('update-type-settings',$event)"
              @import-types="$emit('import-types',$event)"
            />
          </template>
        </type-list>
        <slot />
        <v-spacer />
        <v-divider />
        <track-list
          class="flex-grow-0 flex-shrink-0"
          :new-track-mode="newTrackSettings.mode"
          :new-track-type="newTrackSettings.type"
          :lock-types="typeSettings.lockTypes"
          :hotkeys-disabled="$prompt.visible()"
          @track-seek="$emit('track-seek', $event)"
        >
          <template slot="settings">
            <creation-mode
              :all-types="allTypesRef"
              :new-track-settings="newTrackSettings"
              @update-new-track-settings="$emit('update-new-track-settings',$event)"
            />
          </template>
        </track-list>
      </div>
      <div
        v-else-if="currentTab === 'attributes'"
        key="attributes"
        class="wrapper d-flex"
      >
        <attributes-panel
          :lock-types="typeSettings.lockTypes"
          @track-seek="$emit('track-seek', $event)"
        />
      </div>
    </v-slide-x-transition>
  </v-card>
</template>

<style scoped>
.sidebar {
  max-height: calc(100vh - 128px);
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
  top: 5px;
  right: 16px;
  z-index: 1;
}
</style>
