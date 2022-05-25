<script lang="ts">
import { computed, defineComponent, PropType } from '@vue/composition-api';

import { useGroupFilterControls, useHandler, useReadOnlyMode } from '../provides';
import Group from '../Group';

import TypePicker from './TypePicker.vue';

export default defineComponent({
  name: 'GroupItem',

  components: { TypePicker },

  props: {
    group: {
      type: Object as PropType<Group>,
      required: true,
    },
    color: {
      type: String,
      required: true,
    },
    selected: {
      type: Boolean,
      required: true,
    },
    secondarySelected: {
      type: Boolean,
      required: true,
    },
    selectedTrackId: {
      type: [Number, null] as PropType<number | null>,
      default: null,
    },
    inputValue: {
      type: Boolean,
      required: true,
    },
  },

  setup(props, { root }) {
    const vuetify = root.$vuetify;
    const groupFilters = useGroupFilterControls();
    const readOnlyMode = useReadOnlyMode();
    const handler = useHandler();

    const style = computed(() => {
      if (props.selected) {
        return {
          'background-color': `${vuetify.theme.themes.dark.accentBackground}`,
        };
      }
      if (props.secondarySelected) {
        return {
          'background-color': '#3a3a3a',
        };
      }
      return {};
    });

    return {
      style,
      groupFilters,
      readOnlyMode,
      handler,
    };
  },
});
</script>

<template>
  <div
    class="px-1"
    :style="style"
  >
    <v-row
      class="pt-2"
      no-gutters
    >
      <v-checkbox
        class="my-0 ml-0 pt-0"
        dense
        hide-details
        :input-value="inputValue"
        :color="color"
        @change="groupFilters.updateCheckedId(group.id, $event)"
      />
      <v-tooltip
        open-delay="200"
        bottom
        max-width="200"
        :disabled="group.id.toString().length < 8"
      >
        <template #activator="{ on }">
          <div
            class="trackNumber pl-0 pr-2"
            v-on="on"
            @click.self="handler.groupEdit(group.id)"
          >
            {{ group.id }}
          </div>
        </template>
        <span> {{ group.id }} </span>
      </v-tooltip>
      <v-spacer />
      <TypePicker
        :value="group.getType()[0]"
        :all-types="groupFilters.allTypes.value"
        :read-only-mode="readOnlyMode"
        data-list-source="allGroupTypesOptions"
        @input="group.setType($event)"
      />
    </v-row>
    <v-row
      no-gutters
      class="mt-1"
    >
      <v-spacer />
      <div class="text-caption grey--text text--lighten-1">
        {{ group.memberIds.join(', ') }}
      </div>
    </v-row>
  </div>
</template>

<style lang="scss" scoped>
@import 'src/components/styles/common.scss';

.freeform-input {
  width: 150px;
}
</style>
