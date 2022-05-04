<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import FilterList from 'vue-media-annotator/components/FilterList.vue';
import GroupList from 'vue-media-annotator/components/GroupList.vue';

import StackedVirtualSidebarContainer from 'dive-common/components/StackedVirtualSidebarContainer.vue';
import { useGroupFilterControls, useGroupStyleManager } from 'vue-media-annotator/provides';

export default defineComponent({
  name: 'GroupSidebar',

  components: {
    GroupList,
    FilterList,
    StackedVirtualSidebarContainer,
  },

  props: {
    width: {
      type: Number,
      default: 300,
    },
  },

  setup() {
    // const allTypesRef = useTrackFilters().allTypes;
    // const readOnlyMode = useReadOnlyMode();
    // const { toggleMerge, commitMerge } = useHandler();
    // const { visible } = usePrompt();
    // const trackSettings = toRef(clientSettings, 'trackSettings');
    // const typeSettings = toRef(clientSettings, 'typeSettings');
    const groupFilterControls = useGroupFilterControls();
    const styleManager = useGroupStyleManager();

    return {
      styleManager,
      groupFilterControls,
    };
  },
});
</script>


<template>
  <StackedVirtualSidebarContainer
    :width="width"
    :enable-slot="false"
  >
    <template #default="{ topHeight, bottomHeight }">
      <FilterList
        :show-empty-types="true"
        :height="topHeight - 46"
        :width="width"
        :style-manager="styleManager"
        :filter-controls="groupFilterControls"
        class="flex-shrink-1 flex-grow-1"
      />
      <v-divider />
      <GroupList
        class="flex-grow-0 flex-shrink-0"
        :height="bottomHeight"
      />
    </template>
  </StackedVirtualSidebarContainer>
</template>
