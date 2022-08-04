<script>

import AddOns from './Admin/Addons.vue';
import AdminRecents from './Admin/AdminRecents.vue';
import UserRecents from './Admin/UserRecents.vue';
import AdminJobs from './Admin/AdminJobs.vue';
import AdminBranding from './Admin/AdminBranding.vue';

export default {
  name: 'AdminPage',
  components: {
    AddOns,
    AdminRecents,
    UserRecents,
    AdminJobs,
    AdminBranding,
  },
  props: {
  },

  data() {
    return {
      currentTab: null,
    };
  },
};
</script>

<template>
  <v-container>
    <v-card class="mt-4">
      <v-card-title class="text-h6">
        <v-tabs v-model="currentTab">
          <v-tab> Recents </v-tab>
          <v-tab> Users </v-tab>
          <v-tab> Jobs </v-tab>
          <v-tab> Addons </v-tab>
          <v-tab> Branding </v-tab>
        </v-tabs>
      </v-card-title>
      <v-tabs-items v-model="currentTab">
        <v-tab-item>
          <AdminRecents />
        </v-tab-item>
        <v-tab-item>
          <UserRecents />
        </v-tab-item>
        <v-tab-item>
          <AdminJobs />
        </v-tab-item>
        <v-tab-item>
          <AddOns @addon-job-run="currentTab = 2" />
        </v-tab-item>
        <v-tab-item>
          <AdminBranding />
        </v-tab-item>
      </v-tabs-items>

      <v-card-text />
    </v-card>
  </v-container>
</template>
