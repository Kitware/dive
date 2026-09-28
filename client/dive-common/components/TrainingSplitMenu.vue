<script lang="ts">
import { defineComponent, PropType, ref } from 'vue';
import { useApi } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { TrainingSplit, TrainingSplitOptions } from 'dive-common/trainingSplit';

/**
 * Sets or clears the training split of the given datasets, then emits
 * `saved` so the host can refresh its listing.
 */
export default defineComponent({
  name: 'TrainingSplitMenu',
  props: {
    datasetIds: {
      type: Array as PropType<string[]>,
      required: true,
    },
    buttonOptions: {
      type: Object,
      default: () => ({}),
    },
    menuOptions: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props, { emit }) {
    const { saveConfig } = useApi();
    const { prompt } = usePrompt();
    const saving = ref(false);

    async function apply(split: TrainingSplit | null) {
      if (saving.value || props.datasetIds.length === 0) return;
      saving.value = true;
      try {
        await Promise.all(props.datasetIds.map((id) => saveConfig(id, { trainingSplit: split })));
        emit('saved', split);
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        await prompt({
          title: 'Unable to Set Split',
          text: status === 403
            ? 'You do not have permission to edit one of the selected datasets.'
            : 'The training split could not be saved.',
          positiveButton: 'OK',
        });
      } finally {
        saving.value = false;
      }
    }

    return { apply, saving, options: TrainingSplitOptions };
  },
});
</script>

<template>
  <v-menu
    v-bind="menuOptions"
    offset-y
  >
    <template #activator="{ on }">
      <v-btn
        v-bind="buttonOptions"
        :loading="saving"
        v-on="on"
      >
        <v-icon>
          mdi-label-multiple-outline
        </v-icon>
        <span class="pl-1">
          Split
        </span>
        <v-spacer />
        <v-icon
          v-if="buttonOptions.block"
          class="ml-2"
        >
          mdi-chevron-right
        </v-icon>
      </v-btn>
    </template>
    <v-list dense>
      <v-list-item
        v-for="option in options"
        :key="option.value"
        @click="apply(option.value)"
      >
        <v-list-item-icon class="mr-2">
          <v-icon :color="option.color">
            mdi-circle
          </v-icon>
        </v-list-item-icon>
        <v-list-item-content>
          <v-list-item-title>{{ option.text }}</v-list-item-title>
          <v-list-item-subtitle>{{ option.hint }}</v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
      <v-divider />
      <v-list-item @click="apply(null)">
        <v-list-item-icon class="mr-2">
          <v-icon>mdi-close-circle-outline</v-icon>
        </v-list-item-icon>
        <v-list-item-content>
          <v-list-item-title>Clear split</v-list-item-title>
        </v-list-item-content>
      </v-list-item>
    </v-list>
  </v-menu>
</template>
