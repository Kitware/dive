<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, ref, watch,
} from 'vue';
import { useReadOnlyMode, useTrackFilters } from 'vue-media-annotator/provides';
import { clientSettings } from 'dive-common/store/settings';
import { CategoryImport, parseCategoryFile } from '../categoryImport';
import WormsImport from './WormsImport.vue';
import { resolveTypeHierarchy } from '../typeHierarchy';

export default defineComponent({
  name: 'CategoryImportDialog',
  components: { WormsImport },
  setup(props, { emit }) {
    const filters = useTrackFilters();
    const readOnlyMode = useReadOnlyMode();
    const source = ref('file');
    const wormsImport = ref<CategoryImport | null>(null);
    const pastedTypes = ref('');
    const file = ref<File | null>(null);
    const parsedFile = ref<CategoryImport | null>(null);
    const loading = ref(false);
    const fileError = ref('');
    const applyError = ref('');
    watch(source, () => {
      applyError.value = '';
    });
    function setWormsImport(incoming: CategoryImport | null) {
      if (!incoming || readOnlyMode.value) return;
      try {
        const current = preview.value.incoming;
        const resolved = resolveTypeHierarchy(current?.typeHierarchy ?? null, true, incoming.typeHierarchy ?? {}, 'additive');
        const staged: CategoryImport = {
          types: [...new Set([...(current?.types ?? []), ...incoming.types])],
          typeHierarchy: resolved.action === 'set' ? resolved.hierarchy : current?.typeHierarchy,
          taxonomySources: { ...current?.taxonomySources, ...incoming.taxonomySources },
          warnings: [...new Set([...(current?.warnings ?? []), ...incoming.warnings])],
        };
        // Staging does not change the dataset. Only Add on the shared page does.
        readVersion += 1;
        loading.value = false;
        file.value = null;
        parsedFile.value = null;
        fileError.value = '';
        wormsImport.value = staged;
        pastedTypes.value = staged.types.join('\n');
        applyError.value = '';
        source.value = 'file';
      } catch (error) {
        applyError.value = error instanceof Error ? error.message : 'Unable to stage WoRMS types.';
      }
    }
    watch(pastedTypes, () => { applyError.value = ''; });
    let readVersion = 0;
    onBeforeUnmount(() => { readVersion += 1; });

    async function selectFile(selected: File | null) {
      readVersion += 1;
      const version = readVersion;
      wormsImport.value = null;
      file.value = selected;
      parsedFile.value = null;
      fileError.value = '';
      applyError.value = '';
      loading.value = !!selected;
      if (!selected) return;
      try {
        const contents = await selected.text();
        if (version !== readVersion) return;
        parsedFile.value = parseCategoryFile(contents, selected.name);
      } catch (error) {
        if (version === readVersion) {
          fileError.value = error instanceof Error ? error.message : 'Unable to read category file.';
        }
      } finally {
        if (version === readVersion) loading.value = false;
      }
    }

    const preview = computed(() => {
      let incoming: CategoryImport | null = file.value ? parsedFile.value : {
        types: [...new Set(pastedTypes.value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean))],
        warnings: [],
      };
      if (!file.value && wormsImport.value) {
        incoming = { ...wormsImport.value, types: incoming?.types ?? [] };
      }
      if (!incoming) {
        return {
          incoming: null, names: [], edges: [], error: '',
        };
      }
      const edges = Object.entries(incoming.typeHierarchy ?? {});
      const names = [...new Set([...incoming.types, ...edges.flat()])];
      try {
        resolveTypeHierarchy(filters.typeHierarchy.value ?? null, true, incoming.typeHierarchy ?? {}, 'additive');
        return {
          incoming, names, edges, error: '',
        };
      } catch (error) {
        return {
          incoming, names, edges, error: error instanceof Error ? error.message : 'Invalid hierarchy.',
        };
      }
    });
    const errorMessage = computed(() => (source.value === 'file' ? fileError.value : '') || preview.value.error || applyError.value);
    const canImport = computed(() => source.value === 'file' && !readOnlyMode.value && !loading.value
      && !errorMessage.value && preview.value.names.length > 0);

    function confirmImport() {
      if (!canImport.value || !preview.value.incoming) return;
      try {
        const { types, typeHierarchy, taxonomySources } = preview.value.incoming;
        filters.importCategoryDefinitions(types, typeHierarchy, taxonomySources);
        clientSettings.typeSettings.showEmptyTypes = true;
        clientSettings.typeSettings.filterTypesByFrame = false;
        emit('close');
      } catch (error) {
        applyError.value = error instanceof Error ? error.message : 'Unable to import categories.';
      }
    }
    return {
      source,
      readOnlyMode,
      wormsImport,
      setWormsImport,
      pastedTypes,
      file,
      loading,
      selectFile,
      preview,
      errorMessage,
      canImport,
      confirmImport,
    };
  },
});
</script>

<template>
  <v-card>
    <v-card-title>
      Import Types
      <v-spacer />
      <v-btn icon small aria-label="Close import" @click="$emit('close')">
        <v-icon small>
          mdi-close
        </v-icon>
      </v-btn>
    </v-card-title>
    <v-card-text>
      <v-tabs v-model="source" class="mb-4">
        <v-tab href="#file">
          File or pasted list
        </v-tab>
        <v-tab href="#worms">
          WoRMS
        </v-tab>
      </v-tabs>
      <WormsImport v-if="source === 'worms'" :disabled="readOnlyMode" @prepared="setWormsImport" />
      <template v-if="source === 'file'">
        <p>Choose a COCO JSON or VIAME category file, or paste one type per line.</p>
        <v-file-input
          :value="file"
          accept=".txt,.csv,.json"
          label="Category file (.txt, .csv, .json)"
          :loading="loading"
          clearable
          @change="selectFile"
        />
        <v-textarea
          v-if="!file"
          v-model="pastedTypes"
          label="One type per line"
          :readonly="!!wormsImport"
          outlined
          rows="6"
        />
        <v-btn v-if="wormsImport" small text @click="wormsImport = null; pastedTypes = ''">
          Clear staged types
        </v-btn>
      </template>
      <v-alert v-if="errorMessage" type="error" dense>
        {{ errorMessage }} No type changes were applied.
      </v-alert>
      <template v-if="source === 'file' && preview.incoming && preview.names.length">
        <p>{{ preview.names.length }} types; {{ preview.edges.length }} parent relationships.</p>
        <div class="category-preview mb-3">
          <div v-for="name in preview.names.slice(0, 100)" :key="name">
            {{ name }}
          </div>
          <div v-if="preview.names.length > 100">
            Showing the first 100 types.
          </div>
          <div v-for="[child, parent] in preview.edges.slice(0, 100)" :key="`${child}:${parent}`">
            {{ parent }} → {{ child }}
          </div>
          <div v-if="preview.edges.length > 100">
            Showing the first 100 relationships.
          </div>
        </div>
        <v-alert v-for="warning in preview.incoming.warnings" :key="warning" type="warning" dense>
          {{ warning }}
        </v-alert>
      </template>
      <p>Types are added to the current dataset. Existing types and parent relationships are retained.</p>
      <p>Imported types are shown even when they have no annotations.</p>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn text @click="$emit('close')">
        Cancel
      </v-btn>
      <v-btn v-if="source === 'file'" color="primary" :disabled="!canImport" @click="confirmImport">
        Add
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<style scoped>
.category-preview {
  max-height: 220px;
  overflow-y: auto;
  white-space: pre-wrap;
}
</style>
