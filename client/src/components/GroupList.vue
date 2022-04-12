<script lang="ts">
import Vue from 'vue';
import {
  defineComponent, reactive, computed, ref, Ref,
} from '@vue/composition-api';
// import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
// import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import Group from '../Group';

import {
  useGroupStore,
  useReadOnlyMode,
  useGroupStyleManager,
} from '../provides';
import GroupItem from './GroupItem.vue';

interface VirtualListItem {
  filteredGroup: Group;
}

/* Magic numbers involved in height calculation */
const TrackListHeaderHeight = 52;

export default defineComponent({
  name: 'GroupList',

  components: { GroupItem },

  props: {
    // newTrackMode: {
    //   type: String,
    //   required: true,
    // },
    // newTrackType: {
    //   type: String,
    //   required: true,
    // },
    // lockTypes: {
    //   type: Boolean,
    //   default: false,
    // },
    // hotkeysDisabled: {
    //   type: Boolean,
    //   required: true,
    // },
    // height: {
    //   type: Number,
    //   default: 420,
    // },
  },

  setup(props) {
    // const { prompt } = usePrompt();
    const readOnlyMode = useReadOnlyMode();
    const store = useGroupStore();
    const typeStylingRef = useGroupStyleManager().typeStyling;

    const data = reactive({
      itemHeight: 70, // in pixels
    });
    const virtualList = ref(null as null | Vue);

    const virtualListItems: Ref<readonly VirtualListItem[]> = computed(() => {
      const sorted = store.sorted.value;
      return sorted.map((filtered) => ({
        filteredGroup: filtered,
      }));
    });

    function getItemProps(item: VirtualListItem) {
      const confidencePair = item.filteredGroup.getType();
      return {
        group: item.filteredGroup,
        color: typeStylingRef.value.color(confidencePair[0]),
      };
    }

    const virtualHeight = computed(() => 800 - TrackListHeaderHeight);

    return {
      data,
      getItemProps,
      readOnlyMode,
      virtualHeight,
      virtualListItems,
      virtualList,
    };
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <!-- <datalist id="allTypesOptions">
      <option
        v-for="type in allTypes"
        :key="type"
        :value="type"
      >
        {{ type }}
      </option>
    </datalist> -->
    <v-virtual-scroll
      ref="virtualList"
      class="tracks"
      :items="virtualListItems"
      :item-height="data.itemHeight"
      :height="virtualHeight"
      bench="1"
    >
      <template #default="{ item }">
        <group-item
          v-bind="getItemProps(item)"
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
