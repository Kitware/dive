<script lang="ts">
import {
  computed,
  defineComponent, ref, Ref,
} from '@vue/composition-api';
import { getRecentUsers } from 'platform/web-girder/api/admin.service';
import type { GirderModel } from '@girder/components/src';


export default defineComponent({
  name: 'UserRecents',
  setup() {
    const limit = ref(50);
    const offset = ref(0);
    const table: Ref<GirderModel[]> = ref([]);
    const selected: Ref<{Name: string; Description: string}[]> = ref([]);
    const headers: Ref<{text: string; value: string}[]> = ref([
      { text: 'Login', value: 'login' },
      { text: 'First', value: 'first' },
      { text: 'Last', value: 'last' },
      { text: 'Email', value: 'email' },
      { text: 'Created', value: 'created' },
      { text: 'Dir', value: 'dir' },
    ]);
    // First we need to download the CSV from github
    const getData = async () => {
      table.value = (await getRecentUsers(limit.value, offset.value)).data;
    };
    const data = computed(() => table.value.map(
      (item) => ({
        login: item.login,
        first: item.firstName,
        last: item.lastName,
        email: item.email,
        created: item.created,
        dir: item._id,
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
      <v-card-title> Recent Users </v-card-title>
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
          <template v-slot:item.dir="{ item }">
            <v-tooltip
              bottom
            >
              <template #activator="{on, attrs}">
                <v-btn
                  v-bind="attrs"
                  large
                  depressed
                  :to="`/user/${item.dir }`"
                  color="info"
                  class="ma-1"
                  v-on="on"
                >
                  <v-icon large>
                    mdi-account
                  </v-icon>
                </v-btn>
              </template>
              <span>Launch User Directory</span>
            </v-tooltip>
          </template>
          <template v-slot:item.created="{ item }">
            <span> {{ item.created }}</span>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>
