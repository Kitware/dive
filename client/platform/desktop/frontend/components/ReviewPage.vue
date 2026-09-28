<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import SharedReviewPage from 'dive-common/components/Review/ReviewPage.vue';
import { reviewViewerLocation, ViewerFocus } from 'dive-common/review/viewerNavigation';
import { unsavedChangesCloseGuard, useDesktopCloseGuard } from '../store/closeGuard';
import NavigationBar from './NavigationBar.vue';

const route = useRoute();
const router = useRouter();
const page = ref<InstanceType<typeof SharedReviewPage>>();

// The window's close button asks about pending edits through the native
// prompt, as the viewer does; the browser unload prompt is off since Electron
// would only cancel the close silently. Cancel a pending auto-save before the
// prompt (same as in-app leave) so Exit Without Saving cannot race a write.
useDesktopCloseGuard(unsavedChangesCloseGuard({
  unsaved: () => (page.value?.review.pendingCount.value ?? 0) > 0,
  beforePrompt: () => page.value?.cancelAutoSave(),
  onStay: () => page.value?.resumeAutoSave(),
  save: async () => {
    const review = page.value?.review;
    if (!review) return true;
    await review.save();
    return review.pendingCount.value === 0;
  },
}));

/** Dataset ids handed off by another page (e.g. the Library selection). */
const initialDatasetIds = computed(() => {
  const query = route.query.datasetIds;
  const values = Array.isArray(query) ? query : [query];
  return values.flatMap((value) => (value || '').split(',')).filter(Boolean);
});

const fallbackDatasetId = computed(() => (typeof route.query.fromDataset === 'string' ? route.query.fromDataset : ''));

function openViewer(datasetId: string, focus: ViewerFocus) {
  router.push(reviewViewerLocation(datasetId, focus));
}
</script>

<template>
  <v-main>
    <navigation-bar />
    <shared-review-page
      ref="page"
      :initial-dataset-ids="initialDatasetIds"
      :fallback-dataset-id="fallbackDatasetId"
      :unload-guard="false"
      @open-viewer="openViewer"
    />
  </v-main>
</template>
