<script lang="ts">
import {
  computed,
  defineComponent, ref, Ref,
} from '@vue/composition-api';
import { getAddons, postAddons } from 'platform/web-girder/api/configuration.service';


export default defineComponent({
  name: 'AddOns',
  setup() {
    const table: Ref<[string, string, string][]> = ref([]);
    const forceDownload = ref(false);
    const selected: Ref<{Name: string; Description: string}[]> = ref([]);
    const headers: Ref<{text: string; value: string}[]> = ref([
      { text: 'Name', value: 'Name' },
      { text: 'Description', value: 'Description' },
    ]);
    // First we need to download the CSV from github
    const getData = async () => {
      table.value = (await getAddons()).data;
    };
    const data = computed(() => table.value.map(
      (item) => ({ Name: item[0], Description: item[2] }),
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
          Below is a list of the available addons for VIAME.
          Their current checked state is not an indication if
          they are installed or not, just if you want to download and install the addons.
          If you don't use the "Force Download" switch it won't attempt
          to download addons which are already installed
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
        />
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
