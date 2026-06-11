<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'JobProgress',
  props: {
    formattedJob: {
      type: Object,
      required: true,
    },
  },
});
</script>

<template>
  <div class="d-flex progress-bar align-center">
    <v-progress-linear
      :color="formattedJob.statusColor"
      :model-value="formattedJob.progressNumber"
      :indeterminate="!!formattedJob.indeterminate"
      class="mr-3"
      height="10"
    />
    <v-icon
      :color="formattedJob.statusColor"
      :class="formattedJob.class"
      :size="20"
      class="status-icon"
    >
      {{ formattedJob.statusIcon }}
    </v-icon>
  </div>
</template>

<style lang="scss" scoped>
.progress-bar {
  min-width: 150px;
}
</style>
