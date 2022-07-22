<script>

import AddOns from './Admin/Addons.vue';

export default {
  name: 'AdminPage',
  components: {
    AddOns,
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
          <v-tab> AddOns </v-tab>
          <v-tab> Recents </v-tab>
          <v-tab> Jobs </v-tab>
          <v-tab> data </v-tab>
        </v-tabs>
      </v-card-title>
      <v-tabs-items v-model="currentTab">
        <v-tab-item>
          <AddOns />
        </v-tab-item>
        <v-tab-item>
          <span>holder</span>
        </v-tab-item>
        <v-tab-item>
          <span>holder</span>
        </v-tab-item>
        <v-tab-item>
          <span>holder</span>
        </v-tab-item>

        <v-tab-item>
          <v-card-text>
            Below are actions that can be performed by an admin
          </v-card-text>
        </v-tab-item>
      </v-tabs-items>

      <v-card-text />
    </v-card>
  </v-container>
</template>
