<script lang="ts">
import Vue, { PropType } from 'vue';

export default Vue.extend({
  props: {
    name: {
      type: String,
      required: true,
    },
    value: {
      type: [String, Boolean, Number] as PropType<string|boolean|number|null>,
      default: null,
    },
    datatype: {
      type: String,
      required: true,
    },
    values: {
      type: Array,
      default: () => [],
    },
  },

  computed: {
    foo() { return this.value; },
  },

  methods: {
    change(newval: string | boolean | number | undefined): void {
      const { name } = this;
      let value;
      switch (newval) {
        case '':
        case undefined:
          value = undefined;
          break;
        default:
          value = newval;
      }
      this.$emit('change', { name, value });
    },
  },
});
</script>

<template>
  <div>
    <v-combobox
      v-if="datatype === 'text'"
      :label="datatype"
      :value="value"
      :items="['', ...values]"
      autocomplete="off"
      dense
      @change="change"
    />
    <v-text-field
      v-else-if="datatype === 'number'"
      :label="datatype"
      :value="value"
      type="number"
      autocomplete="off"
      dense
      @change="change"
    />
    <v-select
      v-else-if="datatype === 'boolean'"
      :label="datatype"
      :value="value"
      :items="[
        { text: '', value: undefined },
        { text: 'true', value: true },
        { text: 'false', value: false }
      ]"
      dense
      @change="change"
    />
  </div>
</template>
