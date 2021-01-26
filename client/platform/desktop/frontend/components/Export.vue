<script lang="ts">
import {
  defineComponent, PropType, reactive, computed, toRef,
} from '@vue/composition-api';
import { MediaTypes } from 'viame-web-common/constants';
import type { JsonMeta } from 'platform/desktop/constants';

export default defineComponent({
  props: {
    meta: {
      type: Object as PropType<JsonMeta>,
      required: true,
    },
    small: {
      type: Boolean,
      default: false,
    },
  },

  setup(props) {
    const data = reactive({
      menuOpen: false,
      excludeFiltered: false,
      activator: 0,
    });

    const metaRef = toRef(props, 'meta');
    const mediaType = computed(() => MediaTypes[metaRef.value.type]);
    const thresholds = computed(() => Object.keys(metaRef.value.confidenceFilters || {}));

    return { data, mediaType, thresholds };
  },
});
</script>

<template>
  <v-menu
    v-model="data.menuOpen"
    :close-on-content-click="false"
    :nudge-width="120"
    offset-y
    max-width="280"
  >
    <template #activator="{ on: menuOn }">
      <v-tooltip bottom>
        <template #activator="{ on: tooltipOn }">
          <v-btn
            class="ma-0"
            text
            :small="small"
            v-on="{ ...tooltipOn, ...menuOn }"
          >
            <v-icon color="accent">
              mdi-export
            </v-icon>
            <span
              v-show="!$vuetify.breakpoint.mdAndDown"
              class="pl-1"
            >
              Export
            </span>
          </v-btn>
        </template>
        <span>export annotation data</span>
      </v-tooltip>
    </template>
    <template>
      <v-card v-if="data.menuOpen">
        <v-card-title>
          Export options
        </v-card-title>

        <v-card-text class="pb-0">
          <div>Get latest detections csv only</div>
          <template v-if="thresholds.length">
            <v-checkbox
              v-model="data.excludeFiltered"
              label="exclude tracks below confidence threshold"
              dense
              hide-details
            />
            <div class="py-2">
              <span>Current thresholds:</span>
              <span
                v-for="(val, key) in meta.confidenceFilters"
                :key="key"
                class="pt-2"
              >
                ({{ key }}, {{ val }})
              </span>
            </div>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            depressed
            block
          >
            <span>export detections</span>
          </v-btn>
        </v-card-actions>
      </v-card>
    </template>
  </v-menu>
</template>
