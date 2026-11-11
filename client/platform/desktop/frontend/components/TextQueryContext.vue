<script lang="ts">
import {
  computed, defineComponent, onMounted, ref, watch,
} from 'vue';
import { useTime } from 'vue-media-annotator/provides';
import VlmSetupHelp from 'dive-common/components/VlmSetupHelp.vue';
import { openLink } from 'platform/desktop/frontend/api';
import { useTextQuery, useVlm } from 'platform/desktop/frontend/useVlm';
import VlmAskContext from './VlmAskContext.vue';

const SAM3 = 'sam3';
const VLM_PREFIX = 'vlm:';
const QUERY_TYPE_KEY = 'textQuery.model';
const VLM_MODE_KEY = 'textQuery.vlmMode';

function load(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preference only
  }
}

export default defineComponent({
  name: 'TextQueryContext',
  description: 'Text Query',
  components: { VlmAskContext, VlmSetupHelp },
  setup() {
    const vlm = useVlm();
    const textQuery = useTextQuery();
    const { frame } = useTime();

    const queryType = ref(load(QUERY_TYPE_KEY, SAM3));
    const vlmMode = ref(load(VLM_MODE_KEY, 'find'));
    watch(queryType, (value) => save(QUERY_TYPE_KEY, value));
    watch(vlmMode, (value) => save(VLM_MODE_KEY, value));

    const checking = ref(false);
    async function refreshModels() {
      if (!textQuery) return;
      checking.value = true;
      try {
        await textQuery.loadModels();
      } finally {
        checking.value = false;
      }
      const items = queryTypeItems.value;
      if (!items.some((item) => item.value === queryType.value)) {
        queryType.value = (items.find((item) => item.installed) ?? items[0]).value;
      }
    }
    onMounted(refreshModels);

    const sam3Installed = computed(() => !!textQuery?.sam3Installed.value);
    const models = computed(() => vlm?.state.models ?? []);
    const queryTypeItems = computed(() => [
      {
        text: sam3Installed.value ? 'SAM3' : 'SAM3 (not installed)',
        value: SAM3,
        installed: sam3Installed.value,
      },
      ...models.value.map((m) => ({
        text: m.installed ? m.name : `${m.name} (not installed)`,
        value: `${VLM_PREFIX}${m.name}`,
        installed: m.installed,
      })),
    ]);

    const vlmModel = computed(() => (queryType.value.startsWith(VLM_PREFIX)
      ? queryType.value.slice(VLM_PREFIX.length) : null));
    const vlmModelInfo = computed(() => models.value.find((m) => m.name === vlmModel.value));
    const isSam3 = computed(() => queryType.value === SAM3);
    const missing = computed(() => (isSam3.value && !sam3Installed.value)
      || (!!vlmModelInfo.value && !vlmModelInfo.value.installed));
    const showFind = computed(() => !missing.value
      && (isSam3.value || (!!vlmModel.value && vlmMode.value === 'find')));

    const text = ref('');
    const threshold = ref(0.3);
    const allFrames = ref(false);
    const tracked = ref(true);
    const replaceExisting = ref(true);
    // Tracked VLM results come straight from the tracker, which cannot keep
    // existing annotations.
    const replaceForced = computed(() => allFrames.value && tracked.value && !!vlmModel.value);

    async function search() {
      const query = text.value.trim();
      if (!textQuery || !query || textQuery.running.value) return;
      const params = {
        text: query,
        boxThreshold: threshold.value,
        replaceExisting: replaceForced.value || replaceExisting.value,
        vlmModel: vlmModel.value ?? undefined,
        tracked: tracked.value,
      };
      if (allFrames.value) {
        await textQuery.runAllFrames(params);
      } else {
        await textQuery.runFrame({ ...params, frameNum: frame.value });
      }
    }

    return {
      textQuery,
      vlm,
      queryType,
      queryTypeItems,
      vlmMode,
      vlmModel,
      isSam3,
      missing,
      showFind,
      checking,
      refreshModels,
      text,
      threshold,
      allFrames,
      tracked,
      replaceExisting,
      replaceForced,
      search,
      openLink,
    };
  },
});
</script>

<template>
  <div class="text-query-context">
    <div class="d-flex align-center px-2 pt-2">
      <v-select
        v-model="queryType"
        :items="queryTypeItems"
        label="Model"
        dense
        outlined
        hide-details
      />
      <v-btn
        icon
        small
        class="ml-1"
        title="Refresh model list"
        :loading="checking"
        @click="refreshModels"
      >
        <v-icon small>
          mdi-refresh
        </v-icon>
      </v-btn>
    </div>

    <div
      v-if="textQuery"
      class="pa-2"
    >
      <v-alert
        v-if="isSam3 && missing"
        type="info"
        dense
        text
        class="text-body-2"
      >
        SAM3 text query needs the SAM3 Text Query Segmentation and Tracking
        Models add-on.
        <v-btn
          small
          outlined
          color="primary"
          class="mt-2"
          :to="{ name: 'addons' }"
        >
          Open Add-Ons
        </v-btn>
      </v-alert>
      <VlmSetupHelp
        v-else-if="missing && vlmModel"
        :model="vlmModel"
        :server-available="!!vlm && vlm.state.available"
        :checking="checking"
        @check="refreshModels"
        @open-link="openLink"
      />

      <v-btn-toggle
        v-if="vlmModel && !missing"
        v-model="vlmMode"
        mandatory
        dense
        class="mb-3 d-flex"
      >
        <v-btn
          value="find"
          small
          class="flex-grow-1"
        >
          Find objects
        </v-btn>
        <v-btn
          value="ask"
          small
          class="flex-grow-1"
        >
          Ask
        </v-btn>
      </v-btn-toggle>

      <div v-if="showFind">
        <v-text-field
          v-model="text"
          label="Objects to find"
          placeholder="e.g., fish swimming near coral"
          dense
          outlined
          hide-details
          class="mb-2"
          @keyup.enter="search"
        />
        <v-slider
          v-if="isSam3"
          v-model="threshold"
          :label="`Threshold: ${Number(threshold).toFixed(2)}`"
          min="0.1"
          max="0.9"
          step="0.05"
          dense
          hide-details
          class="mb-1"
        />
        <v-checkbox
          v-model="allFrames"
          label="Apply to all frames (runs as a job)"
          dense
          hide-details
        />
        <v-checkbox
          v-if="allFrames"
          v-model="tracked"
          label="Track results across frames"
          dense
          hide-details
        />
        <v-checkbox
          :input-value="replaceForced || replaceExisting"
          :disabled="replaceForced"
          label="Replace existing annotations"
          :hint="replaceForced ? 'Tracked vision-model results always replace existing annotations' : ''"
          :persistent-hint="replaceForced"
          :hide-details="!replaceForced"
          dense
          class="mb-2"
          @change="replaceExisting = !!$event"
        />
        <v-btn
          block
          color="primary"
          :loading="textQuery && textQuery.running.value"
          :disabled="!text.trim()"
          @click="search"
        >
          Search
        </v-btn>
        <div
          v-if="!isSam3"
          class="text-caption text--secondary mt-2"
        >
          Boxes from a vision-language model carry no confidence score.
        </div>
      </div>

      <VlmAskContext
        v-else-if="vlmModel && !missing"
        :model="vlmModel"
      />
    </div>
  </div>
</template>
