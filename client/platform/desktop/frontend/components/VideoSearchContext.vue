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
import type { VideoSearchResult, VideoSearchIndexMethod } from 'dive-common/apispec';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { runningJobs } from 'platform/desktop/frontend/store/jobs';
import { getMediaUrl } from 'platform/desktop/frontend/api';
import { useVideoSearch } from 'platform/desktop/frontend/useVideoSearch';

export default defineComponent({
  name: 'VideoSearchContext',
  description: 'Video Search',
  setup() {
    const search = useVideoSearch();
    const handler = useHandler();
    const { frame } = useTime();
    const selectedTrackId = useSelectedTrackId();
    const selectedCamera = useSelectedCamera();
    const cameraStore = useCameraStore();
    const { prompt } = usePrompt();

    const buildMethod = ref<VideoSearchIndexMethod>('detections');
    const saveModelName = ref('');
    const saveModelDialog = ref(false);
    /** Small cache of cropped result thumbnails keyed by instance id. */
    const thumbnails = ref<Record<number, string>>({});

    const state = computed(() => search?.state ?? null);

    const indexBuilding = computed(() => runningJobs.value.some((item) => (
      item.job.exitCode === null
      && search !== null
      && item.job.datasetIds.includes(search.datasetId)
      && item.job.title.startsWith('Build search index')
    )));

    /** Refresh index status whenever a build job for this dataset finishes. */
    watch(runningJobs, (current, previous) => {
      if (!search) return;
      const finished = previous.some((item) => (
        item.job.datasetIds.includes(search.datasetId)
        && item.job.title.startsWith('Build search index')
        && !current.some((c) => c.job.key === item.job.key)
      ));
      if (finished) {
        search.refreshStatus();
      }
    });

    onMounted(() => {
      if (search) {
        search.refreshStatus();
      }
    });

    onBeforeUnmount(() => {
      // Leave the session open: re-opening (postgres + descriptor load) is
      // expensive and the panel may just be toggled. The session closes with
      // the app or when another dataset's index opens.
      thumbnails.value = {};
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

    async function deleteIndexConfirm() {
      if (!search) return;
      const confirmed = await prompt({
        title: 'Delete Search Index',
        text: ['Delete this dataset\'s search index?',
          'The index can be rebuilt later, but building takes time.'],
        confirm: true,
        positiveButton: 'Delete',
        negativeButton: 'Cancel',
      });
      if (confirmed) {
        await search.deleteIndex();
      }
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
      const target = result.tracks[0]?.states[0]?.frame ?? result.start_frame;
      if (target !== null && target !== undefined) {
        handler.seekFrame(target);
      }
    }

    function resultFrame(result: VideoSearchResult): number | null {
      return result.tracks[0]?.states[0]?.frame ?? result.start_frame ?? null;
    }

    function resultBox(result: VideoSearchResult) {
      return result.tracks[0]?.states[0]?.bbox;
    }

    /** Crop a result chip out of its source frame into a data URL. */
    async function loadThumbnail(result: VideoSearchResult) {
      if (!search || thumbnails.value[result.instance_id]) return;
      const frameNum = resultFrame(result);
      const bbox = resultBox(result);
      if (frameNum === null) return;
      try {
        const imagePath = await search.exemplarImageForFrame(frameNum);
        const url = await getMediaUrl(imagePath);
        const image = new Image();
        image.src = url;
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
        });
        const canvas = document.createElement('canvas');
        const [x1, y1, x2, y2] = bbox ?? [0, 0, image.naturalWidth, image.naturalHeight];
        const w = Math.max(1, x2 - x1);
        const h = Math.max(1, y2 - y1);
        const scale = Math.min(1, 128 / Math.max(w, h));
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(image, x1, y1, w, h, 0, 0, canvas.width, canvas.height);
          thumbnails.value = {
            ...thumbnails.value,
            [result.instance_id]: canvas.toDataURL('image/jpeg', 0.8),
          };
        }
      } catch {
        // Thumbnails are best-effort; the row still shows frame + score.
      }
    }

    watch(() => state.value?.results, (results) => {
      thumbnails.value = {};
      (results || []).slice(0, 50).forEach((r) => loadThumbnail(r));
    });

    return {
      search,
      state,
      buildMethod,
      indexBuilding,
      selectedTrackId,
      selectedTrackBox,
      saveModelName,
      saveModelDialog,
      thumbnails,
      queryFromSelectedTrack,
      queryFromImageFile,
      deleteIndexConfirm,
      saveModel,
      seekToResult,
      resultFrame,
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
      <!-- Index management -->
      <div class="text-subtitle-2 mb-1">
        Search Index
        <v-chip
          x-small
          class="ml-1"
          :color="state.status && state.status.built ? 'success' : 'grey'"
        >
          {{ indexBuilding ? 'building...' : (state.status && state.status.built ? 'built' : 'not built') }}
        </v-chip>
      </div>
      <div class="d-flex align-center mb-1">
        <v-select
          v-model="buildMethod"
          :items="[
            { text: 'Around generic detections', value: 'detections' },
            { text: 'Detection and tracking', value: 'tracking' },
            { text: 'Around existing annotations', value: 'existing' },
          ]"
          dense
          hide-details
          label="Index type"
          class="mr-2"
        />
      </div>
      <div class="mb-3">
        <v-btn
          x-small
          color="primary"
          :disabled="indexBuilding || !!state.busy"
          @click="search.buildIndex(buildMethod)"
        >
          {{ state.status && state.status.built ? 'Rebuild' : 'Build' }}
        </v-btn>
        <v-btn
          x-small
          color="error"
          class="ml-2"
          :disabled="!(state.status && state.status.exists) || indexBuilding || !!state.busy"
          @click="deleteIndexConfirm"
        >
          Delete
        </v-btn>
      </div>
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
          :disabled="!(state.status && state.status.built) || selectedTrackBox === null || !!state.busy"
          @click="queryFromSelectedTrack"
        >
          Search from selected annotation
        </v-btn>
        <v-btn
          x-small
          block
          class="mb-1"
          :disabled="!(state.status && state.status.built) || !!state.busy"
          @click="queryFromImageFile(false)"
        >
          Search from image file...
        </v-btn>
        <v-btn
          x-small
          block
          :disabled="!(state.status && state.status.built) || !!state.busy"
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
      <template v-if="state.results.length">
        <v-divider class="mb-2" />
        <div class="d-flex align-center mb-1">
          <div class="text-subtitle-2">
            Results ({{ state.results.length }})
            <span v-if="state.iteration" class="text-caption">
              — iteration {{ state.iteration }}
            </span>
          </div>
          <v-spacer />
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
            v-for="result in state.results"
            :key="result.instance_id"
            outlined
            class="d-flex align-center pa-1 mb-1 result-row"
            @click="seekToResult(result)"
          >
            <img
              v-if="thumbnails[result.instance_id]"
              :src="thumbnails[result.instance_id]"
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
            </div>
            <v-btn
              icon
              x-small
              :color="state.adjudications[result.instance_id] === 'positive' ? 'success' : 'grey'"
              @click.stop="search.mark(result.instance_id, 'positive')"
            >
              <v-icon small>
                mdi-thumb-up
              </v-icon>
            </v-btn>
            <v-btn
              icon
              x-small
              :color="state.adjudications[result.instance_id] === 'negative' ? 'error' : 'grey'"
              @click.stop="search.mark(result.instance_id, 'negative')"
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
