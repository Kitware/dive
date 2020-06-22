<script lang="ts">
import Vue, { PropType } from 'vue';
import { Ref } from '@vue/composition-api';

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
    selectedMode: 'Track',
    selectedType: 'unknown',
    modeSettings: {
      Track: {
        autoAdvanceFrame: true,
      },
      Detection: {
        continuous: false,
      },
    },
  }),

  computed: {
    typeList() {
      // Add unknown as the default type to the typeList
      return ['unknown'].concat(this.allTypes.value);
    },
  },

  created() {
    //We don't store the settings as reactive, just have the component emit them.
    //In the future we may retrieve this from the localStorage for initialization
    this.emitSettings();
  },

  methods: {
    setType(newType: string) {
      this.selectedType = newType;
    },

    emitSettings() {
      this.$emit('settings-changed', {
        mode: this.selectedMode,
        type: this.selectedType,
        modeSettings: this.modeSettings,
      } as NewTrackSettings);
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
            v-model="selectedMode"
            class="ml-0"
            x-small
            :items="modes"
            dense
            hide-details
            @change="emitSettings"
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
            <span>{{ help.mode[selectedMode] }}</span>
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
            v-model="selectedType"
            class="ml-0"
            x-small
            :items="typeList"
            dense
            hide-details
            @change="emitSettings"
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
        v-if="selectedMode==='Track'"
      >
        <v-col>
          <v-switch
            v-model="modeSettings.Track.autoAdvanceFrame"
            class="my-0 ml-1 pt-0"
            dense
            label="Advance Frame"
            hide-details
            @change="emitSettings"
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
        v-if="selectedMode==='Detection'"
      >
        <v-col>
          <v-switch
            v-model="modeSettings.Detection.continuous"
            class="my-0 ml-1 pt-0"
            dense
            label="Continuous"
            hide-details
            @change="emitSettings"
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
