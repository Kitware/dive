<script lang="ts">
import { defineComponent, ref } from '@vue/composition-api';


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
  <v-menu offset-y>
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
    <v-list>
      <v-list-item>
        <v-btn
          block
          color="primary"
          @click="$emit('multi-cam',{ stereo: true, openType })"
        >
          Stereoscopic
          <v-icon class="ml-2">
            mdi-binoculars
          </v-icon>
        </v-btn>
      </v-list-item> <v-list-item>
        <v-btn
          block
          color="primary"
          @click="$emit('multi-cam',{ stereo: false, openType })"
        >
          MultiCam
          <v-icon class="ml-2">
            mdi-camera-burst
          </v-icon>
        </v-btn>
      </v-list-item>
    </v-list>
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
