<script lang="ts">
import {
  defineComponent,
} from '@vue/composition-api';
import TooltipBtn from './TooltipButton.vue';
import { useCheckedTypes, useTypeStyling } from '../provides';

export default defineComponent({
  name: 'TypeItem',

  components: { TooltipBtn },

  props: {
    type: {
      type: String,
      required: true,
    },
    displayText: {
      type: String,
      required: true,
    },
    confidenceFilterNum: {
      type: Number,
      required: true,
    },
  },
  setup() {
    const checkedTypesRef = useCheckedTypes();
    const typeStylingRef = useTypeStyling();

    return {
      checkedTypesRef,
      typeStylingRef,
    };
  },
});
</script>

<template>
  <v-row
    align="center"
    class="hover-show-parent"
  >
    <v-col class="d-flex flex-row py-0 align-center">
      <v-checkbox
        :input-value="checkedTypesRef"
        :value="type"
        :color="typeStylingRef.color(type)"
        dense
        shrink
        hide-details
        class="my-1 type-checkbox"
        @change="$emit('setCheckedTypes', $event)"
      >
        <template #label>
          <div class="text-body-2 grey--text text--lighten-1">
            <span>
              {{ displayText }}
            </span>
            <v-tooltip
              v-if="confidenceFilterNum"
              open-delay="100"
              bottom
            >
              <template #activator="{ on }">
                <span
                  class="outlined"
                  v-on="on"
                >
                  <span>
                    {{ `>${confidenceFilterNum}` }}
                  </span>
                </span>
              </template>
              <span>Type has threshold set individually</span>
            </v-tooltip>
          </div>
        </template>
      </v-checkbox>
      <v-spacer />
      <v-tooltip
        open-delay="100"
        bottom
      >
        <template #activator="{ on }">
          <v-btn
            class="hover-show-child"
            icon
            small
            v-on="on"
            @click="$emit('clickEdit', type)"
          >
            <v-icon
              small
            >
              mdi-pencil
            </v-icon>
          </v-btn>
        </template>
        <span>Edit</span>
      </v-tooltip>
    </v-col>
  </v-row>
</template>

<style lang="scss" scoped>
.type-checkbox {
  max-width: 80%;
  overflow-wrap: anywhere;
}

.hover-show-parent {
  .hover-show-child {
    display: none;
  }

  &:hover {
    .hover-show-child {
      display: inherit;
    }
  }
}
.outlined {
  background-color: gray;
  color: #222;
  font-weight: 600;
  border-radius: 6px;
  padding: 0 5px;
  font-size: 12px;
}
</style>
