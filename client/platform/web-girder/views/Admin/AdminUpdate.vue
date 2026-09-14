<script lang="ts">
import {
  defineComponent, onBeforeMount, ref,
} from 'vue';
import { isAxiosError } from 'axios';
import {
  DEFAULT_JOBS_DISABLED_MESSAGE,
  putJobsDisabled,
  updateContainers,
} from 'platform/web-girder/api/configuration.service';
import { useConfig } from 'platform/web-girder/store/useConfig';

export default defineComponent({
  name: 'AdminUpdate',
  setup() {
    const {
      jobsDisabled: configJobsDisabled,
      jobsDisabledMessage: configJobsDisabledMessage,
      loadConfig,
      setJobsDisabled,
      setJobsDisabledMessage,
    } = useConfig();

    const loading = ref(false);
    const complete = ref('');
    const reloadTime = ref(0);
    const savingJobsDisabled = ref(false);
    const jobsDisabled = ref(false);
    const jobsDisabledMessage = ref(DEFAULT_JOBS_DISABLED_MESSAGE);
    const jobsDisabledSaved = ref(false);

    onBeforeMount(async () => {
      await loadConfig();
      jobsDisabled.value = configJobsDisabled.value;
      jobsDisabledMessage.value = configJobsDisabledMessage.value || DEFAULT_JOBS_DISABLED_MESSAGE;
    });

    const update = async () => {
      loading.value = true;
      try {
        await updateContainers();
        loading.value = false;
        complete.value = 'Already Updated';
      } catch (error) {
        // When it is good the container restarts resulting a badgateway 502 error
        // We should wait like 20 seconds after the error and reload the page to show the update
        if (isAxiosError(error) && error.response && error.response.status === 502) {
          complete.value = 'Reload';
          reloadTime.value = 20;
          setInterval(() => {
            reloadTime.value -= 1;
            if (reloadTime.value === 0) {
              // eslint-disable-next-line no-restricted-globals
              location.reload();
            }
          }, 1000);
        }
      }
    };

    const saveJobsDisabled = async () => {
      savingJobsDisabled.value = true;
      jobsDisabledSaved.value = false;
      try {
        const message = jobsDisabledMessage.value.trim() || DEFAULT_JOBS_DISABLED_MESSAGE;
        const { data } = await putJobsDisabled({
          disabled: jobsDisabled.value,
          message,
        });
        jobsDisabled.value = data.disabled;
        jobsDisabledMessage.value = data.message || DEFAULT_JOBS_DISABLED_MESSAGE;
        setJobsDisabled(data.disabled);
        setJobsDisabledMessage(data.message);
        jobsDisabledSaved.value = true;
      } finally {
        savingJobsDisabled.value = false;
      }
    };

    return {
      update,
      loading,
      complete,
      reloadTime,
      jobsDisabled,
      jobsDisabledMessage,
      savingJobsDisabled,
      jobsDisabledSaved,
      saveJobsDisabled,
      DEFAULT_JOBS_DISABLED_MESSAGE,
    };
  },
});
</script>

<template>
  <v-container>
    <v-card class="mb-4">
      <v-card-title> Disable Jobs </v-card-title>
      <v-card-text>
        <p>
          Temporarily prevent users from launching new pipeline and training jobs
          while updates are performed. Disabled job buttons are grayed out and show
          the message below as a tooltip.
        </p>
        <v-switch
          v-model="jobsDisabled"
          label="Disable running jobs"
          color="warning"
          hide-details
          class="mb-4"
        />
        <v-textarea
          v-model="jobsDisabledMessage"
          label="Disabled jobs message"
          :placeholder="DEFAULT_JOBS_DISABLED_MESSAGE"
          rows="2"
          auto-grow
          outlined
          clearable
          hint="Shown as a tooltip on disabled Run Pipeline and Run Training buttons"
          persistent-hint
        />
        <v-alert
          v-if="jobsDisabledSaved"
          type="success"
          dense
          class="mt-4"
        >
          Job disable settings saved.
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          color="warning"
          class="ml-2"
          :loading="savingJobsDisabled"
          @click="saveJobsDisabled"
        >
          Save Job Settings
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-card>
      <v-card-title> Update </v-card-title>
      <v-card-text>
        <p style="font-size:1.5em">
          Below is a button that will pull the latest images from the Docker
          repository and redeploy the server. The server will temporarily stop
          for a few seconds while it relaunches. Please ensure that no jobs are
          running when you press this button.
        </p>
        <v-alert
          v-if="complete == 'Reload'"
          type="warning"
        >
          <h2>
            Update is complete: Reloading the page in {{ reloadTime }} seconds
          </h2>
        </v-alert>
        <v-alert
          v-if="complete == 'Already Updated'"
          type="info"
        >
          <h2>
            The system is already up to date and doesn't need to pull the latest containers.
          </h2>
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          color="primary"
          class="ml-2"
          :disabled="!!complete"
          @click="update"
        >
          <v-icon>
            {{ loading ? "mdi-spin mdi-sync" : "" }}
          </v-icon>

          Update
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-container>
</template>
