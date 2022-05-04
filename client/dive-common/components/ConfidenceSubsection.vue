<script lang="ts">
import {
  defineComponent, PropType,
} from '@vue/composition-api';

import {
  useTrackStyleManager,
} from 'vue-media-annotator/provides';

import PanelSubsection from 'dive-common/components/PanelSubsection.vue';

export default defineComponent({
  name: 'ConfidenceSubsection',
  components: {
    PanelSubsection,
  },
  props: {
    confidencePairs: {
      type: Array as PropType<[string, number][]>,
      required: true,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  setup() {
    const typeStylingRef = useTrackStyleManager().typeStyling;
    // TODO:  Adding, Deleting, Editing Confidence Levels in this interface
    return {
      typeStylingRef,
    };
  },
});
</script>

<template>
  <panel-subsection>
    <template slot="header">
      <v-row
        class="align-center"
        no-gutters
      >
        <b>Confidence Pairs:</b>
        <v-spacer />
        <v-tooltip
          open-delay="200"
          bottom
          max-width="200"
        >
          <template #activator="{ on }">
            <v-btn
              disabled
              outlined
              x-small
              class="my-1"
              v-on="on"
            >
              <v-icon small>
                mdi-plus
              </v-icon>
              Pair
            </v-btn>
          </template>
          <span>Add a new Confidence Pair</span>
        </v-tooltip>
      </v-row>
    </template>
    <template slot="scroll-section">
      <v-col class="pa-0">
        <span
          v-for="(pair, index) in confidencePairs"
          :key="index"
          style="font-size: 0.8em"
        >
          <v-row
            class="ma-0"
            dense
            align="center"
          >
            <v-col cols="1">
              <div
                class="type-color-box"
                :style="{
                  backgroundColor: typeStylingRef.color(pair[0]),
                }"
              />
            </v-col>
            <v-col :cols="pair[1] !== 1 && !disabled ? '7' : '8'">
              {{ pair[0] }}
            </v-col>
            <v-spacer />
            <v-col
              cols="2"
              class="type-score shrink mr-1"
            >
              {{ pair[1].toFixed(4) }}
            </v-col>
            <v-col
              v-if="pair[1] !== 1 && !disabled"
              class="shrink"
            >
              <v-tooltip
                open-delay="200"
                bottom
              >
                <template #activator="{ bind, on }">
                  <v-btn
                    x-small
                    icon
                    v-bind="bind"
                    v-on="on"
                    @click="$emit('set-type', pair[0])"
                  >
                    <v-icon>mdi-check</v-icon>
                  </v-btn>
                </template>
                <span>Accept {{ pair[0] }} as correct type</span>
              </v-tooltip>
            </v-col>
          </v-row>
        </span>
      </v-col>
    </template>
  </panel-subsection>
</template>

<style lang="scss">
.type-color-box {
  min-width: 10px;
  max-width: 10px;
  min-height: 10px;
  max-height: 10px;
}
</style>
