<script>
export default {
  name: "TypeList",
  components: {},
  props: {
    types: {
      type: Array
    },
    checkedTypes: {
      type: Array
    }
  },
  data: function() {
    return { checkedTypes_: this.checkedTypes };
  },
  watch: {
    checkedTypes(value) {
      this.checkedTypes_ = value;
    },
    checkedTypes_(value) {
      this.$emit("update:checkedTypes", value);
    }
  }
};
</script>

<template>
  <div class="typelist d-flex flex-column">
    <v-subheader>Types</v-subheader>
    <div class="flex-grow-1" style="overflow-y: auto;">
      <v-checkbox
        class="mt-3 ml-3"
        v-for="type of types"
        :key="type"
        v-model="checkedTypes_"
        :value="type"
        :label="type"
        dense
        hide-details
      ></v-checkbox>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.typelist {
  overflow-y: auto;
}
</style>
