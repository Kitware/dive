<script>
import NavigationBar from '@/components/NavigationBar.vue';
import JobList from '@girder/components/src/components/Job/JobList.vue';

export default {
  name: 'Jobs',
  components: { NavigationBar, JobList },
};
</script>

<template>
  <v-content>
    <NavigationBar />
    <v-container>
      <JobList />
    </v-container>
  </v-content>
</template>
