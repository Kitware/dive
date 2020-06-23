<script lang="ts">
import Vue, { PropType } from 'vue';
import { Ref } from '@vue/composition-api';
import { mapState } from 'vuex';
import { cloneDeep } from 'lodash';


export interface NewTrackSettings {
  mode: 'Track' | 'Detection';
  type: string;
  modeSettings: {
    Track: {
      autoAdvanceFrame: boolean;
    };
    Detection: {
      continuous: boolean;
    };
  };
}

export default Vue.extend({
  name: 'CreationMode',

  props: {
    allTypes: {
      type: Object as PropType<Ref<Array<string>>>,
      required: true,
    },
  },

  data: () => ({
    itemHeight: 45, // in pixels
    help: {
      mode: {
        Track: 'Track Mode - advance a frame while drawing',
        Detection: 'Detection Mode - Used to create multiple detections on a single frame.',
      },
      type: 'Choose a default type for the new Track/Detection to be or type in a new type to add it',
      autoAdvanceFrame: 'After creating a track advance to the next frame.  Hit Esc or do single click to exit.',
      continuous: 'Immediately stay in detection creation mode after creating a new track.  Hit Esc or do single click to exit.',
    },
    modes: ['Track', 'Detection'],
  }),
  computed: {
    ...mapState('Settings', ['newTrackSettings']),
    typeList() {
      // Add unknown as the default type to the typeList
      return ['unknown'].concat(this.allTypes.value);
    },
  },

  methods: {
    /** Reduces the number of update functions utilizing Vuex by indicating the target type */
    saveTypeSettings(event: 'Track' | 'Detection', target: 'mode' | 'type') {
      // Copy the newTrackSettings for modification
      const copy: NewTrackSettings = cloneDeep(this.newTrackSettings);
      copy[target] = event; // Modify the value
      this.$store.commit('Settings/setNewTrackSettings', copy);
    },
    /**
     * Each submodule because of Typescript needs to be referenced like this
     * Allows us to add more sub settings in the future
     */
    saveTrackSubSettings(event: true | null, target: 'autoAdvanceFrame') {
      // Copy the newTrackSettings for modification
      const copy: NewTrackSettings = cloneDeep(this.newTrackSettings);
      const modeSettings = copy.modeSettings.Track;
      modeSettings[target] = !!event; // Modify the value
      this.$store.commit('Settings/setNewTrackSettings', copy);
    },
    saveDetectionSubSettings(event: true | null, target: 'continuous') {
      // Copy the newTrackSettings for modification
      const copy: NewTrackSettings = cloneDeep(this.newTrackSettings);
      const modeSettings = copy.modeSettings.Detection;
      modeSettings[target] = !!event; // Modify the value
      this.$store.commit('Settings/setNewTrackSettings', copy);
    },
  },
});
</script>

<template>
  <div class="CreationMode mb-2">
    <v-divider />

    <v-subheader>Settings</v-subheader>
    <v-card>
      <v-row
        align="center"
        dense
      >
        <v-col
          class="mx-2"
          cols="3"
        >
          Mode:
        </v-col>
        <v-col>
          <v-combobox
            :value="newTrackSettings.mode"
            class="ml-0"
            x-small
            :items="modes"
            dense
            hide-details
            @change="saveTypeSettings($event, 'mode')"
          />
        </v-col>
        <v-col cols="2">
          <v-tooltip
            open-delay="200"
            bottom
            max-width="200"
          >
            <template #activator="{ on }">
              <v-icon
                small
                v-on="on"
              >
                mdi-help
              </v-icon>
            </template>
            <span>{{ help.mode[newTrackSettings.mode] }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
      <v-row
        align="center"
        dense
      >
        <v-col
          class="mx-2"
          cols="3"
        >
          Type:
        </v-col>
        <v-col>
          <v-combobox
            :value="newTrackSettings.type"
            class="ml-0"
            x-small
            :items="typeList"
            dense
            hide-details
            @change="saveTypeSettings($event, 'type')"
          />
        </v-col>
        <v-col cols="2">
          <v-tooltip
            open-delay="200"
            bottom
          >
            <template #activator="{ on }">
              <v-icon
                small
                v-on="on"
              >
                mdi-help
              </v-icon>
            </template>
            <span>{{ help.type }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
      <v-row
        v-if="newTrackSettings.mode==='Track'"
      >
        <v-col>
          <v-switch
            :input-value="newTrackSettings.modeSettings.Track.autoAdvanceFrame"
            class="my-0 ml-1 pt-0"
            dense
            label="Advance Frame"
            hide-details
            @change="saveTrackSubSettings($event,'autoAdvanceFrame')"
          />
        </v-col>
        <v-col cols="2">
          <v-tooltip
            open-delay="200"
            bottom
          >
            <template #activator="{ on }">
              <v-icon
                small
                v-on="on"
              >
                mdi-help
              </v-icon>
            </template>
            <span>{{ help.autoAdvanceFrame }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
      <v-row
        v-if="newTrackSettings.mode==='Detection'"
      >
        <v-col>
          <v-switch
            :input-value="newTrackSettings.modeSettings.Detection.continuous"
            class="my-0 ml-1 pt-0"
            dense
            label="Continuous"
            hide-details
            @change="saveDetectionSubSettings($event,'continuous')"
          />
        </v-col>
        <v-col cols="2">
          <v-tooltip
            open-delay="200"
            bottom
          >
            <template #activator="{ on }">
              <v-icon
                small
                v-on="on"
              >
                mdi-help
              </v-icon>
            </template>
            <span>{{ help.continuous }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
    </v-card>
  </div>
</template>
