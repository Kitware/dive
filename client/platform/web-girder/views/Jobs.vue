<script lang="ts">
import { defineComponent, ref } from '@vue/composition-api';
import { GirderModel, GirderJobList } from '@girder/components/src';
import { setUsePrivateQueue } from 'platform/web-girder/api';
import { useGirderRest } from 'platform/web-girder/plugins/girder';

export default defineComponent({
  name: 'Jobs',
  components: { GirderJobList },
  setup() {
    const privateQueueEnabled = ref(false);
    const loading = ref(true);
    const restClient = useGirderRest();

    function getId(data: GirderModel | string) {
      try {
        if (typeof data === 'object') {
          return data.folderId;
        }
        return JSON.parse(data).params.input_folder;
      } catch (err) {
        return null;
      }
    }

    async function setPrivateQueueEnabled(value: boolean) {
      loading.value = true;
      const resp = await setUsePrivateQueue(restClient.user._id, value);
      privateQueueEnabled.value = resp.data.user_private_queue_enabled;
      loading.value = false;
    }

    restClient.fetchUser()
      .then((user) => {
        privateQueueEnabled.value = user.user_private_queue_enabled;
        loading.value = false;
      });

    return {
      privateQueueEnabled,
      loading,
      /* methods */
      getId,
      setPrivateQueueEnabled,
    };
  },
});
</script>

<template>
  <v-container :fluid="$vuetify.breakpoint.mdAndDown">
    <GirderJobList>
      <template #jobwidget="{ item }">
        <v-tooltip
          v-if="getId(item.kwargs)"
          bottom
        >
          <template #activator="{on, attrs}">
            <v-btn
              v-bind="attrs"
              x-small
              depressed
              :to="{ name: 'viewer', params: { id: getId(item.kwargs) } }"
              color="info"
              class="ml-0"
              v-on="on"
            >
              <v-icon small>
                mdi-eye
              </v-icon>
            </v-btn>
          </template>
          <span>Launch dataset viewer</span>
        </v-tooltip>
        <v-tooltip bottom>
          <template #activator="{on, attrs}">
            <v-btn
              v-bind="attrs"
              x-small
              depressed
              :href="`/girder/#job/${item._id}`"
              color="info"
              class="mx-2"
              v-on="on"
            >
              <v-icon small>
                mdi-text-box-outline
              </v-icon>
            </v-btn>
          </template>
          <span>View job logs and manage job</span>
        </v-tooltip>
        <span>{{ item.statusText.replace('Inactive', 'Queued') }}</span>
      </template>
    </GirderJobList>
    <v-card class="mt-4 pa-6">
      <v-card
        outlined
        class="mb-6"
      >
        <v-card-title>
          Shared Job Runner
        </v-card-title>
        <v-card-text>
          <p class="white--text">
            The job runner is shared between all users of this system and has
            limited GPU capacity. Jobs in queue will be processed in the order in
            which they are received.
          </p>
        </v-card-text>
      </v-card>
    </v-card>
  </v-container>
</template>

<style lang="scss" scoped>
.code-container {
  background-color: black;
  padding: 10px;
  border-radius: 5px;
}
</style>
