<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import SharedReviewPage from 'dive-common/components/Review/ReviewPage.vue';
import { reviewViewerLocation, ViewerFocus } from 'dive-common/review/viewerNavigation';
import NavigationBar from './NavigationBar.vue';

const route = useRoute();
const router = useRouter();

/** Dataset ids handed off by another page (e.g. the Library selection). */
const initialDatasetIds = computed(() => {
  const query = route.query.datasetIds;
  const values = Array.isArray(query) ? query : [query];
  return values.flatMap((value) => (value || '').split(',')).filter(Boolean);
});

function openViewer(datasetId: string, focus: ViewerFocus) {
  router.push(reviewViewerLocation(datasetId, focus));
}
</script>

<template>
  <v-main>
    <navigation-bar />
    <shared-review-page
      :initial-dataset-ids="initialDatasetIds"
      @open-viewer="openViewer"
    />
  </v-main>
</template>
