<script>
import { GirderJobList } from '@girder/components/src';

export default {
  name: 'Jobs',
  components: { GirderJobList },
  methods: {
    getId(data) {
      try {
        if (typeof data === 'object') {
          return data.folderId;
        }
        return JSON.parse(data).params.input_folder;
      } catch (err) {
        return null;
      }
    },
  },
};
</script>

<template>
  <v-container
    :fluid="$vuetify.breakpoint.mdAndDown"
  >
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
              <v-icon small>mdi-eye</v-icon>
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
              <v-icon small>mdi-text-box-outline</v-icon>
            </v-btn>
          </template>
          <span>View job logs and manage job</span>
        </v-tooltip>
        <span>{{ item.statusText.replace('Inactive', 'Queued') }}</span>
      </template>
    </GirderJobList>
    <v-card class="mt-4">
      <v-card-title class="text-h6">
        Job Runner Info
      </v-card-title>
      <v-card-text>
        <p>
          The job runner is shared between all users of this system and has
          limited GPU capacity.  Jobs in queue will be processed in the order in
          which they are received. You can run your own server and job runner with Docker
          using the instructions provided
          <a href="https://github.com/Kitware/dive/tree/main/docker">here</a>.
        </p>
      </v-card-text>
    </v-card>
  </v-container>
</template>
