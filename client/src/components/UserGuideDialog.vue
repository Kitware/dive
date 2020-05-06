
<script>
export default {
  props: {
    state: {
      type: String,
      require: true,
      default: 'default',
    },
  },
  data() {
    return {
      categories: [
        {
          name: 'Interactions',
          data: [
            {
              name: 'Select Track', icon: 'mdi-mouse', actions: ['Left Click Mouse'], description: 'Left click a rectangle to select a track',
            },
            {
              name: 'Zoom In/Out', icon: 'mdi-mouse', actions: ['Scrollwheel Up/Down'], description: 'use scrollwheel to zoom in and out',
            },
            {
              name: 'Zoom Area', icon: 'mdi-mouse', actions: ['Shift + Mouse Movement'], description: 'Zoom into a specific area',
            },


          ],
        },
        {
          name: 'Editing',
          data: [
            {
              name: 'Edit Track', icon: 'mdi-mouse', actions: ['Right Click Mouse'], description: 'Right click a track to enter Edit Mode',
            },
            {
              name: 'Add Head/Tail', icon: 'mdi-keyboard', actions: ['H or G Key - Head', 'T or Y Key - Tail'], description: 'While a track is selected add head/tail annotations',
            },
            {
              name: 'Delete Head/Tail', icon: 'mdi-keyboard', actions: ['Q Key'], description: 'While a track is selected add head/tail annotations',
            },
          ],
        },
        {
          name: 'Playback',
          data: [
            {
              name: 'Play', icon: 'mdi-keyboard', actions: ['Spacebar'], description: 'Spacebar will pause and start tracks',
            },
            {
              name: 'Frame Forward / Back', icon: 'mdi-keyboard', actions: ['F Key - frame forward', 'D Key - frame back'], description: 'use scrollwheel to zoom in and out',
            },
          ],
        },
      ],
    };
  },
};
</script>
<template>
  <div>
    <v-card
      v-for="category in categories"
      id="helpdialog"
      :key="category.name"
      elevation="12"
      class="mb-5 pa-2"
    >
      <v-row
        v-for="item in category.data"
        :key="item.name"
      >
        <v-col cols="3">
          {{ item.name }}
        </v-col>
        <v-col cols="2">
          <v-icon>{{ item.icon }}</v-icon>
        </v-col>
        <v-col col="7">
          <div
            v-for="action in item.actions"
            :key="action"
          >
            {{ action }}
          </div>
        </v-col>
      </v-row>
    </v-card>
  </div>
</template>
<style lang="scss" scoped>
#helpdialog{
  font-family: monospace;
  font-size: 12px;
}
</style>
