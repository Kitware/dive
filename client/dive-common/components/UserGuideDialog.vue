
<script lang="ts">
import { defineComponent } from '@vue/composition-api';

export default defineComponent({
  setup() {
    return {
      categories: [
        {
          name: 'General',
          data: [
            {
              name: 'Select Track', icon: 'mdi-mouse', actions: ['Left Click Mouse'], description: 'Left click a rectangle to select a detection/track',
            },
            {
              name: 'Zoom In/Out', icon: 'mdi-mouse', actions: ['Scrollwheel Up/Down'], description: 'use scrollwheel to zoom in and out',
            },
            {
              name: 'Zoom Area', icon: 'mdi-mouse', actions: ['Shift + Mouse Movement'], description: 'Zoom into a specific area',
            },
            {
              name: 'Pan', icon: 'mdi-mouse', actions: ['Middle Click Mouse'], description: 'Pan the camera',
            },
            {
              name: 'Reset zoom', icon: 'mdi-keyboard', actions: ['R Key'], description: 'Reset pan and zoom',
            },
            {
              name: 'Select Track', icon: 'mdi-keyboard', actions: ['Up/Down Arrows'], description: 'Select Track',
            },
          ],
        },
        {
          name: 'Selected Mode',
          data: [
            {
              name: 'First/Last Frame', icon: 'mdi-keyboard', actions: ['Home or End'], description: 'Go to first or last frame of selected track',
            },
            {
              name: 'Delete', icon: 'mdi-keyboard', actions: ['Delete'], description: 'Delete selected track',
            },
            {
              name: 'Edit Type', icon: 'mdi-keyboard', actions: ['Shift + Enter'], description: 'Choose/Edit track type',
            },
            {
              name: 'Toggle Keyframe', icon: 'mdi-keyboard', actions: ['K'], description: 'Toggle Current Frame Keyframe',
            },
            {
              name: 'Toggle Interpolation', icon: 'mdi-keyboard', actions: ['I'], description: 'Toggle Interpolation On/Off',
            },

            {
              name: 'Split Track', icon: 'mdi-keyboard', actions: ['X'], description: 'Split Track',
            },
            {
              name: 'Merge Mode', icon: 'mdi-keyboard', actions: ['M'], description: 'Enter Merge Mode, commit with Shift+M',
            },
            {
              name: 'Create Group', icon: 'mdi-keyboard', actions: ['G'], description: 'Create group from selected track.',
            },
          ],
        },
        {
          name: 'Playback',
          data: [
            {
              name: 'Play', icon: 'mdi-keyboard', actions: ['Spacebar'], description: 'Spacebar will pause and start playback',
            },
            {
              name: 'Prev Frame', icon: 'mdi-keyboard', actions: ['D Key', 'Left Arrow'], description: 'skip back 1 frame',
            },
            {
              name: 'Next Frame', icon: 'mdi-keyboard', actions: ['F Key', 'Right Arrow'], description: 'skip ahead 1 frame',
            },
          ],
        },
        {
          name: 'Editing Mode',
          data: [
            {
              name: 'New Track', icon: 'mdi-keyboard', actions: ['N Key'], description: 'Create a new Track/Detection',
            },
            {
              name: 'Edit Track', icon: 'mdi-mouse', actions: ['Right Click Mouse'], description: 'Right click a track to enter Edit Mode',
            },
            {
              name: 'Add Head/Tail', icon: 'mdi-keyboard', actions: ['H Key - Head', 'T Key - Tail'], description: 'While a track is selected add head/tail annotations',
            },
          ],
        },
      ],
    };
  },
});
</script>

<template>
  <div class="d-flex justify-space-around flex-wrap pa-4">
    <v-card
      v-for="category in categories"
      id="helpdialog"
      :key="category.name"
      outlined
      flat
      width="360"
      class="my-3"
    >
      <v-card-title>{{ category.name }}</v-card-title>
      <v-tooltip
        v-for="(item, index) in category.data"
        :key="`${item.name}_${index}`"
        color="red"
        top
      >
        <template v-slot:activator="{ on }">
          <v-row
            class="helpContextRow ma-0 align-center"
            v-on="on"
          >
            <v-col cols="4">
              {{ item.name }}
            </v-col>
            <v-col cols="2">
              <v-icon>{{ item.icon }}</v-icon>
            </v-col>
            <v-col col="6">
              <div
                v-for="action in item.actions"
                :key="action"
              >
                {{ action }}
              </div>
            </v-col>
          </v-row>
        </template>
        <span> {{ item.description }}</span>
      </v-tooltip>
    </v-card>
  </div>
</template>

<style lang="scss" scoped>
#helpdialog{
  font-family: monospace;
  font-size: 12px;
  .helpContextRow{
    &:hover{
      background-color: var(--v-dropzone-base);
    }
  }
}
</style>
