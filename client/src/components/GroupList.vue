<script lang="ts">
import Vue from 'vue';
import {
  defineComponent, reactive, computed, ref, Ref,
} from '@vue/composition-api';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

import {
  useEditingMode,
  useGroupStore,
  useReadOnlyMode,
  useGroupStyleManager,
} from '../provides';


/* Magic numbers involved in height calculation */
const TrackListHeaderHeight = 52;

export default defineComponent({
  name: 'TrackList',

  props: {
    newTrackMode: {
      type: String,
      required: true,
    },
    newTrackType: {
      type: String,
      required: true,
    },
    lockTypes: {
      type: Boolean,
      default: false,
    },
    hotkeysDisabled: {
      type: Boolean,
      required: true,
    },
    height: {
      type: Number,
      default: 420,
    },
  },

  setup(props) {
    const { prompt } = usePrompt();
    const readOnlyMode = useReadOnlyMode();
    const editingModeRef = useEditingMode();
    const store = useGroupStore();
    const typeStylingRef = useGroupStyleManager().typeStyling;

    const data = reactive({
      itemHeight: 70, // in pixels
    });
    const virtualList = ref(null as null | Vue);

    const virtualListItems: Ref<readonly VirtualListItem[]> = computed(() => {
      return store.sorted.value.map((filtered) => ({
        filteredGroup: filtered,
      }));
    });

    function getItemProps(item: VirtualListItem) {
      const confidencePair = item.filteredTrack.annotation.getType(
        item.filteredTrack.context.confidencePairIndex,
      );
      const trackType = confidencePair[0];
      const selected = item.selectedTrackId === item.filteredTrack.annotation.id;
      return {
        trackType,
        track: item.filteredTrack.annotation,
        inputValue: item.checkedTrackIds.indexOf(item.filteredTrack.annotation.id) >= 0,
        selected,
        editing: selected && item.editingTrack,
        color: typeStylingRef.value.color(trackType),
        types: item.allTypes,
      };
    }

    const virtualHeight = computed(() => props.height - TrackListHeaderHeight);

    return {
      allTypes: allTypesRef,
      data,
      getItemProps,
      mouseTrap,
      newTrackColor,
      filteredTracks: filteredTracksRef,
      readOnlyMode,
      trackAdd,
      virtualHeight,
      virtualListItems,
      virtualList,
      multiDelete,
    };
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <datalist id="allTypesOptions">
      <option
        v-for="type in allTypes"
        :key="type"
        :value="type"
      >
        {{ type }}
      </option>
    </datalist>
    <v-virtual-scroll
      ref="virtualList"
      v-mousetrap="mouseTrap"
      class="tracks"
      :items="virtualListItems"
      :item-height="data.itemHeight"
      :height="virtualHeight"
      bench="1"
    >
      <template #default="{ item }">
        <track-item
          v-bind="getItemProps(item)"
          :lock-types="lockTypes"
          @seek="$emit('track-seek', $event)"
        />
      </template>
    </v-virtual-scroll>
  </div>
</template>

<style lang="scss">
.strcoller {
  height: 100%;
}
.trackHeader{
  height: auto;
}
.tracks {
  overflow-y: auto;
  overflow-x: hidden;

  .v-input--checkbox {
    label {
      white-space: pre-wrap;
    }
  }
}
</style>
