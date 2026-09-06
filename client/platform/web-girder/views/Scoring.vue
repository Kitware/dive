<script lang="ts">
import { computed, defineComponent } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import ScoringPage from 'dive-common/components/Scoring/ScoringPage.vue';

export default defineComponent({
  name: 'Scoring',
  components: { ScoringPage },
  setup() {
    const route = useRoute();
    const router = useRouter();

    const initialDatasetIds = computed(() => {
      const raw = route.query.datasetIds;
      const joined = Array.isArray(raw) ? raw.join(',') : raw;
      return typeof joined === 'string' ? joined.split(',').filter((id) => id) : [];
    });

    function openViewer(id: string) {
      router.push({ name: 'viewer', params: { id } });
    }

    return { initialDatasetIds, openViewer };
  },
});
</script>

<template>
  <v-container fluid>
    <ScoringPage
      :initial-dataset-ids="initialDatasetIds"
      @open-viewer="openViewer"
    />
  </v-container>
</template>
