<script lang="ts">
import Vue, { PropType } from 'vue';
import {
  computed, defineComponent, ref, Ref,
} from '@vue/composition-api';


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

    const addNewSet = () => {
      emit('add-new', newSetName.value);
    };
    return {
      newSetName,
      /* methods */
      addNewSet,
    };
  },
});
</script>

<template>
  <v-row
    class="align-center"
  >
    <v-text-field
      v-model="newSetName"
      :rules="[
        v => !!v || 'Name is required',
        v => !v.includes(' ') || 'No spaces',
        v => !nameList.includes(v) || 'No duplicate Names']"
      label="name"
      placeholder="Choose a name"
      class="mx-4"
    />
    <v-btn
      color="error"
      class="mx-2"
      @click="newSetName=''; $emit('cancel')"
    >
      Cancel
    </v-btn>
    <v-btn
      color="success"
      class="mx-2"
      @click="addNewSet"
    >
      Submit
    </v-btn>
  </v-row>
</template>

<style scoped lang="scss">
</style>
