<script lang="ts">
import {
  computed,
  defineComponent,
} from '@vue/composition-api';
import TooltipBtn from './TooltipButton.vue';

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
  },
  setup(props) {
    const displayTooltip = computed(() => {
      if (props.displayText.length > 20) {
        return `${props.displayText.slice(0, 20)}...`;
      }
      return '';
    });
    return {
      displayTooltip,
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
        :input-value="checked"
        :color="color"
        dense
        shrink
        hide-details
        class="my-1 pl-2 type-checkbox"
        @change="$emit('setCheckedTypes', $event)"
      >
        <template #label>
          <div class="text-body-2 grey--text text--lighten-1">
            <v-tooltip
              v-if="displayTooltip"
              open-delay="200"
              bottom
            >
              <template #activator="{ on }">
                <span
                  v-on="on"
                >
                  <span>
                    {{ displayTooltip }}
                  </span>
                </span>
              </template>
              <span>{{ displayText }} </span>
            </v-tooltip>
            <span v-else>
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
  max-width: 90%;
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
