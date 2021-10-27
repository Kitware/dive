<script lang="ts">
import { defineComponent, ref } from '@vue/composition-api';


export default defineComponent({
  name: 'ImportMultiCamAddType',
  props: {
    nameList: {
      type: Array,
      required: true,
    },
  },
  setup(props, { emit }) {
    const newSetName = ref('');
    const alphaNumeric = /^[a-zA-Z0-9]*$/;
    const enabled = ref(false);

    const addNewSet = () => {
      emit('add-new', newSetName.value);
      newSetName.value = '';
      enabled.value = false;
    };
    return {
      enabled,
      newSetName,
      alphaNumeric,
      /* methods */
      addNewSet,
    };
  },
});
</script>

<template>
  <v-row
    class="align-start"
    no-gutters
    style="height: 48px;"
  >
    <v-btn
      color="primary"
      class="mr-3"
      :disabled="enabled"
      @click="enabled = true"
    >
      Add Camera
      <v-icon class="ml-1">
        mdi-camera
      </v-icon>
    </v-btn>
    <template v-if="enabled">
      <v-text-field
        v-model="newSetName"
        :rules="[
          v => !!v || 'Name is required',
          v => alphaNumeric.test(v) || 'Letters and Numbers only',
          v => !v.includes(' ') || 'No spaces',
          v => !nameList.includes(v) || 'No duplicate Names']"
        label="name"
        placeholder="Choose a Camera Name"
        outlined
        persistent-hint
        dense
        hide-details="auto"
      />
      <v-btn
        color="error"
        class="mx-3"
        @click="newSetName=''; enabled=false;"
      >
        Cancel
      </v-btn>
      <v-btn
        color="success"
        @click="addNewSet"
      >
        Create
      </v-btn>
    </template>
  </v-row>
</template>

<style scoped lang="scss">
</style>
