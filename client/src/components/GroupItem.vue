<script lang="ts">
import { defineComponent, PropType } from '@vue/composition-api';
import { useGroupFilterControls } from 'vue-media-annotator/provides';
import Group from '../Group';

export default defineComponent({
  props: {
    group: {
      type: Object as PropType<Group>,
      required: true,
    },
    color: {
      type: String,
      required: true,
    },
    selected: {
      type: Boolean,
      required: true,
    },
    inputValue: {
      type: Boolean,
      required: true,
    },
  },

  setup() {
    const groupFilters = useGroupFilterControls();
    return {
      groupFilters,
    };
  },
});
</script>

<template>
  <div class="mx-2">
    <v-row
      no-gutters
    >
      <v-checkbox
        class="my-0 ml-0 pt-0"
        dense
        hide-details
        :input-value="inputValue"
        :color="color"
        @change="groupFilters.updateCheckedId(group.id, $event)"
      />
      <pre>{{ group.id }}</pre>
      <v-spacer />
      <input
        type="text"
        class="input-box freeform-input"
        :value="group.getType()[0]"
        disabled
      >
    </v-row>
    <v-row
      no-gutters
      class="mt-1"
    >
      <v-spacer />
      <div class="text-caption">
        {{ Object.keys(group.members).join(', ') }}
      </div>
    </v-row>
  </div>
</template>

<style lang="scss" scoped>
@import 'src/components/styles/common.scss';

.freeform-input {
  width: 150px;
}
</style>
