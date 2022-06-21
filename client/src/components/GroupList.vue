<script lang="ts">
import {
  defineComponent, reactive, computed,
} from '@vue/composition-api';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';

import {
  useReadOnlyMode,
  useGroupStyleManager,
  useEditingGroupId,
  useGroupFilterControls,
  useSelectedTrackId,
  useCameraStore,
  useSelectedCamera,
} from '../provides';
import useVirtualScrollTo from '../use/useVirtualScrollTo';
import GroupItem from './GroupItem.vue';

export default defineComponent({
  name: 'GroupList',

  components: { GroupItem },

  props: {
    height: {
      type: Number,
      default: 420,
    },
    hotkeysDisabled: {
      type: Boolean,
      required: true,
    },
  },

  setup(props) {
    const readOnlyMode = useReadOnlyMode();
    const cameraStore = useCameraStore();
    const selectedCamera = useSelectedCamera();
    const typeStylingRef = useGroupStyleManager().typeStyling;
    const selectedId = useEditingGroupId();
    const selectedTrack = useSelectedTrackId();
    const groupFilters = useGroupFilterControls();
    const data = reactive({
      itemHeight: 58, // in pixels
    });
    const groupStoreRef = computed(
      () => cameraStore.camMap.value.get(selectedCamera.value)?.groupStore,
    );
    const getAnnotation = (id: AnnotationId) => {
      if (!groupStoreRef.value) {
        throw Error(`Could not find groupStore for Camera: ${selectedCamera.value}`);
      }
      const group = groupStoreRef.value.get(id);
      if (!group) {
        throw Error(`Group ID: ${id} did not exist for Camera: ${selectedCamera.value}`);
      }
      return group;
    };
    const virtualScroll = useVirtualScrollTo({
      itemHeight: data.itemHeight,
      getAnnotation,
      filteredListRef: groupFilters.filteredAnnotations,
      selectedIdRef: selectedId,
      multiSelectList: computed(() => {
        if (selectedTrack.value !== null) {
          return Array.from(groupStoreRef.value?.trackMap.get(selectedTrack.value)?.values() ?? []);
        }
        return [];
      }),
      selectNext: () => null,
    });

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
        secondarySelected: (selectedTrack.value !== null)
          ? selectedTrack.value in item.filteredGroup.annotation.members
          : false,
        inputValue: item.checkedTrackIds.includes(item.filteredGroup.annotation.id),
      };
    }

    /**
     * This doesn't actually do anything aside
     * from intercepting up/down keypresses and
     * calling preventDefault so that the list doesn't behave oddly.
     */
    const mouseTrap = computed(() => {
      const disabled = props.hotkeysDisabled;
      return [
        {
          bind: 'up',
          handler: (el: HTMLElement, event: KeyboardEvent) => {
            virtualScroll.scrollPreventDefault(el, event, 'up');
          },
          disabled,
        },
        {
          bind: 'down',
          handler: (el: HTMLElement, event: KeyboardEvent) => {
            virtualScroll.scrollPreventDefault(el, event, 'down');
          },
          disabled,
        },
      ];
    });

    return {
      data,
      mouseTrap,
      getItemProps,
      groupFilters,
      readOnlyMode,
      virtualListItems,
      virtualList: virtualScroll.virtualList,
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
      v-mousetrap="mouseTrap"
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
