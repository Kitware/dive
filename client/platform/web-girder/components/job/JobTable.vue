<script lang="ts">
import { computed, defineComponent } from 'vue';

import { formatJob } from './jobFormatter';
import JobProgress from './JobProgress.vue';

export default defineComponent({
  name: 'JobTable',
  components: { JobProgress },
  props: {
    jobs: {
      type: Array,
      required: true,
    },
    options: {
      type: Object,
      required: true,
    },
    morePages: {
      type: Boolean,
      default: true,
    },
  },
  emits: ['update:options', 'job-click'],
  setup(props, { slots }) {
    const headers = [
      { title: 'Job Title', key: 'title' },
      { title: 'Type', key: 'type' },
      { title: 'Last Updated', key: 'updated' },
      { title: 'Status', key: 'status' },
    ];

    const items = computed(() => (props.jobs as Record<string, unknown>[]).map(formatJob));

    const pageRange = computed(() => {
      const opts = props.options as { itemsPerPage: number; page: number };
      const first = (opts.itemsPerPage * (opts.page - 1)) + 1;
      const last = (first + props.jobs.length) - 1;
      return { first, last };
    });

    const serverItemsLength = computed(() => {
      let { last } = pageRange.value;
      if (props.morePages) {
        last += 1;
      }
      return last;
    });

    const tableHeaders = computed(() => (
      slots.jobwidget
        ? [...headers, {
          title: '', key: 'jobwidget', sortable: false, align: 'end' as const,
        }]
        : headers
    ));

    return {
      items,
      pageRange,
      serverItemsLength,
      tableHeaders,
    };
  },
});
</script>

<template>
  <v-data-table-server
    :headers="tableHeaders"
    :items="items"
    :items-length="serverItemsLength"
    :items-per-page="options.itemsPerPage"
    :page="options.page"
    :sort-by="options.sortBy"
    item-value="_id"
    @update:options="$emit('update:options', $event)"
  >
    <template #item.title="{ item }">
      <span
        class="one-line"
        @click="$emit('job-click', $event, item)"
      >{{ item.title }}</span>
    </template>
    <template #item.type="{ item }">
      <span class="one-line">{{ item.type }}</span>
    </template>
    <template #item.updated="{ item }">
      <span class="one-line">{{ item.updateString }}</span>
    </template>
    <template #item.status="{ item }">
      <job-progress :formatted-job="item" />
    </template>
    <template
      v-if="$slots.jobwidget"
      #item.jobwidget="slotProps"
    >
      <slot
        name="jobwidget"
        v-bind="slotProps"
      />
    </template>
    <template #bottom>
      <div class="v-datatable__actions__options pa-2">
        {{ pageRange.first }}-{{ pageRange.last }}
      </div>
    </template>
  </v-data-table-server>
</template>

<style lang="scss" scoped>
.one-line {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
