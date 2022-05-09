<script lang="ts">
import Vue from 'vue';
import {
  defineComponent, reactive, computed, ref,
} from '@vue/composition-api';

import {
  useReadOnlyMode,
  useGroupStyleManager,
  useEditingGroupId,
  useGroupFilterControls,
  useSelectedTrackId,
} from '../provides';
import GroupItem from './GroupItem.vue';

export default defineComponent({
  name: 'GroupList',

  components: { GroupItem },

  props: {
    height: {
      type: Number,
      default: 420,
    },
  },

  setup() {
    const readOnlyMode = useReadOnlyMode();
    // const store = useGroupStore();
    const typeStylingRef = useGroupStyleManager().typeStyling;
    const selectedId = useEditingGroupId();
    const selectedTrack = useSelectedTrackId();
    const groupFilters = useGroupFilterControls();

    const data = reactive({
      itemHeight: 70, // in pixels
    });
    const virtualList = ref(null as null | Vue);

    const virtualListItems = computed(() => {
      const filteredGroups = groupFilters.filteredAnnotations.value;
      const checkedTrackIds = groupFilters.checkedIDs.value;
      return filteredGroups.map((filtered) => ({
        filteredGroup: filtered,
        checkedTrackIds,
      }));
    });

    function getItemProps(item: typeof virtualListItems.value[number]) {
      const confidencePair = item.filteredGroup.annotation.getType();
      return {
        group: item.filteredGroup.annotation,
        color: typeStylingRef.value.color(confidencePair[0]),
        selected: item.filteredGroup.annotation.id === selectedId.value,
        selectedTrackId: selectedTrack.value,
        secondarySelected: selectedTrack.value
          ? selectedTrack.value in item.filteredGroup.annotation.members
          : false,
        inputValue: item.checkedTrackIds.includes(item.filteredGroup.annotation.id),
      };
    }

    return {
      data,
      getItemProps,
      groupFilters,
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
    <datalist id="allGroupTypesOptions">
      <option
        v-for="type in groupFilters.allTypes.value"
        :key="type"
        :value="type"
      >
        {{ type }}
      </option>
    </datalist>
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

<style lang="scss" scoped>
.groups {
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
