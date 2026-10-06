<script lang="ts">
import {
  computed, defineComponent, PropType, ref, watch,
} from 'vue';
import { useApi } from 'dive-common/apispec';
import { useScoring } from 'dive-common/use/useScoring';
import type { ScoringSource, ScoringSourceOptions } from 'dive-common/scoring/types';

export default defineComponent({
  name: 'ScoringSourceDialog',
  props: {
    value: {
      type: Boolean,
      default: false,
    },
    title: {
      type: String,
      default: 'Annotation source',
    },
    source: {
      type: Object as PropType<ScoringSource>,
      required: true,
    },
  },
  setup(props, { emit }) {
    const scoring = useScoring();
    const { openFromDisk } = useApi();

    const datasetId = ref(props.source.datasetId);
    const kind = ref<'current' | 'set' | 'revision' | 'file'>('current');
    const set = ref<string>(props.source.set || '');
    const revision = ref<number | null>(props.source.revision ?? null);
    const file = ref<string>(props.source.file || '');
    const options = ref<ScoringSourceOptions>({ sets: [], revisions: [], files: [] });
    const loadingOptions = ref(false);
    const fileMessage = ref<string | null>(null);

    function syncFromSource() {
      datasetId.value = props.source.datasetId;
      set.value = props.source.set || '';
      revision.value = props.source.revision ?? null;
      file.value = props.source.file || '';
      if (props.source.file) kind.value = 'file';
      else if (props.source.revision !== undefined) kind.value = 'revision';
      else if (props.source.set) kind.value = 'set';
      else kind.value = 'current';
    }

    async function loadOptions() {
      loadingOptions.value = true;
      options.value = await scoring.sourceOptions(datasetId.value);
      loadingOptions.value = false;
    }

    watch(() => props.value, (open) => {
      if (open) {
        syncFromSource();
        scoring.refreshDatasets();
        loadOptions();
      }
    });
    watch(datasetId, (next, previous) => {
      if (next === previous) return;
      set.value = '';
      revision.value = null;
      file.value = '';
      kind.value = 'current';
      loadOptions();
    });

    const datasetItems = computed(() => {
      const items = scoring.datasets.value.map((d) => ({ value: d.id, text: d.name }));
      if (!items.some((i) => i.value === props.source.datasetId)) {
        items.unshift({ value: props.source.datasetId, text: scoring.datasetName(props.source.datasetId) });
      }
      return items;
    });

    const kinds = computed(() => {
      const list = [{ value: 'current', text: 'Current annotations' }];
      if (options.value.sets.length) list.push({ value: 'set', text: 'Annotation set' });
      if (options.value.revisions.length) list.push({ value: 'revision', text: 'Earlier revision' });
      if (options.value.files.length || options.value.allowFilePaths) list.push({ value: 'file', text: 'Annotation file' });
      return list;
    });

    const revisionItems = computed(() => options.value.revisions.map((r) => ({
      value: r.revision,
      text: `#${r.revision} · ${new Date(r.created).toLocaleString()} · ${r.description}${r.author ? ` (${r.author})` : ''}${r.set ? ` [${r.set}]` : ''}`,
    })));

    const fileItems = computed(() => options.value.files.map((f) => ({
      value: f.path,
      text: `${f.name} · ${new Date(f.modified).toLocaleString()}`,
    })));

    async function browse() {
      fileMessage.value = null;
      const picked = await openFromDisk('annotation');
      if (picked.canceled || !picked.filePaths.length) return;
      if (picked.fileList && picked.fileList.length) {
        fileMessage.value = 'Browsing for files is only available on desktop; import the file as an annotation set instead.';
        return;
      }
      [file.value] = picked.filePaths;
    }

    const valid = computed(() => {
      if (kind.value === 'set') return !!set.value;
      if (kind.value === 'revision') return revision.value !== null;
      if (kind.value === 'file') return !!file.value;
      return true;
    });

    function apply() {
      const next: ScoringSource = { datasetId: datasetId.value };
      if (kind.value === 'set') next.set = set.value;
      if (kind.value === 'revision' && revision.value !== null) next.revision = revision.value;
      if (kind.value === 'file') next.file = file.value;
      emit('update:source', next);
      emit('input', false);
    }

    return {
      datasetId,
      kind,
      kinds,
      set,
      revision,
      file,
      options,
      loadingOptions,
      datasetItems,
      revisionItems,
      fileItems,
      fileMessage,
      browse,
      valid,
      apply,
      canBrowse: computed(() => !!options.value.allowFilePaths),
    };
  },
});
</script>

<template>
  <v-dialog
    :value="value"
    max-width="560"
    @input="$emit('input', $event)"
  >
    <v-card outlined>
      <v-card-title class="text-h6">
        {{ title }}
      </v-card-title>
      <v-card-text>
        <v-autocomplete
          v-model="datasetId"
          :items="datasetItems"
          label="Dataset"
          dense
          outlined
          hide-details
          class="mb-3"
        />
        <div class="text-caption grey--text mb-3">
          Any dataset holding annotations of the same footage can stand in for either
          side: another import of the same images or video, for example.
        </div>
        <v-select
          v-model="kind"
          :items="kinds"
          label="Annotations"
          dense
          outlined
          hide-details
          :loading="loadingOptions"
          class="mb-3"
        />
        <v-select
          v-if="kind === 'set'"
          v-model="set"
          :items="options.sets"
          label="Annotation set"
          dense
          outlined
          hide-details
          class="mb-3"
        />
        <v-select
          v-if="kind === 'revision'"
          v-model="revision"
          :items="revisionItems"
          label="Revision"
          dense
          outlined
          hide-details
          class="mb-3"
        />
        <template v-if="kind === 'file'">
          <v-select
            v-if="fileItems.length"
            v-model="file"
            :items="fileItems"
            label="Earlier annotations of this dataset"
            dense
            outlined
            hide-details
            class="mb-2"
          />
          <div class="d-flex align-center">
            <v-text-field
              v-model="file"
              label="File path"
              dense
              outlined
              hide-details
            />
            <v-btn
              v-if="canBrowse"
              small
              outlined
              class="ml-2"
              @click="browse"
            >
              Browse
            </v-btn>
          </div>
          <div
            v-if="fileMessage"
            class="text-caption warning--text mt-1"
          >
            {{ fileMessage }}
          </div>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          text
          @click="$emit('input', false)"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!valid"
          @click="apply"
        >
          Use
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
