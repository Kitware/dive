<script lang="ts">
import { defineComponent } from 'vue';

import { GirderSearch } from '@girder/components';
import NavigationTitle from 'dive-common/components/NavigationTitle.vue';
import UserGuideButton from 'dive-common/components/UserGuideButton.vue';

import { useBrand } from '../store/useBrand';
import { useConfig } from '../store/useConfig';
import { useLocation } from '../store/useLocation';
import JobsTab from './JobsTab.vue';

export default defineComponent({
  name: 'GenericNavigationBar',
  components: {
    NavigationTitle,
    UserGuideButton,
    JobsTab,
    GirderSearch,
  },
  inject: ['girderRest'],
  setup() {
    const { brandData } = useBrand();
    const { pipelinesEnabled, trainingEnabled } = useConfig();
    const { locationRoute, setRouteFromLocation } = useLocation();

    return {
      brandData,
      pipelinesEnabled,
      trainingEnabled,
      locationRoute,
      setRouteFromLocation,
    };
  },
  computed: {
    isAdmin() {
      if (this.girderRest) {
        return this.girderRest?.user?.admin || false;
      }
      return false;
    },
  },
  mounted() {
    this.girderRest.on('userLoggedOut', this.onLogout);
  },
  beforeUnmount() {
    this.girderRest.off('userLoggedOut', this.onLogout);
  },
  methods: {
    onLogout() {
      this.$router.push({ name: 'login' });
    },
    logout() {
      this.girderRest.logout();
    },
  },
});
</script>

<template>
  <div>
    <v-app-bar app>
      <div class="dive-nav-brand">
        <NavigationTitle :name="brandData.name" />
        <v-tabs
          stacked
          color="accent"
          class="viewer-nav-tabs"
        >
          <v-tab
            exact
            :to="locationRoute"
          >
            Data
            <v-icon>mdi-database</v-icon>
          </v-tab>
          <JobsTab />
          <v-tab
            v-if="pipelinesEnabled || trainingEnabled"
            to="/trained-models"
          >
            Models <v-icon>mdi-brain</v-icon>
          </v-tab>
          <v-tab
            v-if="isAdmin"
            to="/admin"
          >
            Admin <v-icon>mdi-badge-account</v-icon>
          </v-tab>
        </v-tabs>
      </div>
      <v-spacer />
      <GirderSearch
        :search-types="['user', 'folder']"
        placeholder="search"
        hide-options-menu
        hide-search-icon
        class="mx-2 grow"
        @select="setRouteFromLocation"
      />
      <user-guide-button />
      <v-btn
        variant="text"
        @click="logout"
      >
        Logout
      </v-btn>
    </v-app-bar>
    <v-banner
      v-if="brandData.alertMessage"
      color="warning"
      app
    >
      <v-icon
        class="pr-2"
        large
      >
        mdi-alert-circle
      </v-icon>
      {{ brandData.alertMessage }}
    </v-banner>
  </div>
</template>
