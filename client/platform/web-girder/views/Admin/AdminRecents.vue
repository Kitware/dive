<script lang="ts">
import {
  computed,
  defineComponent, ref, Ref,
} from '@vue/composition-api';
import { getRecentDatasets } from 'platform/web-girder/api/admin.service';
import type { GirderModel } from '@girder/components/src';
import moment from 'moment';


export default defineComponent({
  name: 'AdminRecents',
  setup() {
    const limit = ref(50);
    const offset = ref(0);
    const table: Ref<GirderModel[]> = ref([]);
    const selected: Ref<{Name: string; Description: string}[]> = ref([]);
    const headers: Ref<{text: string; value: string}[]> = ref([
      { text: 'Owner', value: 'owner' },
      { text: 'User Dir', value: 'userDir' },
      { text: 'Name', value: 'name' },
      { text: 'Created', value: 'created' },
      { text: 'Type', value: 'type' },
      { text: 'Dataset', value: 'dataset' },
    ]);
    const getData = async () => {
      table.value = (await getRecentDatasets(limit.value, offset.value)).data;
    };
    const data = computed(() => table.value.map(
      (item) => ({
        owner: item.ownerLogin,
        userDir: item.creatorId,
        name: item.name,
        created: moment(item.created).format('dddd, MMMM D, YYYY @ h:mm a'),
        type: item.meta.type,
        dataset: item._id,
      }),
    ));
    getData();

    return {
      selected,
      table,
      headers,
      data,
    };
  },

});
</script>

<template>
  <v-container>
    <v-card>
      <v-card-title> Recent Datasets </v-card-title>
      <v-card-text>
        <v-data-table
          v-model="selected"
          :headers="headers"
          :items="data"
          item-key="Name"
          :items-per-page="-1"
          hide-default-footer
          class="elevation-1"
        >
          <template v-slot:item.userDir="{ item }">
            <v-tooltip
              bottom
            >
              <template #activator="{on, attrs}">
                <v-btn
                  v-bind="attrs"
                  small
                  depressed
                  :to="`/user/${item.userDir}`"
                  color="info"
                  class="ma-1"
                  v-on="on"
                >
                  <v-icon small>
                    mdi-account
                  </v-icon>
                </v-btn>
              </template>
              <span>Launch User Directory</span>
            </v-tooltip>
          </template>
          <template v-slot:item.type="{ item }">
            <v-icon> {{ item.type === 'video' ? 'mdi-file-video' : 'mdi-camera-burst' }}</v-icon>
          </template>

          <template v-slot:item.dataset="{ item }">
            <v-btn
              color="primary"
              :to="`/viewer/${item.dataset}`"
            >
              Open Dataset
            </v-btn>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>
