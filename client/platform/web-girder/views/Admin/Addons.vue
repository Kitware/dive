<script lang="ts">
import {
  computed,
  defineComponent, ref, Ref,
} from '@vue/composition-api';
import { getAddons, postAddons } from 'platform/web-girder/api/configuration.service';


export default defineComponent({
  name: 'AddOns',
  setup(props, { emit }) {
    const table: Ref<[string, string, string, boolean][]> = ref([]);
    const forceDownload = ref(false);
    const selected: Ref<{Name: string; Description: string; Installed: boolean}[]> = ref([]);
    const headers: Ref<{text: string; value: string}[]> = ref([
      { text: 'Name', value: 'Name' },
      { text: 'Description', value: 'Description' },
      { text: 'Installed', value: 'Installed' },
    ]);
    // First we get the Addons from the /dive_configuration/addons endpoint
    const getData = async () => {
      table.value = (await getAddons()).data;
    };
    const data = computed(() => table.value.map(
      (item) => ({ Name: item[0], Description: item[2], Installed: item[3] }),
    ));
    getData();

    const downloadAddons = async () => {
      // Lets create a list of URLS to download to add
      const downloadArray = selected.value.map((item) => {
        const found = table.value.find((tabItem) => tabItem[0] === item.Name);
        if (found !== undefined) {
          return found[1];
        }
        return null;
      });
      const list = downloadArray.filter((item) => item !== null) as string[];
      if (list.length) {
        postAddons(list, forceDownload.value);
        emit('addon-job-run');
      }
    };
    return {
      selected,
      table,
      headers,
      data,
      forceDownload,
      downloadAddons,
    };
  },

});
</script>

<template>
  <v-container>
    <v-card>
      <v-card-title> AddOns </v-card-title>
      <v-card-text>
        <p>
          Below is a list of the available configuration addons for working with VIAME.
          Select the addons you want to download and install. If an addon is already installed
          and you want to install again you must use the 'Force Download' switch
        </p>
        <v-data-table
          v-model="selected"
          :headers="headers"
          :items="data"
          :single-select="false"
          item-key="Name"
          :items-per-page="-1"
          hide-default-footer
          show-select
          class="elevation-1"
        >
          <template v-slot:item.Installed="{ item }">
            <v-icon
              large
              :color="item.Installed ? 'success' : 'error'"
            >
              {{ item.Installed ? 'mdi-check' : 'mdi-cancel' }}
            </v-icon>
          </template>
        </v-data-table>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-switch
          v-model="forceDownload"
          label="Force Download"
        />
        <v-btn
          color="success"
          class="ml-2"
          :disabled="!selected.length"
          @click="downloadAddons"
        >
          Add Selected
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-container>
</template>
