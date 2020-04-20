
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
      states: {
        default: {
          description: 'Select a track to view more information or advance through the frames',
          shortcuts: [
            {
              name: 'Select Track', icon: 'mouse', action: 'Left Click Mouse', description: 'Left click a rectangle to select a track',
            },
            {
              name: 'Edit Track', icon: 'mouse', action: 'Right Click Mouse', description: 'Right click a track to enter Edit Mode',
            },
            {
              name: 'Zoom In/Out', icon: 'mouse', action: 'Scrollwheel Up/Down', description: 'use scrollwheel to zoom in and out',
            },
            {
              name: 'Zoom Area', icon: 'mouse', action: 'Shft + Mouse Movement', description: 'Zoom into a specific area',
            },
            {
              name: 'Fish Head/Tail', icon: 'keyboard', action: 'H key - heads  T key - tails', description: 'While a track is selected add head/tail annotations',
            },
            {
              name: 'Play', icon: 'keyboard', action: 'Spacebar', description: 'Spacebar will pause and start tracks',
            },
            {
              name: 'Frame Forward/Back', icon: 'keyboard', action: 'F key - forward one frame, D key - back one frame', description: 'use scrollwheel to zoom in and out',
            },

          ],
        },
        edit: {
          description: 'Resize a track for the current frame or move it around.  Be sure to click the save icon after editing to save multiple edits.',
          shortcuts: [

          ],
        },
      },
    };
  },
};
</script>
<template />

<style>

</style>
