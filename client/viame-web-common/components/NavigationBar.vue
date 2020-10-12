<script>
import { mapState } from 'vuex';
import { all } from '@girder/components/src/components/Job/status';

import NavigationTitle from 'viame-web-common/components/NavigationTitle.vue';
import UserGuideButton from 'viame-web-common/components/UserGuideButton.vue';
import { getPathFromLocation } from 'viame-web-common/utils';

export default {
  name: 'GenericNavigationBar',
  components: {
    NavigationTitle,
    UserGuideButton,
  },
  inject: ['girderRest', 'notificationBus'],
  data: () => ({
    runningJobIds: [],
  }),
  computed: {
    ...mapState('Location', ['location']),
  },
  async created() {
    const jobStatus = all();
    const { data: runningJobs } = await this.girderRest.get('/job', {
      params: {
        statuses: `[${jobStatus.RUNNING.value}]`,
      },
    });
    this.runningJobIds = runningJobs.map((job) => job._id);
    this.notificationBus.$on('message:job_status', this.handleNotification);
    this.girderRest.$on('logout', this.onLogout);
  },
  beforeDestroy() {
    this.girderRest.$off('logout', this.onLogout);
    this.notificationBus.$off('message:job_status', this.handleNotification);
  },
  methods: {
    getPathFromLocation,
    onLogout() {
      this.$router.push({ name: 'login' });
    },
    handleNotification({ data: job }) {
      const jobStatus = all();
      const jobId = job._id;
      switch (job.status) {
        case jobStatus.RUNNING.value:
          if (this.runningJobIds.indexOf(jobId) === -1) {
            this.runningJobIds.push(jobId);
          }
          break;
        case jobStatus.SUCCESS.value:
          // fall through
        case jobStatus.ERROR.value:
          if (this.runningJobIds.indexOf(jobId) !== -1) {
            this.runningJobIds.splice(this.runningJobIds.indexOf(jobId), 1);
          }
          break;
        default:
          break;
      }
    },
  },
};
</script>

<template>
  <v-app-bar app>
    <NavigationTitle>VIAME</NavigationTitle>
    <v-tabs
      icons-and-text
      color="accent"
    >
      <v-tab
        :to="getPathFromLocation(location)"
      >
        Data<v-icon>mdi-database</v-icon>
      </v-tab>
      <v-tab to="/jobs">
        Jobs
        <v-badge
          :value="runningJobIds.length"
          overlap
          bottom
          offset-x="-6"
          offset-y="16"
        >
          <template slot="badge">
            <v-icon
              dark
              class="rotate"
            >
              mdi-autorenew
            </v-icon>
          </template>
          <v-icon>mdi-format-list-checks</v-icon>
        </v-badge>
      </v-tab>
      <v-tab to="/settings">
        Settings<v-icon>mdi-settings</v-icon>
      </v-tab>
    </v-tabs>
    <v-spacer />
    <user-guide-button />
    <v-btn
      text
      @click="girderRest.logout()"
    >
      Logout
    </v-btn>
  </v-app-bar>
</template>

<style lang="scss">
.rotate {
  animation: rotation 1.5s infinite linear;
}

@keyframes rotation {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(359deg);
  }
}
</style>
