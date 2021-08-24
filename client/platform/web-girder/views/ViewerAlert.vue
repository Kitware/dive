<script lang="ts">
import { defineComponent, ref, toRef } from '@vue/composition-api';

export default defineComponent({
  name: 'ViewerAlert',
  setup(_, { root }) {
    const dialog = ref(false);


    // this will change once REST updates are merged
    const brandData = toRef(root.$store.state.Brand, 'brandData');

    return {
      dialog,
      brandData,
    };
  },
});
</script>

<template>
  <!-- This component is for alert messages on the Viewer Page only.
    See NavigationBar for sitewide alert banner -->
  <v-dialog
    v-model="dialog"
    max-width="600px"
  >
    <template v-slot:activator="{ on, attrs }">
      <v-icon
        v-if="brandData.alertMessage"
        dark
        large
        color="red"
        v-bind="attrs"
        v-on="on"
      >
        mdi-alert-circle
      </v-icon>
    </template>
    <v-card
      color="blue"
      class="pa-4"
    >
      <v-icon
        class="float-right"
        @click="dialog = false"
      >
        mdi-close
      </v-icon>
      {{ brandData.alertMessage }}
    </v-card>
  </v-dialog>
</template>

<style lang='scss'>
.theme--dark.v-dialog--active {
  background: green;
}

</style>
