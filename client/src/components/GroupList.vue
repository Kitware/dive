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
  useSelectedGroupId,
} from '../provides';
import GroupItem from './GroupItem.vue';

interface VirtualListItem {
  filteredGroup: Group;
}

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
    height: {
      type: Number,
      default: 420,
    },
  },

  setup() {
    // const { prompt } = usePrompt();
    const readOnlyMode = useReadOnlyMode();
    const store = useGroupStore();
    const typeStylingRef = useGroupStyleManager().typeStyling;
    const selectedId = useSelectedGroupId();

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
        selected: item.filteredGroup.id === selectedId.value,
      };
    }

    return {
      data,
      getItemProps,
      readOnlyMode,
      virtualListItems,
      virtualList,
    };
  },
});
</script>

<template>
  <div class="d-flex flex-column">
    <v-subheader class="flex-grow-1 trackHeader px-2">
      <v-container class="py-2">
        <v-row align="center">
          Groups ({{ virtualListItems.length }})
        </v-row>
      </v-container>
    </v-subheader>
    <v-virtual-scroll
      ref="virtualList"
      class="groups"
      :items="virtualListItems"
      :item-height="data.itemHeight"
      :height="height - 38"
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
