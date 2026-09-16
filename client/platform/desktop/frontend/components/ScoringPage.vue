<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import SharedScoringPage from 'dive-common/components/Scoring/ScoringPage.vue';
import type { ScoringSource } from 'dive-common/scoring/types';
import { desktopViewerLocation } from 'dive-common/scoring/viewerNavigation';
import NavigationBar from './NavigationBar.vue';

const route = useRoute();
const router = useRouter();

/** Dataset ids handed off by another page (e.g. the Library selection). */
const initialDatasetIds = computed(() => {
  const query = route.query.datasetIds;
  const values = Array.isArray(query) ? query : [query];
  return values.flatMap((value) => (value || '').split(',')).filter(Boolean);
});

function openViewer(source: ScoringSource, sourceLabel: string) {
  router.push(desktopViewerLocation(source, sourceLabel));
}
</script>

<template>
  <v-main>
    <navigation-bar />
    <v-container fluid>
      <shared-scoring-page
        :initial-dataset-ids="initialDatasetIds"
        @open-viewer="openViewer"
      />
    </v-container>
  </v-main>
</template>
