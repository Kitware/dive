<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';
import { Pipe } from 'dive-common/apispec';
import { parsePipelineDataTypes } from 'dive-common/pipelineDataTypes';

export default defineComponent({
  name: 'RunPipelineToast',

  props: {
    pipeline: {
      type: Object as PropType<Pipe>,
      required: true,
    },
  },

  setup(props) {
    const inputTypes = computed(() => parsePipelineDataTypes(props.pipeline.metadata?.inputType));
    const outputTypes = computed(() => parsePipelineDataTypes(props.pipeline.metadata?.outputType));

    return {
      inputTypes,
      outputTypes,
    };
  },
});
</script>

<template>
  <div>
    <span>{{ pipeline.metadata?.description }}</span>
    <div v-if="inputTypes.length && outputTypes.length" class="pipeline-type-indicators">
      <span
        v-for="(item, index) in inputTypes"
        :key="`in-${index}`"
        class="pipeline-type"
        :title="item.qualifier ? `${item.name} (${item.qualifier})` : item.name"
      >
        <v-icon v-if="item.icon">
          {{ item.icon }}
        </v-icon>
        <span v-else>{{ item.name }}</span>
        <small v-if="item.qualifier">{{ item.qualifier }}</small>
      </span>

      <v-icon>
        mdi-arrow-right
      </v-icon>

      <span
        v-for="(item, index) in outputTypes"
        :key="`out-${index}`"
        class="pipeline-type"
        :title="item.qualifier ? `${item.name} (${item.qualifier})` : item.name"
      >
        <v-icon v-if="item.icon">
          {{ item.icon }}
        </v-icon>
        <span v-else>{{ item.name }}</span>
        <small v-if="item.qualifier">{{ item.qualifier }}</small>
      </span>
    </div>
  </div>
</template>

<style>
.pipeline-description-tooltip.v-tooltip__content {
  background: #3a3a3a !important;
  opacity: 1 !important;
}
</style>

<style scoped>
.pipeline-type-indicators {
  border-top: 1px solid #888888;
  margin-top: 5px;
  padding: 10px 0;
  display: flex;
  justify-content: left;
  align-items: center;
  gap: 10px;
}

.pipeline-type {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
</style>
