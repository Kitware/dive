<script lang="ts">
import { defineComponent, ref } from '@vue/composition-api';

import StackedVirtualSidebarContainer from 'dive-common/components/StackedVirtualSidebarContainer.vue';
import { useReadOnlyMode } from 'vue-media-annotator/provides';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import AttributeFilters from 'vue-media-annotator/components/AttributeFilters.vue';
import AttributeTimeline from 'vue-media-annotator/components/AttributeTimeline.vue';

export default defineComponent({
  name: 'AttributesSideBar',

  components: {
    StackedVirtualSidebarContainer,
    AttributeFilters,
    AttributeTimeline,
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
    const currentMode = ref('Filtering');
    const modes = ref(['Filtering', 'Timeline', 'Visualization', 'Actions']);


    return {
      readOnlyMode,
      currentMode,
      modes,
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
      <v-select
        v-model="currentMode"
        :items="modes"
        label="Attributes Section"
        class="px-2"
      />
      <v-divider />
      <attribute-filters
        v-if="currentMode === 'Filtering'"
        class="flex-grow-0 flex-shrink-0"
        :height="bottomHeight"
        :hotkeys-disabled="visible() || readOnlyMode"
      />
      <attribute-timeline
        v-if="currentMode === 'Timeline'"
        class="flex-grow-0 flex-shrink-0"
        :height="bottomHeight"
      />
    </template>
  </StackedVirtualSidebarContainer>
</template>
