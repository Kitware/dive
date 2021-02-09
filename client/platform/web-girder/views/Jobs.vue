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
        <span>{{ item.statusText.replace('Inactive', 'Queued') }}</span>
        <v-btn
          x-small
          :href="`http://localhost:8010/girder/#job/${item._id}`"
          color="info"
          outlined
          class="mx-2"
        >
          Manage
        </v-btn>
      </template>
    </JobList>
    <v-card class="mt-4">
      <v-card-title class="text-h6">
        Job Runner Info
      </v-card-title>
      <v-card-text>
        <p>
          The job runner is shared between all users of this system and has
          limited GPU capacity.  Jobs in queue will be processed in the order in
          which they are received. You can run your own server and job runner with Docker
          using the instructions provided
          <a href="https://github.com/VIAME/dive/tree/master/docker">here</a>.
        </p>
      </v-card-text>
    </v-card>
  </v-container>
</template>
