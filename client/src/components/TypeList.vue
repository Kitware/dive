<script>
export default {
  name: 'TypeList',
  components: {},
  props: {
    types: {
      type: Array,
      required: true,
    },
    checkedTypes: {
      type: Array,
      required: true,
    },
    colorMap: {
      type: Function,
      required: true,
    },
  },
  data() {
    return { checkedTypes_: this.checkedTypes };
  },
  watch: {
    checkedTypes(value) {
      this.checkedTypes_ = value;
    },
    checkedTypes_(value) {
      this.$emit('update:checkedTypes', value);
    },
  },
};
</script>

<template>
  <div class="typelist d-flex flex-column">
    <v-subheader>Types</v-subheader>
    <div
      class="flex-grow-1"
      style="overflow-y: auto;"
    >
      <div>
        <v-checkbox
          v-for="type of types"
          :key="type"
          v-model="checkedTypes_"
          :color="colorMap(type)"
          class="my-2 ml-3"
          :label="type"
          :value="type"
          dense
          hide-details
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.typelist {
  overflow-y: auto;
}
</style>
