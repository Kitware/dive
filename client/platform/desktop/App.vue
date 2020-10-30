<template>
  <v-app>
    <router-view />
  </v-app>
</template>

<script lang="ts">
import { defineComponent } from '@vue/composition-api';
import { provideApi } from 'viame-web-common/apispec';
import { observe } from './store/dataset';

export default defineComponent({
  name: 'App',
  components: {},
  setup() {
    provideApi(observe());
  },
});
</script>

<style lang="scss">
html {
  overflow-y: auto;
}

.text-xs-center {
  text-align: center !important;
}
</style>
