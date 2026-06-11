<script>
import { defineComponent } from 'vue';

import AddOns from './Admin/Addons.vue';
import AdminRecents from './Admin/AdminRecents.vue';
import UserRecents from './Admin/UserRecents.vue';
import AdminJobs from './Admin/AdminJobs.vue';
import AdminBranding from './Admin/AdminBranding.vue';
import AdminStats from './Admin/AdminStats.vue';
import AdminUpdate from './Admin/AdminUpdate.vue';

export default defineComponent({
  name: 'AdminPage',
  components: {
    AddOns,
    AdminRecents,
    UserRecents,
    AdminJobs,
    AdminBranding,
    AdminStats,
    AdminUpdate,
  },
  props: {
  },

  data() {
    return {
      currentTab: null,
    };
  },
});
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
          <v-tab> Stats </v-tab>
          <v-tab> Update </v-tab>
        </v-tabs>
      </v-card-title>
      <v-window v-model="currentTab">
        <v-window-item>
          <AdminRecents />
        </v-window-item>
        <v-window-item>
          <UserRecents />
        </v-window-item>
        <v-window-item>
          <AdminJobs />
        </v-window-item>
        <v-window-item>
          <AddOns @addon-job-run="currentTab = 2" />
        </v-window-item>
        <v-window-item>
          <AdminBranding />
        </v-window-item>
        <v-window-item>
          <AdminStats />
        </v-window-item>
        <v-window-item>
          <AdminUpdate />
        </v-window-item>
      </v-window>

      <v-card-text />
    </v-card>
  </v-container>
</template>
