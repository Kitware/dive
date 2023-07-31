<script lang="ts">
/* eslint-disable max-len */
import { computed, defineComponent, ref } from '@vue/composition-api';
import { throttle } from 'lodash';
import { useAttributes, useTrackFilters, useTrackStyleManager } from 'vue-media-annotator/provides';

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
    const typeStylingRef = useTrackStyleManager().typeStyling;

    const trackFilters = useTrackFilters();
    const attributes = useAttributes();
    const baseFilter = computed(() => {
      if (trackFilters.attributeFilters.value.length > 0
        && trackFilters.attributeFilters.value[props.filterIndex]) {
        return trackFilters.attributeFilters.value[props.filterIndex];
      }
      return null;
    });
    const enabled = computed(() => (baseFilter ? trackFilters.enabledFilters.value[props.filterIndex] : false));
    const range = computed(() => baseFilter.value?.filter?.range || [0, 1.0]);
    const attrType = computed(() => {
      if (baseFilter.value) {
        const filtered = attributes.value.filter((item) => {
          if (baseFilter.value) {
            return item.name === baseFilter.value.attribute;
          }
          return false;
        });
        if (filtered.length > 0) {
          return filtered[0].datatype;
        }
      }
      return null;
    });

    const value = computed(() => {
      if (baseFilter.value) {
        const val = trackFilters.userDefinedValues.value[props.filterIndex];
        if (attrType.value === 'number' && val !== null) {
          if (typeof val === 'string') {
            return parseFloat(val);
          } if (typeof val === 'number') {
            return val;
          }
        } else {
          return val;
        }
      }
      return null;
    });
    const typeConversion = ref({ text: 'string', number: 'number', boolean: 'boolean' });
    const inputFilter = ref(['=', '!=', '>', '<', '>=', '<=', 'contains']);
    function setEnabled(val: boolean) {
      trackFilters.setEnabled(props.filterIndex, val);
      if (val) {
        trackFilters.setUserDefinedValue(props.filterIndex, value.value);
      }
    }
    function _updateValue(event: Event) {
      const target: HTMLInputElement = event.target as HTMLInputElement;
      if (target) {
        if (attrType.value === 'number') {
          const val = Number.parseFloat(target.value);
          trackFilters.setUserDefinedValue(props.filterIndex, val);
        } else if (attrType.value === 'text') {
          trackFilters.setUserDefinedValue(props.filterIndex, target.value);
        }
      }
    }

    function updateCombo(event: string[]) {
      trackFilters.setUserDefinedValue(props.filterIndex, event);
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
      attrType,
      inputFilter,
      typeConversion,
      updateCombo,
      typeStylingRef,
    };
  },
});
</script>

<template>
  <div v-if="baseFilter">
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

      <v-spacer />
      <v-tooltip
        right
        max-width="200"
      >
        <template #activator="{ on }">
          <v-btn
            small
            icon
            v-on="on"
          >
            <v-icon small>
              mdi-information
            </v-icon>
          </v-btn>
        </template>
        <span>
          <span>
            <div>
              <b>Attribute:</b> <span>{{ baseFilter.attribute }}</span>
            </div>

            <div>
              <b>Type:</b> <span>{{ baseFilter.type }}</span>
            </div>

            <div v-if="!baseFilter.filter.userDefined">
              <b>Value:</b> <span>{{ baseFilter.filter.op }} {{ baseFilter.filter.val }}</span>
            </div>
            <div v-if="baseFilter.typeFilter.length">
              <b>Types:</b>
              <span
                v-for="trackType in baseFilter.typeFilter"
                :key="`${baseFilter.name}_${trackType}`"
                class="mx-1"
              >
                <v-chip
                  :color="typeStylingRef.color(trackType)"
                  text-color="#555555"
                >
                  {{ trackType }}
                </v-chip>

              </span>
            </div>
            <div v-if="baseFilter.filter.userDefined">
              <div>
                <b>User Defined Value:</b> <span>{{ baseFilter.filter.op }} {{ value }}</span>
              </div>
              <div>
                <b>Default Value:</b> <span>{{ baseFilter.filter.val }}</span>
              </div>
            </div>

          </span>

        </span>
      </v-tooltip>
    </div>
    <div
      class="text-body-2 grey--text text--lighten-1 d-flex flex-row py-0"
    >
      <span
        v-if="attrType === 'number' && typeof value === 'number' && (!baseFilter.filter.userDefined || baseFilter.filter.op === 'rangeFilter')"
        class="pl-2"
      >
        {{ value.toFixed(2) }}
      </span>
      <span
        v-if="attrType === 'text' && typeof value === 'string' && (!baseFilter.filter.userDefined || baseFilter.filter.op === 'rangeFilter')"
        class="pl-2"
      >
        {{ value }}
      </span>
    </div>
    <div v-if="!baseFilter.filter.userDefined">
      Value {{ baseFilter.filter.op }} {{ baseFilter.filter.val }}
    </div>
    <input
      v-else-if="baseFilter.filter.op === 'rangeFilter' && baseFilter.filter.userDefined"
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
    <div
      v-else-if="baseFilter.filter.op !== 'in'"
      class="my-1"
    >
      <span> Value {{ baseFilter.filter.op }}</span>
      <span class="mx-2">
        <input
          v-if="inputFilter.includes(baseFilter.filter.op) && attrType === 'number'"
          :value="value"
          type="number"
          :step="0.01"
          :disabled="!enabled"
          class="input-box"
          @input="updateValue"
        >
        <input
          v-else-if="inputFilter.includes(baseFilter.filter.op) && attrType === 'text'"
          :value="value"
          type="text"
          :disabled="!enabled"
          class="input-box"
          @change="updateValue"
        >
      </span>
    </div>
    <div v-else-if="baseFilter.filter.op === 'in'">
      <div>Value in </div>
      <v-row dense>
        <v-combobox
          if="baseFilter.filter.op === 'in' && attrType === 'text'"
          multiple
          chips
          deletable-chips
          clearable
          dense
          :value="value"
          :disabled="!enabled"
          class="input-box"
          @change="updateCombo"
        />
      </v-row>
    </div>
  </div>
</template>

<style scoped>
.filter-text {
  font-size: 0.75em;
}
.input-box {
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    padding: 0 6px;
    width: 110px;
    color: white;
  }

</style>
