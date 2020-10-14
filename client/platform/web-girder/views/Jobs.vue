<script>
import JobList from '@girder/components/src/components/Job/JobList.vue';

import NavigationBar from './NavigationBar.vue';

export default {
  name: 'Jobs',
  components: { NavigationBar, JobList },
};
</script>

<template>
  <v-main>
    <NavigationBar />
    <v-container>
      <JobList />
    </v-container>
  </v-main>
</template>
