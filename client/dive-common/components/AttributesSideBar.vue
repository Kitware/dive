<script lang="ts">
import { defineComponent } from '@vue/composition-api';

import StackedVirtualSidebarContainer from 'dive-common/components/StackedVirtualSidebarContainer.vue';
import {
  useGroupFilterControls, useGroupStyleManager, useReadOnlyMode,
} from 'vue-media-annotator/provides';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

export default defineComponent({
  name: 'AttributesSideBar',

  components: {
    StackedVirtualSidebarContainer,
  },

  props: {
    width: {
      type: Number,
      default: 300,
    },
  },

  setup() {
    const readOnlyMode = useReadOnlyMode();
    const { visible } = usePrompt();

    return {
      readOnlyMode,
      visible,
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
        group
        class="flex-shrink-1 flex-grow-1"
      />
      <v-divider />
      <GroupList
        class="flex-grow-0 flex-shrink-0"
        :height="bottomHeight"
        :hotkeys-disabled="visible() || readOnlyMode"
      />
    </template>
  </StackedVirtualSidebarContainer>
</template>
