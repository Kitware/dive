<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import { useGirderRest } from 'platform/web-girder/plugins/girder';
import ReviewPage from 'dive-common/components/Review/ReviewPage.vue';
import { reviewViewerLocation, ViewerFocus } from 'dive-common/review/viewerNavigation';

export default defineComponent({
  name: 'Review',
  components: { ReviewPage },
  setup() {
    const girderRest = useGirderRest();
    const owner = girderRest.user?._id || '';
    const retainSession = computed(() => !!owner && girderRest.user?._id === owner);
    const route = useRoute();
    const router = useRouter();

    const initialDatasetIds = computed(() => {
      const raw = route.query.datasetIds;
      const joined = Array.isArray(raw) ? raw.join(',') : raw;
      return typeof joined === 'string' ? joined.split(',').filter((id) => id) : [];
    });

    function openViewer(datasetId: string, focus: ViewerFocus) {
      router.push(reviewViewerLocation(datasetId, focus));
    }

    return {
      initialDatasetIds, openViewer, owner, retainSession,
    };
  },
});
</script>

<template>
  <ReviewPage
    :initial-dataset-ids="initialDatasetIds"
    :session-owner="owner"
    :retain-session="retainSession"
    @open-viewer="openViewer"
  />
</template>
