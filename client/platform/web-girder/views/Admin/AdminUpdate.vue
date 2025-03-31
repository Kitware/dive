<script lang="ts">
import { defineComponent, ref } from 'vue';
import { updateContainers } from 'platform/web-girder/api/configuration.service';

export default defineComponent({
  name: 'AdminUpdate',
  setup() {
    const loading = ref(false);
    const complete = ref('');
    const reloadTime = ref(0);

    const update = async () => {
      loading.value = true;
      try {
        await updateContainers();
        loading.value = false;
        complete.value = 'Already Updated';
      } catch (error) {
        // When it is good the container restarts resulting a badgateway 502 error
        // We should wait like 20 seconds after the error and reload the page to show the update
        if (error.response && error.response.status === 502) {
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
    return {
      update,
      loading,
      complete,
      reloadTime,
    };
  },
});
</script>

<template>
  <v-container>
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
          :disable="complete"
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
