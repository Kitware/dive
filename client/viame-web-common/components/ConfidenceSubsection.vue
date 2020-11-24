<script lang="ts">
import {
  defineComponent, PropType,
} from '@vue/composition-api';

import {
  useTypeStyling,
} from 'vue-media-annotator/provides';

import PanelSubsection from 'viame-web-common/components/PanelSubsection.vue';

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
  },
  setup() {
    const typeStylingRef = useTypeStyling();
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
    </template>
    <template slot="scroll-section">
      <v-col dense>
        <v-row
          v-for="(pair, index) in confidencePairs"
          :key="index"
          class="ml-1"
          dense
          style="font-size: 0.8em"
        >
          <v-col cols="1">
            <div
              class="type-color-box"
              :style="{
                backgroundColor: typeStylingRef.color(pair[0]),
              }"
            />
          </v-col>
          <v-col>
            {{ pair[0] }}
          </v-col>
          <v-col>
            {{ pair[1].toFixed(2) }}
          </v-col>
        </v-row>
      </v-col>
    </template>
  </panel-subsection>
</template>

<style lang="scss">
.type-color-box {
  margin-top: 5px;
  min-width: 10px;
  max-width: 10px;
  min-height: 10px;
  max-height: 10px;
}
</style>
