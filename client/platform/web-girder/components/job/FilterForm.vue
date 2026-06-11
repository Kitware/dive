<script lang="ts">
import { computed, defineComponent } from 'vue';

import { getByValue } from './status';

export default defineComponent({
  name: 'JobFilterForm',
  props: {
    jobType: {
      type: [String, Object],
      default: null,
    },
    jobTypeList: {
      type: Array,
      default: () => [],
    },
    status: {
      type: [Number, Object],
      default: null,
    },
    statusList: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['update:jobType', 'update:status'],
  setup(props) {
    const statusItemList = computed(() => (props.statusList as number[])
      .map((value) => getByValue(value))
      .filter((s) => s && s.text)
      .sort((a, b) => {
        if (a.text > b.text) return 1;
        if (a.text < b.text) return -1;
        return 0;
      }));

    return { statusItemList };
  },
});
</script>

<template>
  <v-card
    class="job-filter"
    color="primary"
  >
    <v-card-title>
      <v-container>
        <h4>Jobs</h4>
        <v-row justify="center">
          <v-col
            sm="5"
            md="4"
          >
            <v-select
              :items="jobTypeList"
              :model-value="jobType"
              :menu-props="{ contentClass: 'girder-job-filter-form-menu' }"
              label="Job Type"
              clearable
              color="white"
              density="compact"
              @update:model-value="$emit('update:jobType', $event ? $event : null)"
            />
          </v-col>
          <v-col
            sm="5"
            md="4"
          >
            <v-select
              :items="statusItemList"
              :model-value="status"
              item-title="text"
              item-value="value"
              :menu-props="{ contentClass: 'girder-job-filter-form-menu' }"
              label="Status"
              clearable
              color="white"
              density="compact"
              @update:model-value="$emit('update:status', $event !== null && $event !== undefined ? $event : null)"
            />
          </v-col>
        </v-row>
      </v-container>
    </v-card-title>
  </v-card>
</template>
