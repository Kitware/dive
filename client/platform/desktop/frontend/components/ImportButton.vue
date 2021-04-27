<script lang="ts">
import { defineComponent } from '@vue/composition-api';


export default defineComponent({
  name: 'ImportMultiCamAddType',
  props: {
    name: {
      type: String,
      required: true,
    },
    icon: {
      type: String,
      required: true,
    },
    openType: {
      type: String,
      required: true,
    },
  },
  setup() {
    return {
    };
  },
});
</script>

<template>
  <v-menu
    offset-y
    offset-x
    nudge-left="180"
    max-width="180"
  >
    <template v-slot:activator="{ on }">
      <v-btn
        large
        block
        color="primary"
        class="mb-6 mr-0 pr-0"
        @click="$emit('open', openType)"
      >
        <div class="col-11">
          {{ name }}
          <v-icon class="ml-2">
            {{ icon }}
          </v-icon>
        </div>
        <v-icon
          class="justify-right my-auto button-dropdown"
          v-on="on"
        >
          mdi-chevron-down
        </v-icon>
      </v-btn>
    </template>
    <v-card outlined>
      <v-list dense>
        <v-list-item
          style="align-items':'center"
          @click="$emit('multi-cam',{ stereo: true, openType })"
        >
          <v-list-item-icon>
            <v-icon>mdi-binoculars</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>Stereoscopic</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-list-item
          style="align-items':'center"
          @click="$emit('multi-cam',{ stereo: false, openType })"
        >
          <v-list-item-icon>
            <v-icon>mdi-camera-burst</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title>MultiCam</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
      </v-list>
    </v-card>
  </v-menu>
</template>

<style scoped lang="scss">
.button-dropdown {
  float:right;
  border-left: 1px solid white;
}
.button-dropdown::before{
  padding-top:5px;
  padding-bottom:5px;
}
.button-dropdown::after{
  border-radius: 0% !important;
}

</style>
