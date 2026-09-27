<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, ref, watch,
} from 'vue';
import { isAxiosError } from 'axios';
import { useGirderRest } from 'platform/web-girder/plugins/girder';
import { useApi } from 'dive-common/apispec';
import { createChipStore } from 'dive-common/review/chipStore';
import { createFrameSourceRegistry } from 'dive-common/review/frameSource';
import { searchResultFrame, searchResultItem } from 'dive-common/review/searchResultItems';
import { reviewViewerLocation } from 'dive-common/review/viewerNavigation';
import type { ReviewItem } from 'dive-common/review/types';
import QueryExemplar from 'dive-common/components/QueryExemplar.vue';
import { pickQueryDataset } from 'platform/web-girder/api/scoringDatasetPicker';
import {
  captureQueryImage, listQueryIndexes, loadQuery, loadQueryRequest, queryJobStatus, submitQuery,
} from 'platform/web-girder/api/query.service';
import type {
  QueryArtifact, QueryHit, SearchRequest,
} from 'platform/web-girder/api/query.service';

function queryError(error: unknown): string {
  if (isAxiosError(error)) return error.response?.data?.message || error.message;
  return error instanceof Error ? error.message : String(error);
}

export default defineComponent({
  name: 'WebQuery',
  components: { QueryExemplar },
  setup() {
    const api = useApi();
    const owner = useGirderRest().user?._id || '';
    const storageKey = `dive-web-query:${owner}`;
    const registry = createFrameSourceRegistry(api.loadConfig);
    const chips = createChipStore({ frameSourceFor: registry.frameSourceFor }, {
      padding: 0.1, size: 160, aspect: 1, outline: '#00e5ff',
    });
    const page = ref(1);
    const indexes = ref<QueryArtifact[]>([]);
    const selected = ref<string[]>([]);
    const method = ref('detections');
    const methods = [
      { text: 'Around generic detections', value: 'detections' },
      { text: 'Detection and tracking', value: 'tracking' },
      { text: 'Around existing annotations', value: 'existing' },
      { text: 'Whole frames', value: 'frames' },
    ];
    const sourceDataset = ref<{ id: string; name: string } | null>(null);
    const sourceFrame = ref(0);
    const capturing = ref(false);
    const sourceUrl = ref('');
    const isVideo = ref(false);
    const video = ref<HTMLVideoElement | null>(null);
    const exemplar = ref('');
    const box = ref<[number, number, number, number] | null>(null);
    const error = ref('');
    const busy = ref(false);
    const active = ref<QueryArtifact | null>(null);
    const jobStatuses = ref<Record<string, number>>({});
    const hits = ref<QueryHit[]>([]);
    const visibleHits = computed(() => hits.value.slice((page.value - 1) * 24, page.value * 24));
    watch(visibleHits, (results) => {
      const items = results.map((hit) => {
        const item = searchResultItem(hit, hit.datasetId, 1);
        return item ? { ...item, key: hit.key } : null;
      }).filter((item): item is ReviewItem => item !== null);
      chips.ensurePrimary(items);
    });
    const marks = ref<Record<string, 'positive' | 'negative'>>({});
    const lastRequest = ref<SearchRequest | null>(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let imageGeneration = 0;
    const statusText = (entry: QueryArtifact) => {
      const status = entry.jobId ? jobStatuses.value[entry.jobId] : undefined;
      if (entry.ready || entry.response) return 'Complete';
      if (status === 4) return 'Failed — see Jobs';
      if (status === 5) return 'Canceled';
      return 'Queued / running — see Jobs';
    };
    async function refresh() {
      try {
        const loadedIndexes = await listQueryIndexes();
        if (disposed) return;
        indexes.value = loadedIndexes;
        const activeId = active.value?.id;
        if (activeId) {
          const loaded = await loadQuery(activeId);
          if (disposed || active.value?.id !== activeId) return;
          active.value = loaded;
          if (active.value.response) {
            hits.value = active.value.response.results;
            busy.value = false;
          }
        }
        const entries = [...indexes.value, ...(active.value ? [active.value] : [])];
        await Promise.all(entries.map(async (entry) => {
          if (!entry.jobId || entry.ready || entry.response) return;
          const status = await queryJobStatus(entry.jobId);
          jobStatuses.value = { ...jobStatuses.value, [entry.jobId]: status };
          if (entry.id === active.value?.id) {
            busy.value = ![3, 4, 5].includes(status);
            if (status === 3 && !entry.response) error.value = 'The job completed without a result. See Jobs for details.';
          }
        }));
      } catch (err) {
        error.value = queryError(err);
      } finally {
        if (!disposed) timer = setTimeout(refresh, 3000);
      }
    }
    async function buildIndex() {
      try {
        const dataset = await pickQueryDataset([]);
        if (!dataset) return;
        error.value = '';
        const entry = await submitQuery({ operation: 'index', datasetId: dataset.id, method: method.value });
        indexes.value = [entry, ...indexes.value];
      } catch (err) { error.value = queryError(err); }
    }
    function chooseFile(file: File | null) {
      imageGeneration += 1;
      const generation = imageGeneration;
      exemplar.value = '';
      box.value = null;
      if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value);
      sourceUrl.value = '';
      if (!file) return;
      sourceUrl.value = URL.createObjectURL(file);
      isVideo.value = file.type.startsWith('video/');
      if (!isVideo.value) {
        const image = new Image();
        image.onload = () => {
          if (generation !== imageGeneration) return;
          try { exemplar.value = captureQueryImage(image); } catch (err) { error.value = queryError(err); }
        };
        image.onerror = () => { error.value = 'This image format cannot be decoded by the browser.'; };
        image.src = sourceUrl.value;
      }
    }
    async function chooseSourceDataset() {
      sourceDataset.value = await pickQueryDataset([]);
      sourceFrame.value = 0;
    }
    async function captureDatasetFrame() {
      if (!sourceDataset.value || !Number.isInteger(Number(sourceFrame.value)) || Number(sourceFrame.value) < 0) return;
      capturing.value = true;
      try {
        const source = await registry.frameSourceFor(sourceDataset.value.id);
        if (!source) throw new Error('This dataset has no playable media.');
        const frame = await source.getFrame(Number(sourceFrame.value));
        const canvas = document.createElement('canvas');
        canvas.width = frame.width;
        canvas.height = frame.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Cannot capture this frame.');
        context.drawImage(frame.source, 0, 0);
        exemplar.value = canvas.toDataURL('image/png');
        box.value = null;
      } catch (err) { error.value = queryError(err); } finally { capturing.value = false; }
    }
    function captureFrame() {
      try {
        if (!video.value) return;
        video.value.pause();
        exemplar.value = captureQueryImage(video.value);
        box.value = null;
      } catch (err) { error.value = queryError(err); }
    }
    async function search(refine = false) {
      if (busy.value) return;
      busy.value = true;
      const previousActive = active.value;
      active.value = null;
      error.value = '';
      try {
        let request: SearchRequest;
        if (refine && lastRequest.value) {
          const feedback = { positive: [] as string[], negative: [] as string[] };
          Object.entries(marks.value).forEach(([key, mark]) => feedback[mark].push(key));
          request = { ...lastRequest.value, feedback: [...lastRequest.value.feedback, feedback] };
        } else {
          request = {
            operation: 'search',
            indexIds: [...selected.value],
            image: exemplar.value.split(',')[1],
            boxes: box.value ? [[...box.value]] : [],
            feedback: [],
          };
        }
        active.value = await submitQuery(request);
        lastRequest.value = request;
        hits.value = [];
        chips.reset();
        page.value = 1;
        marks.value = {};
        sessionStorage.setItem(storageKey, active.value.id);
      } catch (err) { active.value = previousActive; error.value = queryError(err); busy.value = false; }
    }
    function mark(hit: QueryHit, value: 'positive' | 'negative') {
      const next = { ...marks.value };
      if (next[hit.key] === value) delete next[hit.key];
      else next[hit.key] = value;
      marks.value = next;
    }
    onMounted(async () => {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        try {
          active.value = await loadQuery(saved);
          const request = await loadQueryRequest(saved);
          lastRequest.value = request;
          exemplar.value = `data:image/png;base64,${request.image}`;
          selected.value = request.indexIds;
          box.value = request.boxes[0] as [number, number, number, number] || null;
          busy.value = !active.value.response;
          const savedFeedback = sessionStorage.getItem(`${storageKey}:feedback`);
          if (savedFeedback) {
            const feedback = JSON.parse(savedFeedback);
            if (feedback.id === saved) { marks.value = feedback.marks; page.value = feedback.page; }
          }
        } catch { sessionStorage.removeItem(storageKey); }
      }
      await refresh();
    });
    onBeforeUnmount(() => {
      if (active.value) {
        sessionStorage.setItem(`${storageKey}:feedback`, JSON.stringify({
          id: active.value.id, marks: marks.value, page: page.value,
        }));
      }
      disposed = true;
      chips.reset();
      registry.dispose();
      imageGeneration += 1;
      clearTimeout(timer);
      if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value);
    });
    return {
      sourceDataset,
      sourceFrame,
      capturing,
      chooseSourceDataset,
      captureDatasetFrame,
      page,
      visibleHits,
      thumbnails: chips.chips,
      thumbnailErrors: chips.failures,
      indexes,
      selected,
      method,
      methods,
      sourceUrl,
      isVideo,
      video,
      exemplar,
      box,
      error,
      busy,
      active,
      hits,
      marks,
      lastRequest,
      statusText,
      buildIndex,
      chooseFile,
      captureFrame,
      search,
      mark,
      searchResultFrame,
      resultLocation: (hit: QueryHit) => reviewViewerLocation(hit.datasetId, { frame: searchResultFrame(hit) ?? 0 }),
      hasMarks: computed(() => Object.keys(marks.value).length > 0),
    };
  },
});
</script>

<template>
  <v-container fluid>
    <h1>Query</h1>
    <v-alert v-if="error" type="error" dismissible @input="error = ''">
      {{ error }}
    </v-alert>
    <v-row>
      <v-col cols="12" md="4">
        <h2>Search indexes</h2>
        <p>Build an index once, then select it for image or video-frame searches.</p>
        <v-select v-model="method" :items="methods" label="Index method" />
        <v-btn class="mb-3" @click="buildIndex">
          Choose dataset and build index
        </v-btn>
        <v-checkbox
          v-for="entry in indexes"
          :key="entry.id"
          :input-value="selected"
          :value="entry.id"
          :disabled="!entry.ready"
          :label="`${entry.name} (${entry.method || 'index'}) — ${statusText(entry)}`"
          :messages="entry.created ? new Date(entry.created).toLocaleString() : []"
          hide-details
          @change="selected = $event"
        />
        <h2 class="mt-6">
          Exemplar
        </h2>
        <v-file-input
          accept="image/*,video/*"
          label="Image or video file"
          :disabled="busy"
          @change="chooseFile"
        />
        <template v-if="isVideo && sourceUrl">
          <video ref="video" :src="sourceUrl" controls muted preload="metadata" style="max-width: 100%"><track kind="captions"></video>
          <v-btn class="my-2" :disabled="busy" @click="captureFrame">
            Use current video frame
          </v-btn>
        </template>
        <v-btn class="my-2" :disabled="busy" @click="chooseSourceDataset">
          Use a dataset frame
        </v-btn>
        <template v-if="sourceDataset">
          <p>{{ sourceDataset.name }}</p>
          <v-text-field v-model.number="sourceFrame" label="Frame number (starting at 0)" type="number" min="0" step="1" />
          <v-btn :loading="capturing" :disabled="busy || capturing" @click="captureDatasetFrame">
            Show frame
          </v-btn>
        </template>
        <QueryExemplar v-if="exemplar" :src="exemplar" :box.sync="box" />
        <v-btn
          class="mt-3"
          color="primary"
          :loading="busy"
          :disabled="!exemplar || !selected.length || busy"
          @click="search(false)"
        >
          Search
        </v-btn>
        <v-btn class="mt-3 ml-2" to="/jobs">
          Jobs
        </v-btn>
        <p v-if="active" class="mt-3">
          {{ statusText(active) }}
        </p>
        <p class="mt-3">
          Indexes and searches run as Jobs alongside other pipeline work.
        </p>
      </v-col>
      <v-col cols="12" md="8">
        <h2>Results</h2>
        <v-btn
          class="my-3"
          :disabled="busy || !lastRequest || !hasMarks"
          @click="search(true)"
        >
          Refine using feedback
        </v-btn>
        <p v-if="active && active.response && !hits.length">
          No matching results.
        </p>
        <v-simple-table v-if="hits.length">
          <thead><tr><th>Preview</th><th>Dataset</th><th>Frame</th><th>Score</th><th>Feedback</th></tr></thead>
          <tbody>
            <tr v-for="hit in visibleHits" :key="hit.key">
              <td>
                <img v-if="thumbnails[hit.key]" :src="thumbnails[hit.key]" alt="Search result crop" width="128" height="128">
                <span v-else>{{ thumbnailErrors[hit.key] || 'Loading preview…' }}</span>
              </td>
              <td>
                <router-link :to="resultLocation(hit)">
                  {{ indexes.find(entry => entry.datasetIds.includes(hit.datasetId))?.name || hit.datasetId }}
                </router-link>
              </td>
              <td>{{ searchResultFrame(hit) }}</td>
              <td>{{ hit.relevancy_score.toFixed(3) }}</td>
              <td>
                <v-btn small :disabled="busy" :color="marks[hit.key] === 'positive' ? 'success' : undefined" @click="mark(hit, 'positive')">
                  Correct
                </v-btn>
                <v-btn small :disabled="busy" :color="marks[hit.key] === 'negative' ? 'error' : undefined" @click="mark(hit, 'negative')">
                  Incorrect
                </v-btn>
              </td>
            </tr>
          </tbody>
        </v-simple-table>
        <v-pagination v-if="hits.length > 24" v-model="page" :length="Math.ceil(hits.length / 24)" />
      </v-col>
    </v-row>
  </v-container>
</template>
