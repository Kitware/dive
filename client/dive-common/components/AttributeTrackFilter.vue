<script lang="ts">
/* eslint-disable max-len */
import { computed, defineComponent } from '@vue/composition-api';
import { throttle } from 'lodash';
import { useTrackFilters } from 'vue-media-annotator/provides';

export default defineComponent({
  name: 'AttributeTrackFilter',
  props: {
    filterIndex: {
      type: Number,
      default: 0,
    },
    editable: {
      type: Boolean,
      default: false,
    },
  },
  setup(props) {
    const trackFilters = useTrackFilters();
    const baseFilter = computed(() => {
      if (trackFilters.attributeFilters.value.length > 0
        && trackFilters.attributeFilters.value[props.filterIndex]) {
        return trackFilters.attributeFilters.value[props.filterIndex];
      }
      return null;
    });
    const enabled = computed(() => (baseFilter ? trackFilters.enabledFilters.value[props.filterIndex] : false));
    const range = computed(() => baseFilter.value?.filter?.range || [0, 1.0]);
    const value = computed(() => {
      if (baseFilter.value) {
        return trackFilters.userDefinedValues.value[props.filterIndex];
      }
      return null;
    });

    function setEnabled(val: boolean) {
      trackFilters.setEnabled(props.filterIndex, val);
    }
    function _updateValue(event: InputEvent) {
      if (event.target) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore
        trackFilters.setUserDefinedValue(props.filterIndex, Number.parseFloat(event.target.value));
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
    <v-row
      v-if="editable"
      dense
    >
      <v-spacer />
      <v-icon
        small
        class="mx-2"
        @click="$emit('edit', filterIndex)"
      >
        mdi-pencil
      </v-icon>
      <v-icon
        color="error"
        small
        @click="$emit('delete', filterIndex)"
      >
        mdi-delete
      </v-icon>
    </v-row>
    <div
      class="text-body-2 grey--text text--lighten-1 d-flex flex-row py-0"
    >
      <v-checkbox
        :input-value="enabled"
        dense
        shrink
        hide-details
        class="ma-0 pa-0"
        @change="setEnabled($event)"
      />
      <span> {{ baseFilter.name }}</span>

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

<style scoped>
.filter-text {
  font-size: 0.75em;
}
</style>
