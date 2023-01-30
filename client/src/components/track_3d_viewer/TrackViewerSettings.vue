<script lang="ts">
import { defineComponent, ref } from '@vue/composition-api';


export default defineComponent({
  name: 'TrackViewerSettings',

  props: {
    onlyShowSelectedTrack: {
      type: Boolean,
      required: true,
    },
  },

  setup() {
    const menu = ref(false);

    return {
      menu,
    };
  },
});
</script>

<template>
  <div>
    <v-menu
      v-model="menu"
      :close-on-content-click="false"
      :nudge-width="200"
      offset-x
    >
      <template v-slot:activator="{ on, attrs }">
        <v-btn
          color="indigo"
          dark
          v-bind="attrs"
          v-on="on"
        >
          Track Viewer settings
        </v-btn>
      </template>

      <v-card>
        <v-list>
          <v-list-item>
            <v-list-item-action>
              <v-switch
                :value="onlyShowSelectedTrack"
                color="purple"
                @change="$emit('update:only-show-selected-track', Boolean($event))"
              />
            </v-list-item-action>
            <v-list-item-title>Only show selected track</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card>
    </v-menu>
  </div>
</template>
