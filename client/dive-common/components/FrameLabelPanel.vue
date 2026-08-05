<script lang="ts">
import {
  computed, defineComponent, ref, PropType,
} from 'vue';
import { useTrackStyleManager } from 'vue-media-annotator/provides';
import { clientSettings } from 'dive-common/store/settings';

export default defineComponent({
  name: 'FrameLabelPanel',

  props: {
    value: {
      type: Boolean,
      default: false,
    },
    activeLabel: {
      type: String as PropType<string | null>,
      default: null,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },

  setup() {
    const { typeStyling } = useTrackStyleManager();
    const newLabel = ref('');
    const labels = computed(() => clientSettings.frameLabelSettings.labels);

    function addLabel() {
      const label = newLabel.value.trim();
      if (label && !labels.value.includes(label) && labels.value.length < 9) {
        clientSettings.frameLabelSettings.labels.push(label);
      }
      newLabel.value = '';
    }

    function removeLabel(label: string) {
      const index = labels.value.indexOf(label);
      if (index >= 0) {
        clientSettings.frameLabelSettings.labels.splice(index, 1);
      }
    }

    return {
      labels,
      newLabel,
      addLabel,
      removeLabel,
      typeStyling,
    };
  },
});
</script>

<template>
  <div class="px-2 py-1">
    <v-divider />
    <div class="d-flex align-center">
      <v-switch
        :input-value="value"
        :disabled="disabled || labels.length === 0"
        label="Frame label mode"
        dense
        hide-details
        class="my-1 py-0"
        @change="$emit('input', !!$event)"
      />
      <v-spacer />
      <v-tooltip
        open-delay="200"
        bottom
        max-width="300"
      >
        <template #activator="{ on }">
          <v-icon
            small
            class="mr-1"
            v-on="on"
          >
            mdi-help-circle
          </v-icon>
        </template>
        <span>
          While enabled, keys 1-9 label all frames from the current frame
          forward with the corresponding label, until the next labeled event
          or the end of the video. Press 0 to end the current label without
          starting a new one. Labels are saved as full-frame tracks.
        </span>
      </v-tooltip>
    </div>
    <div
      v-if="value && activeLabel !== null"
      class="text-caption mb-1"
    >
      Current frame:
      <v-chip
        x-small
        :color="typeStyling.color(activeLabel)"
        class="ml-1"
      >
        {{ activeLabel }}
      </v-chip>
    </div>
    <div
      v-for="(label, index) in labels"
      :key="label"
      class="d-flex align-center my-1"
    >
      <v-chip
        x-small
        outlined
        class="mr-2 px-1 hotkey-chip"
      >
        {{ index + 1 }}
      </v-chip>
      <span
        class="text-body-2 text-truncate"
        :style="{ color: typeStyling.color(label) }"
      >
        {{ label }}
      </span>
      <v-spacer />
      <v-btn
        icon
        x-small
        :disabled="disabled"
        @click="removeLabel(label)"
      >
        <v-icon x-small>
          mdi-close
        </v-icon>
      </v-btn>
    </div>
    <v-text-field
      v-model="newLabel"
      :disabled="disabled || labels.length >= 9"
      label="Add label"
      dense
      hide-details
      class="my-1"
      @keydown.enter="addLabel"
    >
      <template #append>
        <v-btn
          icon
          x-small
          :disabled="!newLabel.trim()"
          @click="addLabel"
        >
          <v-icon small>
            mdi-plus
          </v-icon>
        </v-btn>
      </template>
    </v-text-field>
  </div>
</template>

<style scoped>
.hotkey-chip {
  font-family: monospace;
}
</style>
