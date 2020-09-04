<script lang="ts">
import {
  defineComponent,
  reactive,
  toRefs,
  PropType,
  Ref,
} from '@vue/composition-api';

import TypeList from 'vue-media-annotator/components/TypeList.vue';
import TrackList from 'vue-media-annotator/components/TrackList.vue';
import Track, { TrackId } from 'vue-media-annotator/track';
import { TypeStyling } from 'vue-media-annotator/use/useStyling';

import { NewTrackSettings } from 'app/use/useSettings';
import AttributesPanel from 'app/components/AttributesPanel.vue';
import CreationMode from 'app/components/CreationMode.vue';

export default defineComponent({
  props: {
    trackMap: {
      type: Map as PropType<Map<TrackId, Track>>,
      required: true,
    },
    filteredTracks: {
      type: Object as PropType<Ref<Array<Track>>>,
      required: true,
    },
    frame: {
      type: Object as PropType<Ref<number>>,
      required: true,
    },
    allTypes: {
      type: Object as PropType<Ref<Array<string>>>,
      required: true,
    },
    checkedTypes: {
      type: Object as PropType<Ref<Array<string>>>,
      required: true,
    },
    checkedTrackIds: {
      type: Object as PropType<Ref<Array<TrackId>>>,
      required: true,
    },
    selectedTrackId: {
      type: Object as PropType<Ref<TrackId>>,
      required: true,
    },
    editingTrack: {
      type: Object as PropType<Ref<boolean>>,
      required: true,
    },
    typeStyling: {
      type: Object as PropType<Ref<TypeStyling>>,
      required: true,
    },
    newTrackSettings: {
      type: Object as PropType<Ref<NewTrackSettings>>,
      required: true,
    },
    width: {
      type: Number,
      default: 300,
    },
  },

  components: {
    AttributesPanel,
    CreationMode,
    TypeList,
    TrackList,
  },

  setup(props) {
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

    function handleTrackChecked({ trackId, value }: { trackId: TrackId; value: boolean }) {
      if (value) {
        props.checkedTrackIds.value.push(trackId);
      } else {
        const i = props.checkedTrackIds.value.indexOf(trackId);
        props.checkedTrackIds.value.splice(i, 1);
      }
    }

    return {
      swapTabs,
      trackListProps: props,
      typeListProps: props,
      handleTrackChecked,
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
          v-bind="trackListProps"
          class="flex-shrink-1 flex-grow-1 typelist"
          @update-type-name="$emit('update-type-name',$event)"
          @update-type-style="$emit('update-type-style',$event)"
        />
        <slot />
        <v-spacer />
        <v-divider />
        <track-list
          class="flex-grow-0 flex-shrink-0"
          v-bind="trackListProps"
          :new-track-mode="newTrackSettings.value.mode"
          :new-track-type="newTrackSettings.value.type"
          @track-remove="$emit('track-remove', $event)"
          @track-add="$emit('track-add')"
          @track-click="$emit('track-click', $event)"
          @track-checked="handleTrackChecked"
          @track-edit="$emit('track-edit', $event)"
          @track-type-change="$emit('track-type-change', $event)"
          @track-previous="$emit('track-previous')"
          @track-next="$emit('track-next')"
          @track-split="$emit('track-split', $event)"
          @track-seek="$emit('track-seek', $event)"
        >
          <template slot="settings">
            <creation-mode
              :all-types="allTypes"
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
        <attributes-panel v-bind="{ trackMap, selectedTrackId, frame }" />
      </div>
    </v-slide-x-transition>
  </v-card>
</template>

<style scoped>
.sidebar {
  max-height: calc(100vh - 64px);
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
  min-height: 150px;
}

.swap-button {
  position: absolute;
  top: 5px;
  right: 16px;
  z-index: 1;
}
</style>
