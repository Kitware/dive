<script lang="ts">
import {
  computed, defineComponent, onMounted, ref, watch,
} from 'vue';
import {
  useCameraStore,
  useSelectedCamera,
  useSelectedTrackId,
  useTime,
} from 'vue-media-annotator/provides';
import type { VideoSearchIndexInfo } from 'dive-common/apispec';
import { isNavigationFailure } from 'vue-router';
import { useRouter } from 'vue-router/composables';
import { videoSearchListIndexes } from 'platform/desktop/frontend/api';
import { runningJobs } from 'platform/desktop/frontend/store/jobs';
import { useVideoSearch } from 'platform/desktop/frontend/useVideoSearch';
import { holdQueryLaunch, takeQueryLaunch, QueryLaunch } from '../queryLaunch';

export default defineComponent({
  name: 'VideoSearchContext',
  description: 'Video Search',
  setup() {
    const search = useVideoSearch();
    const router = useRouter();
    const launching = ref(false);
    const { frame } = useTime();
    const selectedTrackId = useSelectedTrackId();
    const selectedCamera = useSelectedCamera();
    const cameraStore = useCameraStore();

    const indexes = ref<VideoSearchIndexInfo[]>([]);
    const indexChoices = computed(() => [
      { text: 'All indexed sequences', value: '' },
      ...indexes.value.map((index) => ({ text: index.name, value: index.streamName })),
    ]);
    const buildLocation = computed(() => ({
      name: 'query', query: { datasetIds: search?.datasetId || '', view: 'datasets' },
    }));
    async function refreshIndexes() {
      if (!search) return;
      await search.refreshStatus();
      try {
        indexes.value = search.state.status?.datasetCount ? await videoSearchListIndexes() : [];
        if (search.state.selectedStream && !indexes.value.some((index) => index.streamName === search.state.selectedStream)) {
          search.selectIndex(null);
        }
      } catch (err) { search.state.error = (err as Error).message; }
    }
    const state = computed(() => search?.state ?? null);

    /** Any completed index build can add a new choice to the shared database. */
    watch(runningJobs, (current, previous) => {
      if (!search) return;
      const finished = previous.some((item) => (
        /search index/i.test(item.job.title)
        && !current.some((c) => c.job.key === item.job.key)
      ));
      if (finished) {
        refreshIndexes();
      }
    });

    // Note there is deliberately no unmount cleanup: the session stays open
    // because re-opening (postgres + descriptor load) is expensive and the
    // panel may just be toggled. The session closes with the app or when
    // another dataset's index opens.
    onMounted(() => {
      if (search) {
        refreshIndexes();
      }
    });

    /** The selected track's bounding box on the current frame, if any. */
    const selectedTrackBox = computed(() => {
      if (!search || selectedTrackId.value === null) return null;
      try {
        const track = cameraStore.getTrack(selectedTrackId.value, selectedCamera.value);
        const [real] = track.getFeature(frame.value);
        if (real && real.bounds) {
          return real.bounds as [number, number, number, number];
        }
      } catch {
        return null;
      }
      return null;
    });

    async function queryFromSelectedTrack() {
      if (!search || !selectedTrackBox.value) return;
      launching.value = true;
      try {
        const box = [...selectedTrackBox.value] as [number, number, number, number];
        const imagePath = await search.exemplarImageForFrame(frame.value);
        await launchQuery({ imagePath, box, streamName: search.state.selectedStream });
      } catch (err) { search.state.error = (err as Error).message; } finally { launching.value = false; }
    }

    async function queryFromImageFile(warmStart = false) {
      if (!search) return;
      let modelPath: string | undefined;
      if (warmStart) {
        const modelRet = await window.diveDesktop.showOpenDialog({
          properties: ['openFile'],
          filters: [
            { name: 'SVM Models', extensions: ['svm'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });
        if (modelRet.canceled || !modelRet.filePaths?.length) return;
        [modelPath] = modelRet.filePaths;
      }
      const ret = await window.diveDesktop.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tif', 'tiff'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (ret.canceled || !ret.filePaths?.length) return;
      await launchQuery({ imagePath: ret.filePaths[0], modelPath, streamName: search.state.selectedStream });
    }

    async function launchQuery(launch: QueryLaunch) {
      launching.value = true;
      const key = holdQueryLaunch(launch);
      try {
        await router.push({ name: 'query', query: { launch: key } });
      } catch (err) {
        takeQueryLaunch(key);
        if (search && !isNavigationFailure(err)) search.state.error = (err as Error).message;
      } finally { launching.value = false; }
    }

    return {
      search,
      state,
      indexes,
      indexChoices,
      buildLocation,
      selectedTrackBox,
      launching,
      queryFromSelectedTrack,
      queryFromImageFile,

    };
  },
});
</script>

<template>
  <div class="video-search-context pa-2">
    <div v-if="!search || !state">
      <v-alert type="info" dense text>
        Video search is unavailable for this dataset.
      </v-alert>
    </div>
    <div v-else-if="state.installed === false">
      <v-alert type="warning" dense text>
        This VIAME install does not include the video search components
        (query pipeline and database tools).
      </v-alert>
    </div>
    <div v-else>
      <div class="text-subtitle-2 mb-2">
        Search Index
      </div>
      <v-select
        v-if="indexes.length"
        :value="state.selectedStream || ''"
        :items="indexChoices"
        :disabled="!!state.busy"
        dense
        outlined
        hide-details
        label="Index to search"
        class="mb-2"
        @change="search.selectIndex($event || null)"
      />
      <div v-else class="text-caption mb-2">
        No search index is available yet.
      </div>
      <v-btn small text color="primary" :to="buildLocation" class="mb-3">
        {{ indexes.length ? 'Build a new index' : 'Create index' }}
      </v-btn>
      <v-divider class="mb-2" />

      <!-- Query formulation -->
      <div class="text-subtitle-2 mb-1">
        Query
      </div>
      <div class="mb-3">
        <v-btn
          large
          block
          class="query-launch-button mb-3"
          color="primary"
          :disabled="!indexes.length || selectedTrackBox === null || !!state.busy || launching"
          @click="queryFromSelectedTrack"
        >
          Search from selected annotation
        </v-btn>
        <v-btn
          large
          block
          class="query-launch-button mb-3"
          :disabled="!indexes.length || !!state.busy || launching"
          @click="queryFromImageFile(false)"
        >
          Search from image file...
        </v-btn>
        <v-btn
          large
          block
          class="query-launch-button mb-3"
          :disabled="!indexes.length || !!state.busy || launching"
          @click="queryFromImageFile(true)"
        >
          Search with saved model (.svm)...
        </v-btn>
      </div>

      <v-progress-linear
        v-if="state.busy"
        indeterminate
        class="mb-2"
      />
      <div v-if="state.busy" class="text-caption mb-2">
        {{ state.busy }}
      </div>
      <v-alert
        v-if="state.error"
        type="error"
        dense
        text
        class="text-caption"
      >
        {{ state.error }}
      </v-alert>
    </div>
  </div>
</template>

<style scoped>
.query-launch-button {
  min-height: 64px;
  height: auto !important;
  padding: 16px !important;
  font-size: 14px;
}
.query-launch-button ::v-deep .v-btn__content {
  white-space: normal;
  line-height: 1.5;
}
</style>
