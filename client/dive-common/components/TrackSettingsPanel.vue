<script lang="ts">
import {
  defineComponent,
  reactive,
  PropType,
  ref,
  computed,
} from '@vue/composition-api';
import { clientSettings } from 'dive-common/store/settings';

export default defineComponent({
  name: 'TrackSettingsPanel',

  props: {
    allTypes: {
      type: Array as PropType<Array<string>>,
      required: true,
    },
  },

  setup(props) {
    const itemHeight = 45; // in pixels
    const help = reactive({
      mode: {
        Track: 'Track Mode - advance a frame while drawing',
        Detection: 'Detection Mode - Used to create multiple detections on a single frame.',
      },
      type: 'Choose a default type for the new Track/Detection to be or type in a new type to add it',
      autoAdvanceFrame: 'After creating a track advance to the next frame.  Hit Esc to exit.',
      interpolate: 'Whether new tracks should have interpolation enabled by default',
      continuous: 'Immediately stay in detection creation mode after creating a new track.  Hit Esc to exit.',
      prompt: 'Prompt user before deleting a track?',
    });
    const modes = ref(['Track', 'Detection']);
    // Add unknown as the default type to the typeList
    const typeList = computed(() => ['unknown'].concat(props.allTypes));

    return {
      clientSettings,
      itemHeight,
      help,
      modes,
      typeList,
    };
  },
});
</script>

<template>
  <div class="TrackSettings">
    <v-card
      outlined
      class="pa-2"
      width="300"
      color="blue-grey darken-3"
    >
      <div class="subheading">
        New Annotation Settings
      </div>
      <v-row
        align="end"
        dense
      >
        <v-col
          class="mx-2 px-0"
          cols="2"
        >
          Mode:
        </v-col>
        <v-col>
          <v-select
            v-model="clientSettings.trackSettings.newTrackSettings.mode"
            class="ml-0 pa-0"
            x-small
            :items="modes"
            dense
            hide-details
          />
        </v-col>
        <v-col
          cols="2"
          align="right"
        >
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
            <span>
              {{ help.mode[clientSettings.trackSettings.newTrackSettings.mode] }}
            </span>
          </v-tooltip>
        </v-col>
      </v-row>
      <v-row
        align="end"
        dense
        class="mb-2"
      >
        <v-col
          class="mx-2"
          cols="2"
        >
          Type:
        </v-col>
        <v-col>
          <v-combobox
            v-model="clientSettings.trackSettings.newTrackSettings.type"
            class="ml-0 pa-0"
            x-small
            :items="typeList"
            dense
            hide-details
          />
        </v-col>
        <v-col
          cols="2"
          align="right"
        >
          <v-tooltip
            open-delay="200"
            max-width="200"
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
      <template v-if="clientSettings.trackSettings.newTrackSettings.mode === 'Track'">
        <v-row>
          <v-col class="py-1">
            <v-switch
              v-model="
                clientSettings.trackSettings.newTrackSettings.modeSettings.Track.autoAdvanceFrame"
              class="my-0 ml-1 pt-0"
              dense
              label="Advance Frame"
              hide-details
            />
          </v-col>
          <v-col
            class="py-1 shrink"
            align="right"
          >
            <v-tooltip
              open-delay="200"
              max-width="200"
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
        <v-row>
          <v-col class="py-1">
            <v-switch
              v-model="
                clientSettings.trackSettings.newTrackSettings.modeSettings.Track.interpolate"
              class="my-0 ml-1 pt-0"
              dense
              label="Interpolate"
              hide-details
            />
          </v-col>
          <v-col
            class="py-1 shrink"
            align="right"
          >
            <v-tooltip
              open-delay="200"
              max-width="200"
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
      </template>
      <v-row
        v-if="clientSettings.trackSettings.newTrackSettings.mode === 'Detection'"
      >
        <v-col class="py-1">
          <v-switch
            v-model="
              clientSettings.trackSettings.newTrackSettings.modeSettings.Detection.continuous"
            class="my-0 ml-1 pt-0"
            dense
            label="Continuous"
            hide-details
          />
        </v-col>
        <v-col
          class="py-1 shrink"
          align="right"
        >
          <v-tooltip
            open-delay="200"
            max-width="200"
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
      <v-divider class="my-2" />
      <div class="subheading">
        Deletion Settings
      </div>
      <v-row
        align="end"
        dense
      >
        <v-col class="py-1">
          <v-switch
            v-model="clientSettings.trackSettings.deletionSettings.promptUser"
            class="my-0 ml-1 pt-0"
            dense
            label="Prompt User"
            hide-details
          />
        </v-col>
        <v-col
          cols="2"
          class="py-1"
          align="right"
        >
          <v-tooltip
            open-delay="200"
            max-width="200"
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
            <span>{{ help.prompt }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
    </v-card>
  </div>
</template>
