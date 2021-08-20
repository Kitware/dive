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

    const addNewSet = () => {
      emit('add-new', newSetName.value);
    };
    return {
      newSetName,
      alphaNumeric,
      /* methods */
      addNewSet,
    };
  },
});
</script>

<template>
  <v-row>
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
      class="mx-4"
    />
    <v-btn
      color="error"
      class="mx-2 my-auto"
      @click="newSetName=''; $emit('cancel')"
    >
      Cancel
    </v-btn>
    <v-btn
      color="success"
      class="mx-2 my-auto"
      @click="addNewSet"
    >
      Submit
    </v-btn>
  </v-row>
</template>

<style scoped lang="scss">
</style>
