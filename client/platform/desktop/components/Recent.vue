<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import NavigationTitle from 'viame-web-common/components/NavigationTitle.vue';
import { openFromDisk } from '../api/main';
import { getRecents } from '../store/dataset';

export default defineComponent({
  components: {
    NavigationTitle,
  },
  setup(_, { root }) {
    const recents = getRecents().splice(0, 20);
    async function open() {
      const ret = await openFromDisk();
      if (!ret.canceled) {
        root.$router.push({
          name: 'viewer',
          params: { path: ret.filePaths[0] },
        });
      }
    }
    return { open, recents };
  },
});
</script>

<template>
  <v-main>
    <v-app-bar app>
      <NavigationTitle>VIAME Desktop</NavigationTitle>
      <v-tabs
        icons-and-text
        color="accent"
      >
        <v-tab
          :to="{ name: 'recent' }"
        >
          Recents
          <v-icon>mdi-folder-multiple</v-icon>
        </v-tab>
        <v-tab to="/settings">
          Settings<v-icon>mdi-settings</v-icon>
        </v-tab>
      </v-tabs>
      <v-spacer />
      <v-btn
        large
        color="primary"
        @click="open"
      >
        Open Folder
        <v-icon class="ml-2">
          mdi-folder-open
        </v-icon>
      </v-btn>
    </v-app-bar>
    <v-container>
      <h1 class="text-h3 pa-2">
        Recent datasets
      </h1>
      <v-card class="pa-4 my-4">
        <div
          v-for="recent in recents"
          :key="recent"
          class="pa-2"
        >
          <h2 class="text-body-1">
            <v-icon class="pr-2">
              mdi-folder
            </v-icon>
            <span>{{ recent }}</span>
            <v-btn
              x-small
              color="primary"
              class="mx-2"
              :to="{ name: 'viewer', params: { path: recent } }"
            >
              Launch Annotator
            </v-btn>
          </h2>
        </div>
      </v-card>
    </v-container>
  </v-main>
</template>
