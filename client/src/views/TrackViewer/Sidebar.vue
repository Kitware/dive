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
    addTrack: {
      type: Function as PropType<() => Track>,
      required: true,
    },
    removeTrack: {
      type: Function as PropType<(t: string) => void>,
      required: true,
    },
    selectNextTrack: {
      type: Function as PropType<(delta: number) => void>,
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

    function handleTrackEdit(trackId: string) {
      // TODO p1
      return trackId;
    }

    function handleTrackClick(trackId: string) {
      // TODO p1
      return trackId;
    }

    return {
      swapTabs,
      trackListProps: props,
      typeListProps: props,
      handleTrackChecked,
      handleTrackEdit,
      handleTrackClick,
      ...toRefs(data),
    };
  },
});
</script>

<template>
  <v-card
    :width="width"
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
          class="flex-grow-1"
        />
        <v-divider />
        <track-list
          class="flex-shrink-0"
          v-bind="trackListProps"
          @track-remove="removeTrack"
          @track-add="addTrack"
          @track-click="handleTrackClick"
          @track-checked="handleTrackChecked"
          @track-edit="handleTrackEdit"
          @select-track-up="selectNextTrack(-1)"
          @select-track-down="selectNextTrack(1)"
        />
      </div>
      <div
        v-else-if="currentTab === 'attributes'"
        key="attributes"
        class="wrapper d-flex"
      >
        <attributes-panel />
      </div>
    </v-slide-x-transition>
  </v-card>
</template>
