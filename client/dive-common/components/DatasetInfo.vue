<script lang="ts">
import {
  computed, defineComponent, ref, watch,
} from 'vue';
import { useDatasetId, useReadOnlyMode } from 'vue-media-annotator/provides';
import { useApi, DatasetMeta } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import DatasetMetaEditorDialog from 'dive-common/components/DatasetMetaEditorDialog.vue';

export default defineComponent({
  name: 'DatasetInfo',

  components: { DatasetMetaEditorDialog },

  setup() {
    const datasetId = useDatasetId();
    const readOnlyMode = useReadOnlyMode();
    const { loadMetadata, saveMetadata } = useApi();
    const { prompt } = usePrompt();
    const meta = ref<DatasetMeta | null>(null);
    const customMeta = ref<Record<string, unknown>>({});
    const newKey = ref('');
    const newValue = ref('');
    const editorOpen = ref(false);
    const editorKey = ref('');
    const fieldInput = ref<{ focus(): void } | null>(null);

    const fetchMetadata = async () => {
      if (!datasetId.value) {
        meta.value = null;
        customMeta.value = {};
        return;
      }
      meta.value = await loadMetadata(datasetId.value);
      customMeta.value = { ...(meta.value.datasetInfo || {}) };
    };

    watch(datasetId, fetchMetadata, { immediate: true });

    const infoRows = computed(() => {
      const m = meta.value;
      if (!m) {
        return [];
      }
      const rows: { name: string; value: unknown }[] = [
        { name: 'Name', value: m.name },
        { name: 'Type', value: m.type },
        { name: 'FPS', value: m.fps },
      ];
      if (m.originalFps !== undefined && m.originalFps !== null) {
        rows.push({ name: 'Original FPS', value: m.originalFps });
      }
      if (m.subType) {
        rows.push({ name: 'Subtype', value: m.subType });
      }
      if (m.createdAt) {
        // Render the stored ISO timestamp in the user's locale, matching how
        // dates are shown elsewhere (e.g. ImportDialog, RevisionHistory).
        const created = new Date(m.createdAt);
        rows.push({
          name: 'Created',
          value: Number.isNaN(created.getTime()) ? m.createdAt : created.toLocaleString(),
        });
      }
      rows.push({ name: 'ID', value: m.id });
      return rows;
    });

    const customMetaKeys = computed(() => Object.keys(customMeta.value));

    const persist = async () => {
      if (!datasetId.value) {
        return;
      }
      try {
        await saveMetadata(datasetId.value, { datasetInfo: { ...customMeta.value } });
      } catch (err) {
        const saveErr = err as { response?: { status?: number } };
        const status = saveErr.response?.status;
        const text = status === 403
          ? 'You do not have permission to save metadata to this dataset.'
          : 'Unable to save dataset metadata.';
        // Keep the user's edits on screen and let them retry the save manually.
        const retry = await prompt({
          title: 'Error while Saving Metadata',
          text,
          positiveButton: 'Retry',
          negativeButton: 'Dismiss',
          confirm: true,
        });
        if (retry) {
          await persist();
        }
      }
    };

    const applyMeta = (next: Record<string, unknown>) => {
      customMeta.value = next;
      persist();
    };

    const updateEntry = (key: string, value: string) => {
      applyMeta({ ...customMeta.value, [key]: value });
    };

    const removeEntry = (key: string) => {
      const next = { ...customMeta.value };
      delete next[key];
      applyMeta(next);
    };

    const addEntry = () => {
      const key = newKey.value.trim();
      if (!key) {
        return;
      }
      updateEntry(key, newValue.value);
      newKey.value = '';
      newValue.value = '';
      // Return the cursor to the Field input for rapid successive entry.
      fieldInput.value?.focus();
    };

    // Custom metadata values are unknown-typed but edited as text, so coerce to
    // a string for the editor (matching how inline edits are already stored).
    // Objects only occur for externally-set values; render them as readable JSON
    // rather than the useless "[object Object]" that toString() would produce.
    const editorValue = computed(() => {
      const value = customMeta.value[editorKey.value];
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
      readOnlyMode,
      infoRows,
      customMeta,
      customMetaKeys,
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
  <div>
    <v-container>
      <v-list
        v-if="infoRows.length"
        dense
        class="py-0"
      >
        <v-list-item
          v-for="row in infoRows"
          :key="`datasetInfo_${row.name}`"
          class="px-1"
        >
          <v-list-item-content class="d-block py-1">
            <v-list-item-subtitle class="font-weight-medium wrap-text">
              {{ row.name }}
            </v-list-item-subtitle>
            <div class="wrap-text">
              {{ row.value?.toString() ?? '' }}
            </div>
          </v-list-item-content>
        </v-list-item>
      </v-list>
      <div
        v-else
        class="pa-2 grey--text"
      >
        No dataset metadata available.
      </div>

      <div class="text-subtitle-1 font-weight-medium px-1 pt-3 pb-1">
        Custom Metadata
      </div>
      <v-divider />

      <div
        v-if="!customMetaKeys.length && readOnlyMode"
        class="pa-2 grey--text"
      >
        No custom metadata.
      </div>

      <v-list
        dense
        class="py-0"
      >
        <v-list-item
          v-for="key in customMetaKeys"
          :key="`customMeta_${key}`"
          class="px-1"
        >
          <v-list-item-content class="d-block py-1">
            <v-list-item-subtitle class="font-weight-medium wrap-text">
              {{ key }}
            </v-list-item-subtitle>
            <div class="d-flex align-center">
              <v-text-field
                v-if="!readOnlyMode"
                :value="customMeta[key]"
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
                {{ customMeta[key] }}
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
                v-if="!readOnlyMode"
                icon
                small
                class="flex-shrink-0"
                :aria-label="`Delete ${key}`"
                :title="`Delete ${key}`"
                @click="removeEntry(key)"
              >
                <v-icon small>
                  mdi-delete
                </v-icon>
              </v-btn>
            </div>
          </v-list-item-content>
        </v-list-item>
      </v-list>

      <div
        v-if="!readOnlyMode"
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
          aria-label="Add metadata field"
          title="Add metadata field"
          @click="addEntry"
        >
          <v-icon>mdi-plus</v-icon>
        </v-btn>
      </div>
    </v-container>

    <DatasetMetaEditorDialog
      v-model="editorOpen"
      :field-name="editorKey"
      :field-value="editorValue"
      :readonly="readOnlyMode"
      @save="saveEditor"
    />
  </div>
</template>

<style scoped>
.wrap-text {
  white-space: normal !important;
  overflow-wrap: anywhere;
}

/* Let the read-only value shrink below its content width so text-truncate can
   ellipsize a long value instead of pushing the action buttons off the row. */
.min-width-0 {
  min-width: 0;
}
</style>
