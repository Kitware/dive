<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, ref, watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import { getMediaUrl } from 'platform/desktop/frontend/api';
import { createQueryPage } from 'platform/desktop/frontend/useQueryPage';
import { provideVideoSearch } from 'platform/desktop/frontend/useVideoSearch';
import { createItemChips, createSearchChips } from 'platform/desktop/frontend/useSearchChips';
import { usePersistentGridSettings } from 'dive-common/review/gridSettings';
import { useReviewGrid } from 'dive-common/review/useReviewGrid';
import { reviewViewerLocation } from 'dive-common/review/viewerNavigation';
import type { ReviewItem } from 'dive-common/review/types';
import ReviewGrid from 'dive-common/components/Review/ReviewGrid.vue';
import ReviewGridControls from 'dive-common/components/Review/ReviewGridControls.vue';
import ReviewCell from 'dive-common/components/Review/ReviewCell.vue';
import NavigationBar from './NavigationBar.vue';
import QueryDatasetsPanel from './QueryDatasetsPanel.vue';
import VideoSearchResultsGrid from './VideoSearchResultsGrid.vue';
import QueryExemplar from './QueryExemplar.vue';

type QueryView = 'query' | 'datasets';

/** Footer height of a text-hit cell (label and frame line), for the chip aspect. */
const TextCellFooterPx = 44;

/**
 * The Query page: choose datasets and index them, then search across them
 * from an image, a video frame or a text prompt, reviewing the ranked hits
 * in the chip grid.
 */
export default defineComponent({
  name: 'QueryPage',
  components: {
    NavigationBar, QueryDatasetsPanel, VideoSearchResultsGrid, QueryExemplar, ReviewGrid, ReviewGridControls, ReviewCell,
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const page = createQueryPage();
    provideVideoSearch(page.search);
    const view = ref<QueryView>(route.query.view === 'datasets' ? 'datasets' : 'query');
    const searchChips = createSearchChips(page.search);
    const textChips = createItemChips(page.textItems);
    const gridSettings = usePersistentGridSettings();
    const textGridActive = computed(() => view.value === 'query' && page.mode.value === 'text');
    const textGrid = useReviewGrid({
      items: page.textItems,
      grid: gridSettings,
      chipStore: textChips.store,
      active: textGridActive,
      footerPx: TextCellFooterPx,
      outline: '',
    });

    const imageUrl = ref('');
    watch(page.imagePath, async (path) => {
      imageUrl.value = path ? await getMediaUrl(path) : '';
    });
    const videoFrameUrl = ref('');
    watch(page.videoFramePath, async (path) => {
      videoFrameUrl.value = path ? await getMediaUrl(path) : '';
    });

    const datasetChoices = computed(() => page.datasets.value.map((d) => ({ value: d.id, text: d.name })));

    /** Dataset ids handed off by the library selection. */
    const initialDatasetIds = computed(() => {
      const query = route.query.datasetIds;
      const values = Array.isArray(query) ? query : [query];
      return values.flatMap((value) => (value || '').split(',')).filter(Boolean);
    });

    async function pickImage() {
      const ret = await window.diveDesktop.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tif', 'tiff'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (ret.canceled || !ret.filePaths?.length) return;
      [page.imagePath.value] = ret.filePaths;
      page.imageBox.value = null;
    }

    async function pickVideoFile() {
      const ret = await window.diveDesktop.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Videos', extensions: ['mp4', 'avi', 'mov', 'mkv', 'mpg', 'mpeg', 'webm'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (ret.canceled || !ret.filePaths?.length) return;
      [page.video.filePath] = ret.filePaths;
      page.video.kind = 'file';
      page.videoFramePath.value = '';
    }

    async function pickModel() {
      const ret = await window.diveDesktop.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'SVM Models', extensions: ['svm'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (ret.canceled || !ret.filePaths?.length) return;
      [page.warmStartModel.value] = ret.filePaths;
    }

    function openViewer(datasetId: string, frame?: number) {
      router.push(reviewViewerLocation(datasetId, frame === undefined ? {} : { frame }));
    }

    const textCells = computed(() => textGrid.pageItems.value.map((item) => {
      const hit = page.hitOf(item.key);
      return {
        item,
        hit,
        subtitle: `${page.datasetName(item.datasetId)} · frame ${item.primary.frame}`,
        title: `${page.datasetName(item.datasetId)} · frame ${item.primary.frame}`,
      };
    }));

    const textCountLabel = computed(() => {
      const count = page.textHits.value.length;
      const base = `${count} hit${count === 1 ? '' : 's'}`;
      const { running, done, total } = page.textProgress;
      return running ? `${base} · ${done}/${total} frames` : base;
    });

    function onKeydown(event: KeyboardEvent) {
      textGrid.handleKeydown(event);
    }

    onMounted(async () => {
      window.addEventListener('keydown', onKeydown);
      await page.refreshAvailable();
      if (initialDatasetIds.value.length) {
        await page.addDatasets(initialDatasetIds.value);
        if (page.datasets.value.every((d) => d.index !== 'indexed')) view.value = 'datasets';
      } else if (page.datasets.value.length === 0) {
        view.value = 'datasets';
      }
    });
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown);
      page.cancelTextQuery();
      textGrid.dispose();
      searchChips.dispose();
      textChips.dispose();
    });

    async function saveModel() {
      const name = window.prompt('Name for the trained model');
      if (!name) return;
      const dir = await page.search.saveModel(name.trim());
      if (dir) window.alert(`Saved trained model to ${dir}.`);
    }

    function searchSimilar(item: ReviewItem) {
      const hit = page.hitOf(item.key);
      if (hit) {
        page.mode.value = 'image';
        page.searchSimilarTo(hit);
      }
    }

    return {
      page,
      view,
      searchChips,
      textChips,
      gridSettings,
      textGrid,
      textCells,
      textCountLabel,
      imageUrl,
      videoFrameUrl,
      datasetChoices,
      pickImage,
      pickVideoFile,
      pickModel,
      openViewer,
      saveModel,
      searchSimilar,
    };
  },
});
</script>

<template>
  <v-main>
    <navigation-bar />
    <div class="query-page">
      <div class="query-toolbar d-flex align-center flex-wrap px-2 pt-2">
        <v-btn-toggle
          :value="view"
          mandatory
          dense
          class="mr-3"
          @change="view = $event"
        >
          <v-btn
            small
            value="query"
          >
            <v-icon
              small
              left
            >
              mdi-image-search-outline
            </v-icon>
            Query
          </v-btn>
          <v-btn
            small
            value="datasets"
          >
            <v-icon
              small
              left
            >
              mdi-database
            </v-icon>
            Datasets
            <span class="ml-1 grey--text">({{ page.datasets.value.length }})</span>
          </v-btn>
        </v-btn-toggle>

        <template v-if="view === 'query'">
          <v-btn-toggle
            :value="page.mode.value"
            mandatory
            dense
            class="mr-3"
            @change="page.mode.value = $event"
          >
            <v-btn
              small
              value="image"
            >
              Image
            </v-btn>
            <v-btn
              small
              value="video"
            >
              Video
            </v-btn>
            <v-btn
              small
              value="text"
            >
              Text
            </v-btn>
          </v-btn-toggle>
          <span class="text-caption grey--text">
            {{ page.indexedIds.value.length }} of {{ page.datasets.value.length }} datasets indexed
          </span>
        </template>
        <v-spacer />
        <v-btn
          v-if="view === 'query' && page.mode.value !== 'text'"
          small
          outlined
          :disabled="!page.search.state.modelAvailable || !!page.search.state.busy"
          class="mr-2"
          @click="saveModel"
        >
          <v-icon
            small
            left
          >
            mdi-content-save
          </v-icon>
          Save model
        </v-btn>
      </div>

      <v-alert
        v-if="page.error.value"
        dense
        dismissible
        type="error"
        class="mx-2 my-1"
        @input="page.clearError()"
      >
        {{ page.error.value }}
      </v-alert>

      <div class="query-body px-2 pb-2">
        <QueryDatasetsPanel
          v-if="view === 'datasets'"
          :page="page"
          @open-dataset="openViewer"
        />
        <template v-else>
          <div
            v-if="page.installed.value === false"
            class="d-flex flex-column align-center justify-center fill-height grey--text"
          >
            Video search tools were not found in the VIAME install.
          </div>
          <div
            v-else-if="page.datasets.value.length === 0"
            class="d-flex flex-column align-center justify-center fill-height grey--text"
          >
            <div class="mb-3">
              No datasets are selected. Select one or more on the Datasets panel.
            </div>
            <v-btn
              small
              outlined
              @click="view = 'datasets'"
            >
              Datasets
            </v-btn>
          </div>
          <div
            v-else
            class="query-layout"
          >
            <!-- Query controls -->
            <div class="query-controls">
              <template v-if="page.mode.value === 'image'">
                <div class="text-subtitle-2 mb-1">
                  Search from an image
                </div>
                <div class="text-caption grey--text mb-2">
                  Pick an exemplar image; drag a box on it to search for one object, or leave it to search for the whole image.
                </div>
                <v-btn
                  small
                  outlined
                  class="mb-2"
                  @click="pickImage"
                >
                  <v-icon
                    small
                    left
                  >
                    mdi-image
                  </v-icon>
                  {{ page.imagePath.value ? 'Change image' : 'Choose image…' }}
                </v-btn>
                <QueryExemplar
                  v-if="imageUrl"
                  :src="imageUrl"
                  :box="page.imageBox.value"
                  @update:box="page.imageBox.value = $event"
                />
                <div class="text-caption text-truncate grey--text mt-1">
                  {{ page.imagePath.value }}
                </div>
                <v-btn
                  small
                  depressed
                  color="primary"
                  class="mt-2"
                  :disabled="!page.imagePath.value || !page.canSearch.value"
                  :loading="!!page.search.state.busy"
                  @click="page.runImageQuery()"
                >
                  <v-icon
                    small
                    left
                  >
                    mdi-magnify
                  </v-icon>
                  Search {{ page.indexedIds.value.length }} indexed datasets
                </v-btn>
              </template>

              <template v-else-if="page.mode.value === 'video'">
                <div class="text-subtitle-2 mb-1">
                  Search from a video frame
                </div>
                <v-btn-toggle
                  :value="page.video.kind"
                  mandatory
                  dense
                  class="mb-2"
                  @change="page.video.kind = $event; page.videoFramePath.value = ''"
                >
                  <v-btn
                    small
                    value="dataset"
                  >
                    A dataset
                  </v-btn>
                  <v-btn
                    small
                    value="file"
                  >
                    A video file
                  </v-btn>
                </v-btn-toggle>
                <v-select
                  v-if="page.video.kind === 'dataset'"
                  :value="page.video.datasetId"
                  :items="datasetChoices"
                  label="Dataset"
                  dense
                  outlined
                  hide-details
                  class="mb-2"
                  @change="page.video.datasetId = $event; page.videoFramePath.value = ''"
                />
                <div
                  v-else
                  class="mb-2"
                >
                  <v-btn
                    small
                    outlined
                    @click="pickVideoFile"
                  >
                    <v-icon
                      small
                      left
                    >
                      mdi-video
                    </v-icon>
                    {{ page.video.filePath ? 'Change video' : 'Choose video…' }}
                  </v-btn>
                  <div class="text-caption text-truncate grey--text mt-1">
                    {{ page.video.filePath }}
                  </div>
                </div>
                <div class="d-flex align-center mb-2">
                  <v-text-field
                    :value="page.video.frame"
                    type="number"
                    min="0"
                    step="1"
                    label="Frame"
                    dense
                    outlined
                    hide-details
                    class="frame-field mr-2"
                    @change="page.video.frame = Math.max(0, Number($event) || 0); page.videoFramePath.value = ''"
                  />
                  <v-btn
                    small
                    outlined
                    @click="page.previewVideoFrame()"
                  >
                    Show frame
                  </v-btn>
                </div>
                <QueryExemplar
                  v-if="videoFrameUrl"
                  :src="videoFrameUrl"
                  :box="page.videoFrameBox.value"
                  @update:box="page.videoFrameBox.value = $event"
                />
                <div
                  v-else
                  class="text-caption grey--text"
                >
                  Show the frame, then drag a box on it to search for one object (or search the whole frame).
                </div>
                <v-btn
                  small
                  depressed
                  color="primary"
                  class="mt-2"
                  :disabled="!page.canSearch.value || (page.video.kind === 'dataset' ? !page.video.datasetId : !page.video.filePath)"
                  :loading="!!page.search.state.busy"
                  @click="page.runVideoQuery()"
                >
                  <v-icon
                    small
                    left
                  >
                    mdi-magnify
                  </v-icon>
                  Search {{ page.indexedIds.value.length }} indexed datasets
                </v-btn>
              </template>

              <template v-else>
                <div class="text-subtitle-2 mb-1">
                  Search by text
                </div>
                <div class="text-caption grey--text mb-2">
                  Describe what to find. Sampled frames of every listed dataset are searched with the SAM3 text model;
                  hits can then seed a similarity search over the index.
                </div>
                <v-alert
                  v-if="page.sam3Installed.value === false"
                  dense
                  text
                  type="warning"
                  class="mb-2"
                >
                  The SAM3 add-on was not found in the VIAME install; text queries need it.
                </v-alert>
                <v-text-field
                  v-model="page.text.prompt"
                  label="What to find (e.g. fish, diver, net)"
                  dense
                  outlined
                  hide-details
                  class="mb-2"
                  @keydown.enter="page.runTextQuery()"
                />
                <div class="d-flex flex-wrap text-fields mb-2">
                  <v-text-field
                    v-model.number="page.text.threshold"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    label="Min score"
                    dense
                    outlined
                    hide-details
                  />
                  <v-text-field
                    v-model.number="page.text.maxPerFrame"
                    type="number"
                    min="1"
                    step="1"
                    label="Hits per frame"
                    dense
                    outlined
                    hide-details
                  />
                  <v-text-field
                    v-model.number="page.text.stride"
                    type="number"
                    min="1"
                    step="1"
                    label="Every N frames"
                    dense
                    outlined
                    hide-details
                  />
                  <v-text-field
                    v-model.number="page.text.maxFrames"
                    type="number"
                    min="1"
                    step="1"
                    label="Frames per dataset"
                    dense
                    outlined
                    hide-details
                  />
                </div>
                <div class="d-flex align-center">
                  <v-btn
                    small
                    depressed
                    color="primary"
                    :disabled="!page.text.prompt.trim() || page.textProgress.running || page.sam3Installed.value === false"
                    @click="page.runTextQuery()"
                  >
                    <v-icon
                      small
                      left
                    >
                      mdi-text-search
                    </v-icon>
                    Search {{ page.datasets.value.length }} datasets
                  </v-btn>
                  <v-btn
                    v-if="page.textProgress.running"
                    small
                    text
                    class="ml-2"
                    @click="page.cancelTextQuery()"
                  >
                    Stop
                  </v-btn>
                </div>
                <v-progress-linear
                  v-if="page.textProgress.running"
                  :value="page.textProgress.total ? (100 * page.textProgress.done) / page.textProgress.total : 0"
                  class="mt-2"
                />
              </template>

              <div class="mt-4">
                <v-switch
                  v-if="page.mode.value !== 'text'"
                  v-model="page.onlySelected.value"
                  dense
                  hide-details
                  label="Only results from the listed datasets"
                  class="mt-0"
                />
                <div
                  v-if="page.mode.value !== 'text'"
                  class="text-caption grey--text mt-2"
                >
                  <span v-if="page.warmStartModel.value">Warm start model: {{ page.warmStartModel.value }}</span>
                  <a
                    class="ml-1"
                    @click="pickModel"
                  >{{ page.warmStartModel.value ? 'change' : 'Start from a saved model…' }}</a>
                  <a
                    v-if="page.warmStartModel.value"
                    class="ml-1"
                    @click="page.warmStartModel.value = ''"
                  >clear</a>
                </div>
              </div>
            </div>

            <!-- Results -->
            <div class="query-results">
              <VideoSearchResultsGrid
                v-if="page.mode.value !== 'text'"
                inline
                :search-chips="searchChips"
                @open-result="openViewer"
              />
              <div
                v-else
                class="text-results d-flex flex-column"
              >
                <ReviewGridControls
                  :grid="gridSettings"
                  :page="textGrid.page.value"
                  :page-count="textGrid.pageCount.value"
                  :count-label="textCountLabel"
                  :can-zoom-in="textGrid.canZoomIn.value"
                  :can-zoom-out="textGrid.canZoomOut.value"
                  @update:page="textGrid.goToPage"
                  @set-columns="textGrid.setColumns"
                  @set-rows="textGrid.setRows"
                  @set-padding="textGrid.setPadding"
                  @zoom="textGrid.zoom"
                />
                <div
                  v-if="page.textHits.value.length === 0"
                  class="d-flex align-center justify-center flex-grow-1 grey--text"
                >
                  {{ page.textProgress.running ? 'Searching…' : 'No text query hits yet.' }}
                </div>
                <div
                  v-else
                  class="text-results-body flex-grow-1 pa-2"
                >
                  <ReviewGrid
                    :columns="gridSettings.columns"
                    :rows="gridSettings.rows"
                    @cell-size="textGrid.cellSize.value = $event"
                  >
                    <ReviewCell
                      v-for="cell in textCells"
                      :key="cell.item.key"
                      :src="textChips.chips.value[cell.item.key] || null"
                      :transform="textChips.store.transforms.value[cell.item.key] || null"
                      :frames="cell.item.frames"
                      :failure="textChips.store.failures.value[cell.item.key] || null"
                      :animate="false"
                      :type="cell.item.type"
                      :confidence="cell.item.confidence"
                      :title="cell.title"
                      :subtitle="cell.subtitle"
                      :editable="false"
                      :deletable="false"
                      @open="openViewer(cell.item.datasetId, cell.item.primary.frame)"
                    >
                      <template #actions>
                        <v-btn
                          icon
                          small
                          class="cell-action"
                          title="Search the index for objects like this one"
                          :disabled="!page.canSearch.value"
                          @click.stop="searchSimilar(cell.item)"
                        >
                          <v-icon color="grey lighten-1">
                            mdi-magnify-scan
                          </v-icon>
                        </v-btn>
                        <v-btn
                          icon
                          small
                          class="cell-action"
                          title="Open in the annotation viewer at this frame"
                          @click.stop="openViewer(cell.item.datasetId, cell.item.primary.frame)"
                        >
                          <v-icon color="grey lighten-1">
                            mdi-open-in-new
                          </v-icon>
                        </v-btn>
                      </template>
                    </ReviewCell>
                  </ReviewGrid>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </v-main>
</template>

<style lang="scss" scoped>
.query-page {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.query-toolbar {
  flex: 0 0 auto;
  gap: 4px 0;
}

.query-body {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  overflow: auto;
}

.query-layout {
  display: flex;
  height: 100%;
  min-height: 0;
  gap: 12px;
}

.query-controls {
  flex: 0 0 340px;
  min-width: 0;
  overflow: auto;
  padding: 8px;
  border: 1px solid #333;
  border-radius: 4px;
}

.query-results {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  border: 1px solid #333;
  border-radius: 4px;
  overflow: hidden;
}

.text-results {
  height: 100%;
  min-height: 0;
}

.text-results-body {
  min-height: 0;
  overflow: hidden;
}

.frame-field {
  max-width: 140px;
}

.text-fields {
  gap: 8px;

  .v-input {
    flex: 1 1 120px;
  }
}
</style>
