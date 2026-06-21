<script lang="ts">
import { defineComponent } from 'vue';

import { GirderSearch } from '@girder/components/src';
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
  async created() {
    this.girderRest.$on('logout', this.onLogout);
  },
  beforeDestroy() {
    this.girderRest.$off('logout', this.onLogout);
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
      <NavigationTitle :name="brandData.name" />
      <v-tabs
        icons-and-text
        color="accent"
        class="mx-2"
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
        text
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
