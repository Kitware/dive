<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import TooltipBtn from './TooltipButton.vue';

/* Horizontal padding is the width of checkbox, scrollbar, and edit button */
const HorizontalPadding = 42 + 14 + 20;

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
    color: {
      type: String,
      required: true,
    },
    checked: {
      type: Boolean,
      required: true,
    },
    width: {
      type: Number,
      default: 300,
    },
  },

  setup: (props) => ({
    cssVars: computed(() => ({ '--content-width': `${props.width - HorizontalPadding}px` })),
  }),
});
</script>

<template>
  <v-row
    :style="cssVars"
    align="center"
    class="hover-show-parent"
  >
    <v-col class="d-flex flex-row py-0 align-center">
      <v-checkbox
        :input-value="checked"
        :color="color"
        dense
        shrink
        hide-details
        class="my-1 pl-2"
        @change="$emit('setCheckedTypes', $event)"
      >
        <template #label>
          <div class="text-body-2 grey--text text--lighten-1 d-flex flex-row nowrap">
            <v-tooltip
              open-delay="200"
              bottom
            >
              <template #activator="{ on }">
                <span
                  class="nowrap"
                  v-on="on"
                >
                  {{ displayText }}
                </span>
              </template>
              <span>{{ displayText }} </span>
            </v-tooltip>
            <v-tooltip
              v-if="confidenceFilterNum"
              open-delay="200"
              bottom
              class="align-self-end"
            >
              <template #activator="{ on, attrs }">
                <span
                  class="outlined"
                  v-bind="attrs"
                  v-on="on"
                >
                  {{ `>${confidenceFilterNum}` }}
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
.nowrap {
  white-space: nowrap;
  overflow: hidden;
  max-width: var(--content-width);
  text-overflow: ellipsis;
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
