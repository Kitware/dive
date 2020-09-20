<script lang="ts">
import Vue, { PropType } from 'vue';
import { Ref } from '@vue/composition-api';
import { cloneDeep } from 'lodash';
import { NewTrackSettings } from 'app/use/useSettings';

export default Vue.extend({
  name: 'CreationMode',

  props: {
    allTypes: {
      type: Object as PropType<Ref<Array<string>>>,
      required: true,
    },
    newTrackSettings: {
      type: Object as PropType<Ref<NewTrackSettings>>,
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
      interpolate: 'Whether new tracks should have interpolation enabled by default',
      continuous: 'Immediately stay in detection creation mode after creating a new track.  Hit Esc or do single click to exit.',
    },
    modes: ['Track', 'Detection'],
  }),
  computed: {
    typeList() {
      // Add unknown as the default type to the typeList
      return ['unknown'].concat(this.allTypes.value);
    },
  },
  methods: {
    /** Reduces the number of update functions utilizing Vuex by indicating the target type */
    saveTypeSettings(event: 'Track' | 'Detection', target: 'mode' | 'type') {
      // Copy the newTrackSettings for modification
      const copy: NewTrackSettings = cloneDeep(this.newTrackSettings.value);
      copy[target] = event; // Modify the value
      this.$emit('update-new-track-settings', copy);
    },
    /**
     * Each submodule because of Typescript needs to be referenced like this
     * Allows us to add more sub settings in the future
     */
    saveTrackSubSettings(event: true | null, target: 'autoAdvanceFrame' | 'interpolate') {
      // Copy the newTrackSettings for modification
      const copy: NewTrackSettings = cloneDeep(this.newTrackSettings.value);
      const modeSettings = copy.modeSettings.Track;
      modeSettings[target] = !!event; // Modify the value
      this.$emit('update-new-track-settings', copy);
    },
    saveDetectionSubSettings(event: true | null, target: 'continuous') {
      // Copy the newTrackSettings for modification
      const copy: NewTrackSettings = cloneDeep(this.newTrackSettings.value);
      const modeSettings = copy.modeSettings.Detection;
      modeSettings[target] = !!event; // Modify the value
      this.$emit('update-new-track-settings', copy);
    },
  },
});
</script>

<template>
  <div class="CreationMode mb-2">
    <v-card
      outlined
      class="pa-2 pb-0 mt-3"
    >
      <div class="subheading">
        New Annotation Settings
      </div>
      <v-row
        align="end"
        dense
      >
        <v-col
          class="mx-2"
          cols="3"
        >
          Mode:
        </v-col>
        <v-col>
          <v-select
            v-model="newTrackSettings.value.mode"
            class="ml-0 pa-0"
            x-small
            :items="modes"
            dense
            hide-details
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
            <span>{{ help.mode[newTrackSettings.value.mode] }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
      <v-row
        align="end"
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
            :value="newTrackSettings.value.type"
            class="ml-0 pa-0"
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
        v-if="newTrackSettings.value.mode==='Track'"
      >
        <v-col class="py-1">
          <v-switch
            :input-value="
              newTrackSettings.value.modeSettings.Track.autoAdvanceFrame"
            class="my-0 ml-1 pt-0"
            dense
            label="Advance Frame"
            hide-details
            @change="saveTrackSubSettings($event,'autoAdvanceFrame')"
          />
        </v-col>
        <v-col
          cols="2"
          class="py-1"
        >
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
        <v-col class="py-1">
          <v-switch
            :input-value="
              newTrackSettings.value.modeSettings.Track.interpolate"
            class="my-0 ml-1 pt-0"
            dense
            label="Interpolate"
            hide-details
            @change="saveTrackSubSettings($event,'interpolate')"
          />
        </v-col>
        <v-col
          cols="2"
          class="py-1"
        >
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
            <span>{{ help.interpolate }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
      <v-row
        v-if="newTrackSettings.value.mode==='Detection'"
      >
        <v-col>
          <v-switch
            :input-value="newTrackSettings.value.modeSettings.Detection.continuous"
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
