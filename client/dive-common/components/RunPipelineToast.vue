<script lang="ts">
import { computed, defineComponent, PropType } from 'vue';
import { Pipe } from 'dive-common/apispec';

export default defineComponent({
  name: 'RunPipelineToast',

  props: {
    pipeline: {
      type: Object as PropType<Pipe>,
      required: true,
    },
  },

  setup(props) {
    function getPipelineTypeIcon(type: string | undefined): string {
      if (!type) {
        return '';
      }

      switch (type.toUpperCase()) {
        case 'IMAGE':
          return 'mdi-image';
        case 'VIDEO':
          return 'mdi-video-vintage';
        case 'TEXT':
          return 'mdi-format-text';
        case 'BBOX':
          return 'mdi-vector-square';
        case 'FULL-SIZE-BBOX':
          return 'mdi-square-outline';
        case 'HEAD-TAIL':
          return 'mdi-vector-line';
        case 'MASK':
          return 'mdi-vector-polygon';
        case 'TRACK':
          return 'mdi-gesture';
        default:
          return type;
      }
    }

    const inputIcon = computed(() => getPipelineTypeIcon(props.pipeline.metadata?.inputType));
    const outputIcon = computed(() => getPipelineTypeIcon(props.pipeline.metadata?.outputType));

    return {
      inputIcon,
      outputIcon,
    };
  },
});
</script>

<template>
  <div>
    <span>{{ pipeline.metadata?.description }}</span>
    <div class="pipeline-type-indicators" v-if="pipeline.metadata?.inputType && pipeline.metadata?.outputType">
      <v-icon>
        {{ inputIcon }}
      </v-icon>

      <v-icon>
        mdi-arrow-right
      </v-icon>

      <v-icon>
        {{ outputIcon }}
      </v-icon>
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
  gap: 10px;
}
</style>
