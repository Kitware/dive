<script>
import JobList from '@girder/components/src/components/Job/JobList.vue';

export default {
  name: 'Jobs',
  components: { JobList },
};
</script>

<template>
  <v-container>
    <JobList />
  </v-container>
</template>
