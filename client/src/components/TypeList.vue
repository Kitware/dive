<script>
export default {
  name: "TypeList",
  components: {},
  props: {
    types: {
      type: Array
    },
    selectedTypes: {
      type: Array
    }
  },
  data: function() {
    return { selectedTypes_: this.selectedTypes };
  },
  watch: {
    selectedTypes(value) {
      this.selectedTypes_ = value;
    },
    selectedTypes_(value) {
      this.$emit("update:selectedTypes", value);
    }
  }
};
</script>

<template>
  <div class="typelist">
    <v-subheader>Types</v-subheader>
    <v-checkbox
      class="mt-3 ml-3"
      v-for="type of types"
      :key="type"
      v-model="selectedTypes_"
      :value="type"
      :label="type"
      dense
      hide-details
    ></v-checkbox>
  </div>
</template>

<style lang="scss" scoped>
.typelist {
  overflow-y: auto;
}
</style>

