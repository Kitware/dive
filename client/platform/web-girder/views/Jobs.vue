<script>
import JobList from '@girder/components/src/components/Job/JobList.vue';

export default {
  name: 'Jobs',
  components: { JobList },
};
</script>

<template>
  <v-container>
    <JobList>
      <template #jobwidget="{ item }">
        <span>{{ item.statusText.replace('Inactive', 'In Queue') }}</span>
        <v-btn
          x-small
          :href="`/girder/#jobs/${item._id}`"
          color="info"
          outlined
          class="mx-2"
        >
          Manage
        </v-btn>
      </template>
    </JobList>
  </v-container>
</template>
