<script>
import { mapState } from 'vuex';

import NavigationTitle from 'viame-web-common/components/NavigationTitle.vue';
import UserGuideButton from 'viame-web-common/components/UserGuideButton.vue';

import JobsTab from './JobsTab.vue';
import { getPathFromLocation } from '../utils';

export default {
  name: 'GenericNavigationBar',
  components: {
    NavigationTitle,
    UserGuideButton,
    JobsTab,
  },
  inject: ['girderRest'],
  data: () => ({
    runningJobIds: [],
  }),
  computed: {
    ...mapState('Location', ['location', 'brandData']),
  },
  async created() {
    this.girderRest.$on('logout', this.onLogout);
  },
  beforeDestroy() {
    this.girderRest.$off('logout', this.onLogout);
  },
  methods: {
    getPathFromLocation,
    onLogout() {
      this.$router.push({ name: 'login' });
    },
    logout() {
      this.girderRest.logout();
    },
  },
};
</script>

<template>
  <v-app-bar app>
    <NavigationTitle :name="brandData.name" />
    <v-tabs
      icons-and-text
      color="accent"
    >
      <v-tab
        :to="getPathFromLocation(location)"
      >
        Data<v-icon>mdi-database</v-icon>
      </v-tab>
      <JobsTab />
      <v-tab to="/settings">
        Settings<v-icon>mdi-settings</v-icon>
      </v-tab>
    </v-tabs>
    <v-spacer />
    <user-guide-button />
    <v-btn
      text
      @click="logout"
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
