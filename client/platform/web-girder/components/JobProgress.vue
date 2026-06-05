<script setup lang="ts">
defineProps<{
  formattedJob: {
    statusText: string;
    statusColor: string;
    statusTextColor?: string;
    statusIcon: string;
    progressNumber: number;
    indeterminate?: boolean;
    class?: string[];
  };
}>();
</script>

<template>
  <div class="d-flex align-center progress-bar">
    <v-progress-linear
      :model-value="formattedJob.progressNumber"
      :color="formattedJob.statusColor"
      :indeterminate="formattedJob.indeterminate"
      height="25"
      class="mr-2"
    >
      <template #default>
        <v-icon
          :color="formattedJob.statusTextColor"
          :class="formattedJob.class"
          size="small"
        >
          {{ formattedJob.statusIcon }}
        </v-icon>
        <strong :style="{ color: formattedJob.statusTextColor }">{{ formattedJob.statusText }}</strong>
      </template>
    </v-progress-linear>
  </div>
</template>

<style scoped>
.progress-bar {
  min-width: 150px;
}
</style>
