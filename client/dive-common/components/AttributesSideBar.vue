<script lang="ts">
import {
  defineComponent, ref, watch, PropType,
} from '@vue/composition-api';

import StackedVirtualSidebarContainer from 'dive-common/components/StackedVirtualSidebarContainer.vue';
import { useReadOnlyMode } from 'vue-media-annotator/provides';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import AttributeFilters from 'vue-media-annotator/components/AttributeFilters.vue';
import AttributeTimeline from 'vue-media-annotator/components/AttributeTimeline.vue';
import TooltipBtn from 'vue-media-annotator/components/TooltipButton.vue';

export default defineComponent({
  name: 'AttributesSideBar',

  components: {
    StackedVirtualSidebarContainer,
    AttributeFilters,
    AttributeTimeline,
    TooltipBtn,
  },

  props: {
    width: {
      type: Number,
      default: 300,
    },
    subCategory: {
      type: String as PropType<'Timeline' | 'Filtering'>,
      required: false,
    },
  },

  setup(props) {
    const readOnlyMode = useReadOnlyMode();
    const { visible } = usePrompt();
    const currentMode = ref(props.subCategory);
    const modes = ref(['Filtering', 'Timeline']);
    watch(() => props.subCategory, () => {
      if (props.subCategory !== undefined) {
        currentMode.value = props.subCategory;
      }
    });
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
    <template #default="{ bottomHeight }">
      <v-container>
        <h3> {{ currentMode }} </h3>
        <v-row class="px-3">
          <div class="mx-1">
            <tooltip-btn
              icon="mdi-filter"
              tooltip-text="Filter Attributes displayed"
              size="large"
              :color="currentMode === 'Filtering'? 'primary' : 'default'"
              outlined
              tile
              @click="currentMode = 'Filtering'"
            />
          </div>
          <div class="mx-1">
            <tooltip-btn
              icon="mdi-chart-line-variant"
              tooltip-text="Chart Numeric Attributes"
              size="large"
              outlined
              :color="currentMode === 'Timeline'? 'primary' : 'default'"

              tile
              @click="currentMode = 'Timeline'"
            />
          </div>
        </v-row>
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
      </v-container>
    </template>
  </StackedVirtualSidebarContainer>
</template>
