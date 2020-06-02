<script lang="ts">
import {
  defineComponent,
  reactive,
  toRefs,
  PropType,
  Ref,
} from '@vue/composition-api';

import AttributesPanel from '@/components/AttributesPanel.vue';
import TypeList from '@/components/TypeList.vue';
import TrackList from '@/components/TrackList.vue';
import Track, { TrackId } from '@/lib/track';

export default defineComponent({
  props: {
    trackMap: {
      type: Map as PropType<Map<TrackId, Track>>,
      required: true,
    },
    filteredTrackIds: {
      type: Object as PropType<Ref<Array<TrackId>>>,
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
    typeColorMapper: {
      type: Function as PropType<(t: string) => string>,
      required: true,
    },
    width: {
      type: Number,
      default: 300,
    },
  },

  components: { AttributesPanel, TypeList, TrackList },

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
      v-mousetrap="[{
        bind: 'a',
        handler: () => swapTabs,
      }]"
      icon
      title="A key"
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
          class="flex-shrink-1 typelist"
        />
        <v-spacer />
        <v-divider />
        <track-list
          class="flex-grow-0 flex-shrink-0"
          v-bind="trackListProps"
          @track-remove="$emit('track-remove', $event)"
          @track-add="$emit('track-add')"
          @track-click="$emit('track-click', $event)"
          @track-checked="handleTrackChecked"
          @track-edit="$emit('track-edit', $event)"
          @track-previous="$emit('track-previous')"
          @track-next="$emit('track-next')"
        />
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
  min-height: 100px;
}

.swap-button {
  position: absolute;
  top: 5px;
  right: 5px;
  z-index: 1;
}
</style>
