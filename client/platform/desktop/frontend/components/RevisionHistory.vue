<script lang="ts">
import {
  defineComponent, ref, toRef, watch,
} from 'vue';
import {
  useDatasetId, usePendingSaveCount, useProgress, useRevisionId,
} from 'vue-media-annotator/provides';
import { useRouter } from 'vue-router/composables';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import type { DesktopRevision } from 'platform/desktop/constants';
import { listRevisions, restoreRevision, cloneRevision } from 'platform/desktop/frontend/api';
import { datasets, setRecents } from '../store/dataset';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Desktop revision history. Each save writes a complete new annotation file and
 * keeps the previous one, so any of them can be opened here read-only.
 */
export default defineComponent({
  name: 'RevisionHistory',
  description: 'Revision History',

  setup(_, { emit }) {
    const saveCount = usePendingSaveCount();
    const datasetId = useDatasetId();
    const revisionId = useRevisionId();
    const progress = useProgress();
    const revisions = ref<DesktopRevision[]>([]);
    const loading = ref(false);
    const error = ref('');
    const router = useRouter();
    const { prompt } = usePrompt();
    const busy = ref(false);
    const cloneOpen = ref(false);
    const cloneName = ref('');

    async function load() {
      loading.value = true;
      try {
        revisions.value = await listRevisions(datasetId.value);
        error.value = '';
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
      } finally {
        loading.value = false;
      }
    }

    function checkout(revision: DesktopRevision | undefined) {
      // The newest version is simply the normal, editable view.
      // The parent updates the route, then reloads the annotations.
      emit('update:revision', revision && !revision.current ? revision.revision : undefined);
    }

    async function restore() {
      const revision = revisionId.value;
      if (revision === undefined) return;
      const confirmed = await prompt({
        title: 'Restore this revision',
        text: [
          'The current annotations will be replaced with this revision.',
          'The current version stays in the revision history, so the restore can be undone.',
        ],
        confirm: true,
        positiveButton: 'Restore',
        negativeButton: 'Cancel',
      });
      if (!confirmed) return;
      busy.value = true;
      try {
        await restoreRevision(datasetId.value, revision);
        error.value = '';
        checkout(undefined);
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
      } finally {
        busy.value = false;
      }
    }

    function openClone() {
      const source = datasets.value[datasetId.value]?.name || datasetId.value;
      cloneName.value = `Clone of ${source}`;
      cloneOpen.value = true;
    }

    async function clone() {
      const revision = revisionId.value;
      if (revision === undefined || !cloneName.value.trim()) return;
      busy.value = true;
      try {
        const meta = await cloneRevision(datasetId.value, revision, cloneName.value);
        setRecents(meta, (new Date()).toString());
        cloneOpen.value = false;
        error.value = '';
        router.push({ name: 'viewer', params: { id: meta.id } });
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
      } finally {
        busy.value = false;
      }
    }

    watch(saveCount, (newval) => {
      // A save writes a new revision.
      if (newval === 0) load();
    });
    watch(toRef(progress, 'loaded'), (newval) => {
      if (!newval) load();
    });
    watch(datasetId, load);

    load();

    return {
      revisions,
      revisionId,
      loading,
      error,
      checkout,
      formatSize,
      busy,
      cloneOpen,
      cloneName,
      restore,
      openClone,
      clone,
    };
  },
});
</script>

<template>
  <div>
    <v-alert
      v-if="revisionId"
      type="info"
      tile
    >
      <h4>Inspecting a past revision.</h4>
      Past revisions are not editable.
      Return to newest, <b>restore</b> this revision, or <b>clone</b> it to edit a copy.
      <div class="mt-2">
        <v-btn
          x-small
          depressed
          class="mr-1"
          @click="checkout(undefined)"
        >
          Return to newest revision
        </v-btn>
        <v-btn
          x-small
          depressed
          class="mr-1"
          :disabled="busy"
          @click="restore"
        >
          <v-icon x-small left>
            mdi-backup-restore
          </v-icon>
          Restore
        </v-btn>
        <v-btn
          x-small
          depressed
          :disabled="busy"
          @click="openClone"
        >
          <v-icon x-small left>
            mdi-content-copy
          </v-icon>
          Clone
        </v-btn>
      </div>
    </v-alert>
    <v-alert
      v-else
      color="grey darken-3"
      tile
    >
      Choose a previous revision to inspect in read-only mode.
    </v-alert>
    <v-alert
      v-if="error"
      type="error"
      tile
    >
      {{ error }}
    </v-alert>
    <v-list
      v-if="revisions.length"
      two-line
    >
      <v-list-item
        v-for="revision in revisions"
        :key="`${revision.revision}-${revision.fileName}`"
        :input-value="revisionId ? revision.revision === revisionId : revision.current"
        @click="checkout(revision)"
      >
        <v-list-item-content>
          <v-list-item-title>
            {{ (new Date(revision.created)).toLocaleString() }}
          </v-list-item-title>
          <v-list-item-subtitle>
            <v-chip
              v-if="revision.current"
              x-small
              outlined
              color="green"
              class="mr-1"
            >
              newest
            </v-chip>
            {{ revision.fileName }}
          </v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-action>
          <v-list-item-action-text v-text="formatSize(revision.size)" />
        </v-list-item-action>
      </v-list-item>
    </v-list>
    <v-alert
      v-else-if="!loading && !error"
      type="info"
      tile
    >
      No revision history yet.  A revision is created each time you press save
      <v-icon>mdi-content-save</v-icon>.
    </v-alert>
    <v-dialog
      v-model="cloneOpen"
      max-width="420"
    >
      <v-card>
        <v-card-title>Clone this revision</v-card-title>
        <v-card-text>
          Creates a new dataset with the annotations from this revision.
          It uses the same media as the original.
          <v-text-field
            v-model="cloneName"
            label="Name"
            autofocus
            @keyup.enter="clone"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            text
            @click="cloneOpen = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            depressed
            :disabled="busy || !cloneName.trim()"
            @click="clone"
          >
            Clone
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
