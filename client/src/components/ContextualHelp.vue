
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
              name: 'Select Track', icon: ['mouse'], actions: ['Left Click Mouse'], description: 'Left click a rectangle to select a track',
            },
            {
              name: 'Zoom In/Out', icon: ['mouse'], actions: ['Scrollwheel Up/Down'], description: 'use scrollwheel to zoom in and out',
            },
            {
              name: 'Zoom Area', icon: ['mouse'], actions: ['Shift + Mouse Movement'], description: 'Zoom into a specific area',
            },


          ],
        },
        {
          name: 'Editing',
          data: [
            {
              name: 'Edit Track', icon: ['mouse'], actions: ['Right Click Mouse'], description: 'Right click a track to enter Edit Mode',
            },
            {
              name: 'Add Head/Tail', icon: ['keyboard'], actions: ['H or G Key - Head', 'T or Y Key - Tail'], description: 'While a track is selected add head/tail annotations',
            },
            {
              name: 'Delete Head/Tail', icon: ['keyboard'], actions: ['Q Key'], description: 'While a track is selected add head/tail annotations',
            },
          ],
        },
        {
          name: 'Playback',
          data: [
            {
              name: 'Play', icon: ['keyboard'], actions: ['Spacebar'], description: 'Spacebar will pause and start tracks',
            },
            {
              name: 'Frame Forward / Back', icon: ['keyboard'], actions: ['F Key - frame forward', 'D Key - frame back'], description: 'use scrollwheel to zoom in and out',
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
      v-for="(category, index) in categories"
      id="helpdialog"
      :key="index"
      elevation="12"
      class="mb-5 pa-2"
    >
      <v-row
        v-for="(item, i) in category.data"
        :key="i"
      >
        <v-col cols="3">
          {{ item.name }}
        </v-col>
        <v-col cols="1">
          <v-icon>mdi-{{ item.icon[0] }}</v-icon>
        </v-col>
        <v-col col="8">
          <div
            v-for="(action, actionIndex) in item.actions"
            :key="actionIndex"
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
