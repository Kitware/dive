<script lang="ts">
import {
  computed, defineComponent, PropType, ref, toRef, watch,
} from 'vue';
import { compareTypeNames } from 'dive-common/typeHierarchy';

const MAX_PARENT_OPTIONS = 50;

export default defineComponent({
  name: 'ParentTypePicker',

  props: {
    value: {
      type: String as PropType<string | null>,
      default: null,
    },
    allTypes: {
      type: Array as PropType<string[]>,
      required: true,
    },
    excludedTypes: {
      type: Array as PropType<string[]>,
      required: true,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    errorMessage: {
      type: String,
      default: '',
    },
  },

  setup(props, { emit }) {
    const search = ref(props.value);
    watch(toRef(props, 'value'), (value) => { search.value = value; });

    const query = computed(() => {
      const text = search.value ?? '';
      return text === props.value ? '' : text;
    });
    const searchValid = computed(() => query.value === '');
    watch(searchValid, (valid) => emit('search-valid', valid), {
      immediate: true,
      flush: 'sync',
    });

    const options = computed(() => {
      const excluded = new Set(props.excludedTypes);
      const lowerQuery = query.value.toLowerCase();
      const prefixMatches: string[] = [];
      const substringMatches: string[] = [];
      props.allTypes.forEach((type) => {
        if (excluded.has(type)) {
          return;
        }
        const candidate = type.toLowerCase();
        if (candidate.startsWith(lowerQuery)) {
          prefixMatches.push(type);
        } else if (candidate.includes(lowerQuery)) {
          substringMatches.push(type);
        }
      });
      prefixMatches.sort(compareTypeNames);
      substringMatches.sort(compareTypeNames);

      const currentParent = props.value;
      const matches = [...prefixMatches, ...substringMatches]
        .filter((type) => type !== currentParent);
      if (currentParent !== null && !excluded.has(currentParent)) {
        matches.unshift(currentParent);
      }
      return matches.slice(0, MAX_PARENT_OPTIONS);
    });

    return { search, searchValid, options };
  },
});
</script>

<template>
  <v-autocomplete
    :value="value"
    :search-input.sync="search"
    :items="options"
    no-filter
    :disabled="disabled"
    label="Parent Type"
    placeholder="Top level"
    hint="Select the immediate parent. Clear to make this type top-level."
    no-data-text="No matching type. Add it from Type Settings first."
    :error-messages="searchValid
      ? errorMessage
      : 'Select an existing type from the list, or clear the field.'"
    clearable
    auto-select-first
    persistent-hint
    @input="$emit('input', $event)"
  />
</template>
