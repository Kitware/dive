<script>
import { mapMutations, mapState } from 'vuex';

import { GirderSearch } from '@girder/components/src';
import NavigationTitle from 'dive-common/components/NavigationTitle.vue';
import UserGuideButton from 'dive-common/components/UserGuideButton.vue';

import JobsTab from './JobsTab.vue';
import { getPathFromLocation } from '../utils';

export default {
  name: 'GenericNavigationBar',
  components: {
    NavigationTitle,
    UserGuideButton,
    JobsTab,
    GirderSearch,
  },
  inject: ['girderRest'],
  data: () => ({
    runningJobIds: [],
  }),
  computed: {
    ...mapState('Location', ['location']),
    ...mapState('Brand', ['brandData']),
  },
  async created() {
    this.girderRest.$on('logout', this.onLogout);
  },
  beforeDestroy() {
    this.girderRest.$off('logout', this.onLogout);
  },
  methods: {
    getPathFromLocation,
    ...mapMutations('Location', ['setLocation']),
    goto(loc) {
      this.$router.push({ name: 'home', params: loc });
      this.setLocation(loc);
    },
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
        exact
        :to="getPathFromLocation(location)"
      >
        Data
        <v-icon>mdi-database</v-icon>
      </v-tab>
      <JobsTab />
    </v-tabs>
    <v-spacer />
    <GirderSearch
      :search-types="['user', 'folder']"
      placeholder="search"
      hide-options-menu
      hide-search-icon
      class="mx-2 grow"
      @select="goto($event)"
    />
    <v-btn
      text
      :to="{ name: 'summary' }"
    >
      <v-icon class="pr-2">
        mdi-format-list-bulleted-square
      </v-icon>
      Stats
    </v-btn>
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
