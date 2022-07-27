<script lang="ts">
import { defineComponent } from '@vue/composition-api';

import StackedVirtualSidebarContainer from 'dive-common/components/StackedVirtualSidebarContainer.vue';
import { useReadOnlyMode } from 'vue-media-annotator/provides';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import AttributeFilters from 'vue-media-annotator/components/AttributeFilters.vue';

export default defineComponent({
  name: 'AttributesSideBar',

  components: {
    StackedVirtualSidebarContainer,
    AttributeFilters,
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
      <attribute-filters
        class="flex-grow-0 flex-shrink-0"
        :height="bottomHeight"
        :hotkeys-disabled="visible() || readOnlyMode"
      />
    </template>
  </StackedVirtualSidebarContainer>
</template>
