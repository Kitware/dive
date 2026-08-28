<script lang="ts">
import { computed, defineComponent } from 'vue';
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
    indeterminate: {
      type: Boolean,
      default: false,
    },
    tree: {
      type: Boolean,
      default: false,
    },
    depth: {
      type: Number,
      default: 0,
    },
    hasChildren: {
      type: Boolean,
      default: false,
    },
    expanded: {
      type: Boolean,
      default: false,
    },
    disclosureVisible: {
      type: Boolean,
      default: true,
    },
    width: {
      type: Number,
      default: 300,
    },
    displayMaxButton: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    isSuppressionType: {
      type: Boolean,
      default: false,
    },
    /** Configured region-overlap percent (0–100]; invalid values fall back to 99. */
    suppressionThreshold: {
      type: Number,
      default: 99,
    },
  },
  setup(props, { emit }) {
    /* Horizontal padding is the width of checkbox, scrollbar, and edit button */
    const HorizontalPadding = computed(() => {
      if (!props.displayMaxButton) {
        return 42 + 14 + 20;
      }
      return 42 + 14 + 20 + 30;
    });
    const HierarchyPadding = computed(() => (props.tree ? (props.depth * 16) + 24 : 0));
    const cssVars = computed(() => ({
      '--content-width': `${Math.max(
        0,
        props.width - HorizontalPadding.value - HierarchyPadding.value,
      )}px`,
      '--tree-depth': `${props.depth * 16}px`,
    }));
    const effectiveOverlapPercent = computed(() => {
      const p = Number(props.suppressionThreshold);
      if (!Number.isFinite(p) || p <= 0 || p > 100) {
        return 99;
      }
      return p;
    });
    const goToFrame = () => {
      emit('goToMaxFrame', props.type);
    };
    return {
      cssVars,
      effectiveOverlapPercent,
      goToFrame,
    };
  },
});
</script>

<template>
  <v-row
    :style="cssVars"
    align="center"
    class="hover-show-parent"
    :role="tree ? 'listitem' : undefined"
    :aria-level="tree ? depth + 1 : undefined"
  >
    <v-col class="d-flex flex-row py-0 align-center">
      <div
        v-if="tree"
        class="tree-prefix d-flex align-center justify-center"
      >
        <button
          v-if="hasChildren && disclosureVisible"
          type="button"
          class="tree-disclosure"
          :aria-label="`${expanded ? 'Collapse' : 'Expand'} descendants of ${type}`"
          :aria-expanded="expanded"
          @click="$emit('toggleExpanded')"
        >
          <v-icon small>
            {{ expanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}
          </v-icon>
        </button>
        <span
          v-else
          class="tree-disclosure-spacer"
          aria-hidden="true"
        />
      </div>
      <v-checkbox
        :input-value="checked || indeterminate"
        :indeterminate="indeterminate"
        :color="color"
        :disabled="disabled"
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
              <span>{{ displayText }}</span>
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
            <v-tooltip
              v-if="isSuppressionType"
              open-delay="200"
              bottom
              max-width="280"
            >
              <template #activator="{ on, attrs }">
                <v-icon
                  small
                  class="ml-1 suppression-icon"
                  color="orange darken-2"
                  v-bind="attrs"
                  v-on="on"
                >
                  mdi-eye-off
                </v-icon>
              </template>
              <span>
                This type is used for suppression.
                Detections lying {{ effectiveOverlapPercent }}% or more under its regions
                are hidden and excluded from counts.
                Detections with an attribute of this name set true stay visible
                with their real type and an eye-off tag.
              </span>
            </v-tooltip>
          </div>
        </template>
      </v-checkbox>
      <v-spacer />
      <v-tooltip
        v-if="displayMaxButton"
        open-delay="100"
        bottom
      >
        <template #activator="{ on }">
          <v-btn
            icon
            class="hover-show-child"
            small
            v-on="on"
            @click="goToFrame()"
          >
            <v-icon
              small
            >
              mdi-counter
            </v-icon>
          </v-btn>
        </template>
        <span>Go to Max N Frame</span>
      </v-tooltip>

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
@import 'src/components/styles/hover-reveal.scss';

.nowrap {
  white-space: nowrap;
  overflow: hidden;
  max-width: var(--content-width);
  text-overflow: ellipsis;
}

.tree-prefix {
  flex: 0 0 24px;
  height: 30px;
  margin-left: var(--tree-depth);
}

.tree-disclosure {
  min-width: 24px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.tree-disclosure:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 1px;
}

.tree-disclosure-spacer {
  display: inline-block;
  width: 24px;
}

.outlined {
  background-color: gray;
  color: #222;
  font-weight: 600;
  border-radius: 6px;
  margin-left: 4px;
  padding: 0 5px;
  font-size: 12px;
}

.suppression-icon {
  flex-shrink: 0;
  align-self: center;
}
</style>
