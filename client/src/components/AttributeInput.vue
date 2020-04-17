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
      required: true,
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
      let newval;
      switch (value) {
        case '':
        case null:
          newval = undefined;
          break;
        default:
          newval = value;
      }
      this.$emit('change', { name: this.name, value: newval });
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
