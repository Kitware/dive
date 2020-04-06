<script>
export default {
  name: 'AttributeInput',
  props: {
    name: {
      type: String,
      required: true,
    },
    value: {
      type: [String, Number, Boolean],
    },
    datatype: {
      type: String,
      required: true,
    },
    values: {
      type: Array,
      required: false,
      default: () => [],
    },
  },
  computed: {
    values_() {
      return ['', ...this.values];
    },
  },
  methods: {
    change(value) {
      switch (value) {
        case '':
          value = undefined;
          break;
        case null:
          value = undefined;
          break;
      }
      this.$emit('change', { name: this.name, value });
    },
  },
};
</script>

<template>
  <v-combobox
    v-if="datatype === 'text'"
    :label="name"
    :value="value"
    :items="values_"
    autocomplete="off"
    @change="change"
  />
  <v-text-field
    v-else-if="datatype === 'number'"
    :label="name"
    :value="value"
    type="number"
    autocomplete="off"
    @change="change"
  />
  <v-select
    v-else-if="datatype === 'boolean'"
    :label="name"
    :value="value"
    :items="[
      { text: '', value: null },
      { text: 'true', value: true },
      { text: 'false', value: false }
    ]"
    @change="change"
  />
</template>
