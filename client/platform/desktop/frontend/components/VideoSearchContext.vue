<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, ref, watch,
} from 'vue';
import {
  useCameraStore,
  useHandler,
  useSelectedCamera,
  useSelectedTrackId,
  useTime,
} from 'vue-media-annotator/provides';
import type { VideoSearchResult, VideoSearchIndexInfo } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { videoSearchListIndexes } from 'platform/desktop/frontend/api';
import { runningJobs } from 'platform/desktop/frontend/store/jobs';
import { useVideoSearch } from 'platform/desktop/frontend/useVideoSearch';
import { createSearchChips } from 'platform/desktop/frontend/useSearchChips';
import { searchResultFrame as resultFrame } from 'dive-common/review/searchResultItems';
import VideoSearchResultsGrid from 'platform/desktop/frontend/components/VideoSearchResultsGrid.vue';

export default defineComponent({
  name: 'VideoSearchContext',
  description: 'Video Search',
  components: { VideoSearchResultsGrid },
  setup() {
    const search = useVideoSearch();
    const handler = useHandler();
    const { frame } = useTime();
    const selectedTrackId = useSelectedTrackId();
    const selectedCamera = useSelectedCamera();
    const cameraStore = useCameraStore();
    const { prompt } = usePrompt();

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
    const saveModelName = ref('');
    const saveModelDialog = ref(false);
    const resultsGridOpen = ref(false);
    /** Cropped result chips shared with the results grid. */
    const searchChips = search ? createSearchChips(search) : null;
    const thumbnails = computed(() => searchChips?.chips.value ?? {});
    onBeforeUnmount(() => searchChips?.dispose());

    const state = computed(() => search?.state ?? null);

    const displayedResults = computed(() => state.value?.results ?? []);

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
      const [x1, y1, x2, y2] = selectedTrackBox.value;
      await search.queryFromFrame(frame.value, [[x1, y1, x2, y2]]);
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
      await search.queryFromImage(ret.filePaths[0], undefined, modelPath);
    }

    async function saveModel() {
      if (!search || !saveModelName.value) return;
      const outputDir = await search.saveModel(saveModelName.value);
      saveModelDialog.value = false;
      if (outputDir) {
        await prompt({
          title: 'Model Saved',
          text: [`Saved trained model to ${outputDir}.`,
            'It is now available as a trained pipeline in the Run Pipeline menu.'],
          positiveButton: 'Okay',
        });
      }
    }

    function seekToResult(result: VideoSearchResult) {
      // Only results from the currently open dataset can be seeked to.
      if (!search || !search.resultIsLocal(result)) {
        return;
      }
      const target = resultFrame(result);
      if (target !== null) {
        handler.seekFrame(target);
      }
    }

    function isLocalResult(result: VideoSearchResult): boolean {
      return search !== null && search.resultIsLocal(result);
    }

    return {
      search,
      state,
      indexes,
      indexChoices,
      buildLocation,
      selectedTrackId,
      selectedTrackBox,
      saveModelName,
      saveModelDialog,
      resultsGridOpen,
      searchChips,
      thumbnails,
      resultFrame,
      queryFromSelectedTrack,
      queryFromImageFile,
      saveModel,
      seekToResult,
      isLocalResult,
      displayedResults,
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
          x-small
          block
          class="mb-1"
          color="primary"
          :disabled="!indexes.length || selectedTrackBox === null || !!state.busy"
          @click="queryFromSelectedTrack"
        >
          Search from selected annotation
        </v-btn>
        <v-btn
          x-small
          block
          class="mb-1"
          :disabled="!indexes.length || !!state.busy"
          @click="queryFromImageFile(false)"
        >
          Search from image file...
        </v-btn>
        <v-btn
          x-small
          block
          :disabled="!indexes.length || !!state.busy"
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

      <!-- Results + refinement -->
      <template v-if="displayedResults.length">
        <v-divider class="mb-2" />
        <div class="d-flex align-center mb-1">
          <div class="text-subtitle-2">
            Results ({{ displayedResults.length }})
            <span v-if="state.iteration" class="text-caption">
              — iteration {{ state.iteration }}
            </span>
          </div>
          <v-spacer />
          <v-btn
            icon
            x-small
            class="mr-1"
            title="Review results in a grid"
            @click="resultsGridOpen = true"
          >
            <v-icon small>
              mdi-view-grid
            </v-icon>
          </v-btn>
          <v-btn
            x-small
            color="primary"
            :disabled="!!state.busy"
            @click="search.refine()"
          >
            Refine
          </v-btn>
          <v-btn
            x-small
            class="ml-1"
            :disabled="!state.modelAvailable || !!state.busy"
            @click="saveModelDialog = true"
          >
            Save Model
          </v-btn>
        </div>
        <div class="results-list">
          <v-card
            v-for="result in displayedResults"
            :key="result.ref"
            outlined
            class="d-flex align-center pa-1 mb-1 result-row"
            :class="{ 'result-row-remote': !isLocalResult(result) }"
            @click="seekToResult(result)"
          >
            <img
              v-if="thumbnails[result.ref]"
              :src="thumbnails[result.ref]"
              class="result-thumb mr-2"
            >
            <div
              v-else
              class="result-thumb result-thumb-placeholder mr-2"
            />
            <div class="flex-grow-1">
              <div class="text-caption">
                Frame {{ resultFrame(result) }}
              </div>
              <div class="text-caption grey--text">
                {{ (result.relevancy_score * 100).toFixed(1) }}%
              </div>
              <div
                v-if="search.resultDatasetName(result)"
                class="text-caption blue-grey--text text--lighten-1 result-dataset"
              >
                {{ search.resultDatasetName(result) }}
              </div>
            </div>
            <v-btn
              icon
              x-small
              :color="state.adjudications[result.ref] === 'positive' ? 'success' : 'grey'"
              @click.stop="search.mark(result.ref, 'positive')"
            >
              <v-icon small>
                mdi-thumb-up
              </v-icon>
            </v-btn>
            <v-btn
              icon
              x-small
              :color="state.adjudications[result.ref] === 'negative' ? 'error' : 'grey'"
              @click.stop="search.mark(result.ref, 'negative')"
            >
              <v-icon small>
                mdi-thumb-down
              </v-icon>
            </v-btn>
          </v-card>
        </div>
      </template>

      <!-- Save model dialog -->
      <v-dialog
        v-model="saveModelDialog"
        max-width="420"
      >
        <v-card>
          <v-card-title>Save Trained Model</v-card-title>
          <v-card-text>
            <v-text-field
              v-model="saveModelName"
              label="Model name"
              hint="Becomes a runnable trained pipeline usable on other datasets"
              persistent-hint
              autofocus
            />
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn text @click="saveModelDialog = false">
              Cancel
            </v-btn>
            <v-btn
              color="primary"
              :disabled="!saveModelName"
              @click="saveModel"
            >
              Save
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <!-- Full-window adjudication grid over the same session state -->
      <video-search-results-grid
        v-if="searchChips"
        v-model="resultsGridOpen"
        :search-chips="searchChips"
      />
    </div>
  </div>
</template>

<style scoped>
.video-search-context {
  overflow-y: auto;
  height: 100%;
}
.results-list {
  overflow-y: auto;
  max-height: calc(100vh - 480px);
}
.result-row {
  cursor: pointer;
}
.result-row-remote {
  cursor: default;
}
.result-dataset {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.result-thumb {
  width: 48px;
  height: 48px;
  object-fit: contain;
  background: #222;
}
.result-thumb-placeholder {
  background: #333;
}
</style>
