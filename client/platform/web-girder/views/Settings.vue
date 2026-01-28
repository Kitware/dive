<script lang="ts">
import { defineComponent } from 'vue';
import { clientSettings } from 'dive-common/store/settings';

export default defineComponent({
  name: 'Settings',
  setup() {
    return {
      clientSettings,
    };
  },
});
</script>

<template>
  <v-container>
    <v-card>
      <v-card-title>
        Annotation Settings
      </v-card-title>
      <v-card-text>
        <v-row>
          <v-col>
            <v-switch
              v-model="clientSettings.multiCamSettings.showToolbar"
              color="primary"
              label="Show multi-camera toolbar"
              hint="Show multi-camera editing tools in the top toolbar when a track is selected"
              persistent-hint
              class="my-0"
            />
          </v-col>
        </v-row>
        <v-row>
          <v-col>
            <v-switch
              v-model="clientSettings.autoSaveSettings.enabled"
              color="primary"
              label="Auto-save annotations"
              hint="Automatically save annotation changes after a short delay. Changes are batched to reduce server requests."
              persistent-hint
              class="my-0"
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </v-container>
</template>
