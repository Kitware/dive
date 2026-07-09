<script lang="ts">
import {
  computed, defineComponent, PropType, ref,
} from 'vue';

import type { DatasetInfoFields } from 'dive-common/apispec';
import DatasetInfoFieldDialog from 'dive-common/components/DatasetInfo/DatasetInfoFieldDialog.vue';

export default defineComponent({
  name: 'CustomDatasetInfoPanel',

  components: { DatasetInfoFieldDialog },

  props: {
    datasetInfo: {
      type: Object as PropType<DatasetInfoFields>,
      required: true,
    },
    readOnly: {
      type: Boolean,
      default: false,
    },
  },

  setup(props, { emit }) {
    const newKey = ref('');
    const newValue = ref('');
    const editorOpen = ref(false);
    const editorKey = ref('');
    const fieldInput = ref<{ focus(): void } | null>(null);

    const datasetInfoKeys = computed(() => Object.keys(props.datasetInfo));

    const emitDatasetInfo = (next: DatasetInfoFields) => {
      emit('change', next);
    };

    const updateEntry = (key: string, value: string) => {
      emitDatasetInfo({ ...props.datasetInfo, [key]: value });
    };

    const removeEntry = (key: string) => {
      const next = { ...props.datasetInfo };
      delete next[key];
      emitDatasetInfo(next);
    };

    const addEntry = () => {
      const key = newKey.value.trim();
      if (!key) {
        return;
      }
      updateEntry(key, newValue.value);
      newKey.value = '';
      newValue.value = '';
      fieldInput.value?.focus();
    };

    const editorValue = computed(() => {
      const value = props.datasetInfo[editorKey.value];
      if (value === undefined || value === null) {
        return '';
      }
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    });

    const openEditor = (key: string) => {
      editorKey.value = key;
      editorOpen.value = true;
    };

    const saveEditor = (value: string) => {
      updateEntry(editorKey.value, value);
    };

    return {
      datasetInfoKeys,
      newKey,
      newValue,
      fieldInput,
      updateEntry,
      removeEntry,
      addEntry,
      editorOpen,
      editorKey,
      editorValue,
      openEditor,
      saveEditor,
    };
  },
});
</script>

<template>
  <v-expansion-panel class="custom-dataset-info-section mt-3">
    <v-expansion-panel-header class="dataset-info-panel-header px-1 py-1 text-subtitle-1 font-weight-medium">
      Custom Dataset Info
    </v-expansion-panel-header>
    <v-divider />

    <v-expansion-panel-content class="dataset-info-panel-content">
      <div
        v-if="!datasetInfoKeys.length && readOnly"
        class="pa-2 grey--text"
      >
        No custom dataset info.
      </div>

      <v-list
        dense
        class="py-0"
      >
        <v-list-item
          v-for="key in datasetInfoKeys"
          :key="`customDatasetInfo_${key}`"
          class="px-1"
        >
          <v-list-item-content class="d-block py-1">
            <v-list-item-subtitle class="font-weight-medium wrap-text">
              {{ key }}
            </v-list-item-subtitle>
            <div class="d-flex align-center">
              <v-text-field
                v-if="!readOnly"
                :value="datasetInfo[key]"
                dense
                hide-details
                single-line
                class="pt-0 mt-0"
                @change="updateEntry(key, $event)"
              />
              <span
                v-else
                class="text-truncate flex-grow-1 min-width-0"
              >
                {{ datasetInfo[key] }}
              </span>
              <v-btn
                icon
                small
                class="ml-1 flex-shrink-0"
                :aria-label="`Expand ${key}`"
                :title="`Expand ${key}`"
                @click="openEditor(key)"
              >
                <v-icon small>
                  mdi-arrow-expand
                </v-icon>
              </v-btn>
              <v-btn
                v-if="!readOnly"
                icon
                small
                class="flex-shrink-0"
                :aria-label="`Delete ${key}`"
                :title="`Delete ${key}`"
                @click="removeEntry(key)"
              >
                <v-icon small color="error">
                  mdi-delete
                </v-icon>
              </v-btn>
            </div>
          </v-list-item-content>
        </v-list-item>
      </v-list>

      <div
        v-if="!readOnly"
        class="d-flex align-center px-1 pt-1"
      >
        <v-text-field
          ref="fieldInput"
          v-model="newKey"
          label="Field"
          dense
          hide-details
          single-line
          class="pt-0 mt-0 mr-1"
          @keyup.enter="addEntry"
        />
        <v-text-field
          v-model="newValue"
          label="Value"
          dense
          hide-details
          single-line
          class="pt-0 mt-0 mr-1"
          @keyup.enter="addEntry"
        />
        <v-btn
          icon
          small
          :disabled="!newKey.trim()"
          aria-label="Add dataset info field"
          title="Add dataset info field"
          @click="addEntry"
        >
          <v-icon>mdi-plus</v-icon>
        </v-btn>
      </div>
    </v-expansion-panel-content>

    <DatasetInfoFieldDialog
      v-model="editorOpen"
      :field-name="editorKey"
      :field-value="editorValue"
      :readonly="readOnly"
      @save="saveEditor"
    />
  </v-expansion-panel>
</template>

<style scoped>
.wrap-text {
  white-space: normal !important;
  overflow-wrap: anywhere;
}

.dataset-info-panel-header {
  min-height: 32px;
}

.min-width-0 {
  min-width: 0;
}
</style>
