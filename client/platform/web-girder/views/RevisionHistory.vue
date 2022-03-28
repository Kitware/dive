<script lang="ts">
import { defineComponent, toRef, watch } from '@vue/composition-api';
import {
  useDatasetId, useHandler, usePendingSaveCount, useProgress, useRevisionId,
} from 'vue-media-annotator/provides';
import { loadRevisions, Revision } from 'platform/web-girder/api';
import { usePaginatedRequest } from 'dive-common/use/useRequest';

export default defineComponent({
  name: 'RevisionHistory',
  description: 'Revision History',

  setup(_, ctx) {
    const saveCount = usePendingSaveCount();
    const datasetId = useDatasetId();
    const revisionId = useRevisionId();
    const progress = useProgress();
    const { reloadAnnotations } = useHandler();
    const {
      loading, count, allPages: revisions, totalCount, loadNextPage, reset,
    } = usePaginatedRequest<Revision>();

    async function loadNext() {
      await loadNextPage((l, o) => loadRevisions(datasetId.value, l, o));
    }

    function checkout(id: number) {
      ctx.emit('update:revision', id);
      reloadAnnotations();
    }

    watch(saveCount, (newval) => {
      // Reload revision list when save happens
      if (newval === 0) {
        reset();
        loadNext();
      }
    });

    watch(toRef(progress, 'loaded'), (newval) => {
      // Reload revision list when refresh happens.
      if (!newval) {
        reset();
        loadNext();
      }
    });

    loadNext();

    return {
      loading,
      progress,
      count,
      revisions,
      revisionId,
      datasetId,
      saveCount,
      totalCount,
      checkout,
      loadNext,
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
      <h4>Inspecting revision {{ revisionId }}.</h4>
      Past revisions are not editable.
      Return to latest or <b>clone</b> this revision to edit.
      <v-btn
        x-small
        depressed
        :to="{
          name: 'viewer',
          params: { id: datasetId }}
        "
      >
        Return to newest revision
      </v-btn>
    </v-alert>
    <v-alert
      v-else
      color="grey darken-3"
      tile
    >
      Choose a previous revision to inspect in read-only mode.
    </v-alert>
    <v-list
      v-if="revisions.length"
      two-line
    >
      <v-list-item
        v-for="revision in revisions"
        :key="revision.revision"
        :input-value="revision.revision === revisionId"
        @click="checkout(revision.revision)"
      >
        <v-list-item-content>
          <v-list-item-title>
            <v-tooltip
              bottom
              open-delay="500"
            >
              <template #activator="{ on, attrs }">
                <span
                  v-bind="attrs"
                  v-on="on"
                  v-text="`${revision.revision}: ${revision.description}`"
                />
              </template>
              <span>{{ revision.description }}</span>
            </v-tooltip>
          </v-list-item-title>
          <v-list-item-subtitle>
            by
            <router-link
              :to="`/user/${revision.author_id}`"
            >
              {{ revision.author_name }}
            </router-link>
          </v-list-item-subtitle>
          <v-list-item-subtitle v-text="(new Date(revision.created)).toLocaleString()" />
        </v-list-item-content>
        <v-list-item-action>
          <v-list-item-action-text v-text="`+${revision.additions} -${revision.deletions}`" />
        </v-list-item-action>
      </v-list-item>
      <span
        v-intersect.quiet="loadNext"
      />
      <a
        v-if="revisions.length < totalCount"
        class="px-4"
        @click="loadNext"
      >
        Load More
      </a>
    </v-list>
    <v-alert
      v-else-if="!loading && count > 0"
      type="info"
      tile
    >
      No revision history yet.  A revision is created each time you press save
      <v-icon>mdi-content-save</v-icon>.
    </v-alert>
  </div>
</template>
