<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, ref, watch,
} from 'vue';
import { useReadOnlyMode, useTrackFilters } from 'vue-media-annotator/provides';
import { clientSettings } from 'dive-common/store/settings';
import { CategoryImport, parseCategoryFile } from '../categoryImport';
import WormsImport from './WormsImport.vue';
import {
  flattenHierarchyForest, pruneHierarchyUpward, resolveTypeHierarchy,
} from '../typeHierarchy';
import {
  groupSynonymRemaps, synonymRemapSummary, SynonymRemap, TaxonomySources,
} from '../worms';

function mergeSynonymRemaps(
  current: SynonymRemap[] | undefined,
  incoming: SynonymRemap[] | undefined,
): SynonymRemap[] | undefined {
  if (!current?.length && !incoming?.length) return undefined;
  const merged = new Map<string, SynonymRemap>();
  [...(current ?? []), ...(incoming ?? [])].forEach((remap) => {
    merged.set(`${remap.original}\0${remap.accepted}`, remap);
  });
  return [...merged.values()];
}

function withoutRemovedSources(
  sources: TaxonomySources | undefined,
  removed: ReadonlySet<string>,
): TaxonomySources | undefined {
  if (!sources) return undefined;
  const next = Object.fromEntries(
    Object.entries(sources).filter(([, record]) => !removed.has(record.scientificName)),
  );
  return Object.keys(next).length ? next : undefined;
}

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
    const showSynonymDetails = ref(false);
    watch(source, () => {
      applyError.value = '';
    });
    function setWormsImport(incoming: CategoryImport | null) {
      if (!incoming || readOnlyMode.value) return;
      try {
        const current = preview.value.incoming;
        const resolved = resolveTypeHierarchy(current?.typeHierarchy ?? null, true, incoming.typeHierarchy ?? {}, 'additive');
        const synonymRemaps = mergeSynonymRemaps(current?.synonymRemaps, incoming.synonymRemaps);
        const staged: CategoryImport = {
          types: [...new Set([...(current?.types ?? []), ...incoming.types])],
          typeHierarchy: resolved.action === 'set' ? resolved.hierarchy : current?.typeHierarchy,
          taxonomySources: { ...current?.taxonomySources, ...incoming.taxonomySources },
          synonymRemaps,
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
        showSynonymDetails.value = false;
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
      showSynonymDetails.value = false;
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
          incoming: null, names: [], edges: [], tree: [], error: '',
        };
      }
      const edges = Object.entries(incoming.typeHierarchy ?? {});
      const names = [...new Set([...incoming.types, ...edges.flat()])];
      const tree = flattenHierarchyForest(incoming.types, incoming.typeHierarchy);
      const rankByName = new Map(
        Object.values(incoming.taxonomySources ?? {}).map((record) => [record.scientificName, record.rank]),
      );
      try {
        resolveTypeHierarchy(filters.typeHierarchy.value ?? null, true, incoming.typeHierarchy ?? {}, 'additive');
        return {
          incoming,
          names,
          edges,
          tree: tree.map((row) => ({ ...row, rank: rankByName.get(row.name) })),
          error: '',
        };
      } catch (error) {
        return {
          incoming,
          names,
          edges,
          tree: tree.map((row) => ({ ...row, rank: rankByName.get(row.name) })),
          error: error instanceof Error ? error.message : 'Invalid hierarchy.',
        };
      }
    });
    const synonymRemapGroups = computed(() => (
      groupSynonymRemaps(preview.value.incoming?.synonymRemaps ?? [])
    ));
    const synonymRemapMessage = computed(() => (
      synonymRemapGroups.value.length
        ? synonymRemapSummary(preview.value.incoming?.synonymRemaps ?? [])
        : ''
    ));
    const errorMessage = computed(() => (source.value === 'file' ? fileError.value : '') || preview.value.error || applyError.value);
    const canImport = computed(() => source.value === 'file' && !readOnlyMode.value && !loading.value
      && !errorMessage.value && preview.value.names.length > 0);

    function applyStaged(next: CategoryImport) {
      applyError.value = '';
      if (file.value && parsedFile.value) {
        parsedFile.value = next;
        return;
      }
      if (wormsImport.value) {
        wormsImport.value = next;
        pastedTypes.value = next.types.join('\n');
        return;
      }
      pastedTypes.value = next.types.join('\n');
    }

    function pruneStagedType(name: string) {
      if (readOnlyMode.value || !preview.value.incoming) return;
      const current = preview.value.incoming;
      const { hierarchy, removed } = pruneHierarchyUpward(current.typeHierarchy, name);
      const removedSet = new Set(removed);
      const types = current.types.filter((type) => !removedSet.has(type));
      if (!types.length && !hierarchy) {
        wormsImport.value = null;
        parsedFile.value = null;
        file.value = null;
        pastedTypes.value = '';
        showSynonymDetails.value = false;
        applyError.value = '';
        return;
      }
      applyStaged({
        ...current,
        types,
        typeHierarchy: hierarchy,
        taxonomySources: withoutRemovedSources(current.taxonomySources, removedSet),
      });
    }

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
      synonymRemapGroups,
      synonymRemapMessage,
      showSynonymDetails,
      errorMessage,
      canImport,
      pruneStagedType,
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
        <v-btn v-if="wormsImport" small text @click="wormsImport = null; pastedTypes = ''; showSynonymDetails = false">
          Clear staged types
        </v-btn>
      </template>
      <v-alert v-if="errorMessage" type="error" dense>
        {{ errorMessage }} No type changes were applied.
      </v-alert>
      <template v-if="source === 'file' && preview.incoming && preview.names.length">
        <p>{{ preview.names.length }} types; {{ preview.edges.length }} parent relationships.</p>
        <p v-if="preview.edges.length" class="text-caption mb-2">
          Remove a type to drop it and unused parents above it; its children become roots.
        </p>
        <div class="category-preview mb-3">
          <div
            v-for="row in preview.tree.slice(0, 100)"
            :key="row.name"
            class="category-tree-row"
            :style="{ paddingLeft: `${row.depth * 16}px` }"
          >
            <span>{{ row.name }}<span v-if="row.rank" class="text-caption"> · {{ row.rank }}</span></span>
            <v-btn
              icon
              x-small
              class="ml-1"
              :aria-label="`Remove ${row.name}`"
              :disabled="readOnlyMode"
              @click="pruneStagedType(row.name)"
            >
              <v-icon x-small>
                mdi-close
              </v-icon>
            </v-btn>
          </div>
          <div v-if="preview.tree.length > 100">
            Showing the first 100 types.
          </div>
        </div>
        <v-alert v-if="synonymRemapGroups.length" type="info" dense class="mb-2">
          <div class="d-flex align-center flex-wrap">
            <span>{{ synonymRemapMessage }}</span>
            <v-btn class="ml-2" small text @click="showSynonymDetails = !showSynonymDetails">
              {{ showSynonymDetails ? 'Hide details' : 'Show details' }}
            </v-btn>
          </div>
          <div v-if="showSynonymDetails" class="category-preview mt-2">
            <div v-for="group in synonymRemapGroups" :key="group.accepted">
              {{ group.accepted }} ← {{ group.originals.join(', ') }}
            </div>
          </div>
        </v-alert>
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
.category-tree-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
