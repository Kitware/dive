<script lang="ts">
import {
  computed, defineComponent, onMounted, PropType, ref, watch,
} from 'vue';
import { useApi } from 'dive-common/apispec';
import { useScoring } from 'dive-common/use/useScoring';
import type { ScoringSource, ScoringSourceOptions } from 'dive-common/scoring/types';
import ScoringSourceDialog from './ScoringSourceDialog.vue';

const BROWSE = '__browse';
const OTHER = '__other';
const FOREIGN = '__foreign';

function keyOf(source: ScoringSource, mediaDatasetId: string): string {
  if (source.datasetId !== mediaDatasetId) return FOREIGN;
  if (source.file) return `file:${source.file}`;
  if (source.revision !== undefined) return `rev:${source.revision}`;
  if (source.set) return `set:${source.set}`;
  return 'current';
}

/**
 * One cell of the sequence table: the annotations of the row's dataset that
 * play this side, or, through the dialog, annotations from another dataset.
 */
export default defineComponent({
  name: 'ScoringSourceSelect',
  components: { ScoringSourceDialog },
  props: {
    source: {
      type: Object as PropType<ScoringSource>,
      required: true,
    },
    mediaDatasetId: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      default: 'Annotation source',
    },
  },
  setup(props, { emit }) {
    const scoring = useScoring();
    const { openFromDisk } = useApi();
    const options = ref<ScoringSourceOptions>({ sets: [], revisions: [], files: [] });
    const dialog = ref(false);
    const selected = ref(keyOf(props.source, props.mediaDatasetId));

    async function load() {
      options.value = await scoring.sourceOptions(props.mediaDatasetId);
    }
    onMounted(load);
    watch(() => props.mediaDatasetId, load);
    watch(() => props.source, (s) => { selected.value = keyOf(s, props.mediaDatasetId); }, { deep: true });

    const items = computed(() => {
      const list: { value: string; text: string; divider?: boolean }[] = [
        { value: 'current', text: 'Current annotations' },
      ];
      options.value.sets.forEach((s) => list.push({ value: `set:${s}`, text: `Set: ${s}` }));
      options.value.revisions.forEach((r) => list.push({
        value: `rev:${r.revision}`,
        text: `Revision #${r.revision} · ${r.description || new Date(r.created).toLocaleString()}`,
      }));
      options.value.files.forEach((f) => list.push({ value: `file:${f.path}`, text: `Earlier: ${f.name}` }));
      if (props.source.datasetId !== props.mediaDatasetId) {
        list.push({ value: FOREIGN, text: scoring.sourceLabel(props.source) });
      } else if (props.source.file && !options.value.files.some((f) => f.path === props.source.file)) {
        list.push({ value: `file:${props.source.file}`, text: `File: ${props.source.file.split(/[\\/]/).pop()}` });
      }
      if (options.value.allowFilePaths) list.push({ value: BROWSE, text: 'Browse for a file…' });
      list.push({ value: OTHER, text: 'Another dataset…' });
      return list;
    });

    async function onChange(key: string) {
      if (key === OTHER) {
        selected.value = keyOf(props.source, props.mediaDatasetId);
        dialog.value = true;
        return;
      }
      if (key === BROWSE) {
        selected.value = keyOf(props.source, props.mediaDatasetId);
        const picked = await openFromDisk('annotation');
        if (!picked.canceled && picked.filePaths.length && !(picked.fileList && picked.fileList.length)) {
          emit('update:source', { datasetId: props.mediaDatasetId, file: picked.filePaths[0] });
        }
        return;
      }
      if (key === FOREIGN) return;
      const next: ScoringSource = { datasetId: props.mediaDatasetId };
      if (key.startsWith('set:')) next.set = key.slice(4);
      else if (key.startsWith('rev:')) next.revision = Number(key.slice(4));
      else if (key.startsWith('file:')) next.file = key.slice(5);
      emit('update:source', next);
    }

    return {
      items,
      selected,
      dialog,
      onChange,
    };
  },
});
</script>

<template>
  <div>
    <v-select
      :value="selected"
      :items="items"
      dense
      outlined
      hide-details
      class="source-select"
      @change="onChange"
    />
    <ScoringSourceDialog
      v-model="dialog"
      :title="title"
      :source="source"
      @update:source="$emit('update:source', $event)"
    />
  </div>
</template>

<style lang="scss" scoped>
.source-select {
  font-size: 13px;
  min-width: 170px;
}

.source-select ::v-deep .v-select__selection {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
