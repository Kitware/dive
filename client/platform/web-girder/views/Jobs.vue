<script lang="ts">
import {
  defineComponent, ref, toRef, watch,
} from '@vue/composition-api';
import { GirderJobList } from '@girder/components/src';
import { setUsePrivateQueue } from 'platform/web-girder/api';
import { useGirderRest } from 'platform/web-girder/plugins/girder';
import { useStore } from '../store/types';

export default defineComponent({
  name: 'Jobs',
  components: { GirderJobList },
  setup() {
    const privateQueueEnabled = ref(false);
    const loading = ref(true);
    const restClient = useGirderRest();
    const store = useStore();
    const outstandingJobs = ref(0);

    watch(toRef(store.getters, 'Jobs/runningJobIds'), () => {
      restClient.get('job/queued').then(({ data }) => {
        outstandingJobs.value = data.outstanding;
      });
    });

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
    restClient.get('job/queued').then(({ data }) => {
      outstandingJobs.value = data.outstanding;
    });

    return {
      privateQueueEnabled,
      loading,
      outstandingJobs,
      /* methods */
      setPrivateQueueEnabled,
    };
  },
});
</script>

<template>
  <v-container :fluid="$vuetify.breakpoint.mdAndDown">
    <v-alert
      v-if="outstandingJobs"
      type="warning"
    >
      There are {{ outstandingJobs }} jobs currently in the job queue (including yours).
      Jobs will be processed in the order in which they are received.
    </v-alert>
    <GirderJobList>
      <template #jobwidget="{ item }">
        <v-tooltip
          v-if="item.dataset_id"
          bottom
        >
          <template #activator="{on, attrs}">
            <v-btn
              v-bind="attrs"
              x-small
              depressed
              :to="{ name: 'viewer', params: { id: item.dataset_id } }"
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
      <v-card
        outlined
      >
        <v-card-title>
          Private Job runner
        </v-card-title>
        <v-card-text>
          <p class="white--text">
            You can run your own personal, dedicated job runner anywhere you have
            compute resources. This could be a lab workstation or a cloud environment like
            Google Cloud. You'll need a local installtion of VIAME.
          </p>
          <v-switch
            :input-value="privateQueueEnabled"
            :loading="loading"
            :disabled="loading"
            label="Enable private runner queue"
            hide-details
            @change="setPrivateQueueEnabled"
          />
          <v-alert
            v-if="privateQueueEnabled"
            type="warning"
            class="my-5"
            outlined
          >
            You have enabled the private queue. Jobs created by your user
            account must be processed by a private runner, and will remain
            queued until you configure one.
          </v-alert>
        </v-card-text>
        <v-card-title>
          Complete documentation
        </v-card-title>
        <v-card-text>
          <v-btn
            depressed
            class="mr-3"
            href="https://kitware.github.io/dive/Deployment-Overview/"
          >
            Deployment documentation
          </v-btn>
          <v-btn
            depressed
            href="https://kitware.github.io/dive/Deployment-Docker-Compose/"
          >
            Docker docs
          </v-btn>
        </v-card-text>
        <v-card-title>
          Docker Quickstart
        </v-card-title>
        <v-card-text>
          <p class="white--text">
            Run the worker container under nvidia-docker.
          </p>
          <pre class="code-container">docker run --rm --name dive_worker \
      --gpus all \
      --ipc host \
      --volume "/opt/noaa/viame:/tmp/addons/extracted:ro" \
      -e "DIVE_USERNAME=username" \
      -e "DIVE_PASSWORD=CHANGEME" \
      kitware/viame-worker:latest</pre>
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
