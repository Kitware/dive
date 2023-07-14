<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import { throttle } from 'lodash';
import { useTrackFilters } from 'vue-media-annotator/provides';

export default defineComponent({
  name: 'AttributeTrackFilter',
  props: {

  },
  setup() {
    const trackFilters = useTrackFilters();
    const baseFilter = computed(() => {
      if (trackFilters.attributeFilters.value.length > 0) {
        return trackFilters.attributeFilters.value[0];
      }
      return null;
    });
    const enabled = computed(() => (baseFilter ? trackFilters.enabledFilters.value[0] : false));
    const range = computed(() => baseFilter.value?.filter?.range || [0, 1.0]);
    const value = computed(() => {
      if (baseFilter.value) {
        return trackFilters.userDefinedValues.value[0];
      }
      return null;
    });

    function setEnabled(val: boolean) {
      trackFilters.setEnabled(0, val);
    }
    function _updateValue(event: InputEvent) {
      if (event.target) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore
        trackFilters.setUserDefinedValue(0, Number.parseFloat(event.target.value));
      }
    }
    const updateValue = throttle(_updateValue, 100);
    return {
      updateValue,
      baseFilter,
      value,
      range,
      trackFilters,
      enabled,
      setEnabled,
    };
  },
});
</script>

<template>
  <div v-if="baseFilter && value !== null">
    <div
      class="text-body-2 grey--text text--lighten-1 d-flex flex-row py-0"
    >
      <v-checkbox
        :input-value="enabled"
        :label="baseFilter.name"
        dense
        shrink
        hide-details
        class="ma-0 pa-0"
        @change="setEnabled($event)"
      />

      <v-spacer v-if="!$scopedSlots.default" />
      <span
        v-if="(typeof value === 'number')"
        class="pl-2"
      >
        {{ baseFilter.type }} attribute: <b> {{ baseFilter.attribute }} </b>
      </span>
      <v-spacer v-if="$scopedSlots.default" />
      <slot />
    </div>
    <div
      class="text-body-2 grey--text text--lighten-1 d-flex flex-row py-0"
    >
      <span
        v-if="(typeof value === 'number')"
        class="pl-2"
      >
        {{ value.toFixed(2) }}
      </span>
    </div>
    <input
      v-if="!$scopedSlots.default"
      type="range"
      style="width: 100%"
      :min="range[0]"
      :max="range[1]"
      :step="0.01"
      :value="value"
      :disabled="!enabled"
      persistent-hint
      @input="updateValue"
    >
  </div>
</template>
