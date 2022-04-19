<script lang="ts">
import {
  defineComponent, reactive, computed, toRef, watch, ref,
} from '@vue/composition-api';

import { usePendingSaveCount, useHandler, useTrackFilters } from 'vue-media-annotator/provides';
import AutosavePrompt from 'dive-common/components/AutosavePrompt.vue';
import { loadMetadata, exportDataset, exportConfiguration } from 'platform/desktop/frontend/api';
import type { JsonMeta } from 'platform/desktop/constants';

export default defineComponent({
  name: 'Export',

  components: { AutosavePrompt },

  props: {
    id: {
      type: String,
      required: true,
    },
    small: {
      type: Boolean,
      default: false,
    },
  },

  setup(props) {
    const data = reactive({
      menuOpen: false,
      excludeBelowThreshold: true,
      excludeUncheckedTypes: false,
      activator: 0,
      err: null as unknown,
      meta: null as JsonMeta | null,
      outPath: '',
    });
    const savePrompt = ref(false);

    const pendingSaveCount = usePendingSaveCount();
    const { save } = useHandler();
    const { checkedTypes } = useTrackFilters();

    watch(toRef(data, 'menuOpen'), async (newval) => {
      if (newval) {
        data.meta = await loadMetadata(props.id);
      } else {
        data.err = null;
        data.outPath = '';
      }
    });

    const thresholds = computed(() => (
      data.meta
        ? Object.keys(data.meta.confidenceFilters || {})
        : []));

    async function doExport({ type, forceSave = false }: { type: 'dataset' | 'configuration'; forceSave?: boolean}) {
      if (pendingSaveCount.value > 0 && forceSave) {
        await save();
        savePrompt.value = false;
      } else if (pendingSaveCount.value > 0) {
        savePrompt.value = true;
        return;
      }
      try {
        if (type === 'dataset') {
          const typeFilter = data.excludeUncheckedTypes ? checkedTypes.value : [];
          data.err = null;
          data.outPath = await exportDataset(props.id, data.excludeBelowThreshold, typeFilter);
        } else if (type === 'configuration') {
          data.outPath = await exportConfiguration(props.id);
        }
      } catch (err) {
        data.err = err;
        throw err;
      }
    }

    return {
      data,
      doExport,
      savePrompt,
      thresholds,
      checkedTypes,
    };
  },
});
</script>

<template>
  <v-menu
    v-model="data.menuOpen"
    :close-on-content-click="false"
    :nudge-width="280"
    offset-y
    max-width="280"
  >
    <template #activator="{ on: menuOn }">
      <v-tooltip bottom>
        <template #activator="{ on: tooltipOn }">
          <v-btn
            outlined
            depressed
            color="grey"
            text
            class="mx-1"
            :small="small"
            v-on="{ ...tooltipOn, ...menuOn }"
          >
            <v-icon>
              mdi-export
            </v-icon>
            <span
              v-show="!$vuetify.breakpoint.mdAndDown"
              class="pl-1"
            >
              Export
            </span>
          </v-btn>
        </template>
        <span>export annotation data</span>
      </v-tooltip>
    </template>
    <template>
      <v-card v-if="data.menuOpen">
        <v-card-title>
          Export options
        </v-card-title>

        <v-card-text class="pb-2">
          <v-dialog
            max-width="600"
            persistent
            :value="data.err"
            :overlay-opacity="0.95"
          >
            <v-card outlined>
              <v-card-text class="pa-3">
                <v-card-text class="text-h4">
                  Error
                </v-card-text>
                <v-alert
                  type="error"
                >
                  {{ data.err }}
                </v-alert>
              </v-card-text>
              <v-card-actions>
                <v-spacer />
                <v-btn
                  color="primary"
                  @click="data.err = null"
                >
                  <v-icon>mdi-close</v-icon>
                  Dismiss
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-dialog>
          <AutosavePrompt
            v-model="savePrompt"
            @save="doExport({type: 'dataset', forceSave: true })"
          />
          <v-alert
            v-if="data.outPath"
            dense
            class="text-caption"
            type="success"
          >
            Export succeeded.
          </v-alert>
          <div>Export to VIAME CSV format</div>
          <template v-if="thresholds.length">
            <v-checkbox
              v-model="data.excludeBelowThreshold"
              label="exclude tracks below confidence threshold"
              dense
              hide-details
            />
            <div
              v-if="data.meta && data.meta.confidenceFilters"
              class="pt-2"
            >
              <div>Current thresholds:</div>
              <span
                v-for="(val, key) in data.meta.confidenceFilters"
                :key="key"
                class="pt-2"
              >
                ({{ key }}, {{ val }})
              </span>
            </div>
          </template>

          <template v-if="checkedTypes.length">
            <v-checkbox
              v-model="data.excludeUncheckedTypes"
              label="export checked types only"
              dense
              hint="Export only the track types currently enabled in the type filter"
              persistent-hint
              class="pt-0"
            />
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            depressed
            block
            @click="doExport({ type: 'dataset' })"
          >
            <span>export detections</span>
          </v-btn>
        </v-card-actions>
        <v-card-text class="pb-0">
          Export the dataset configuration, including
          attribute definitions, types, styles, and thresholds.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            depressed
            block
            @click="doExport({ type: 'configuration' })"
          >
            Configuration
          </v-btn>
        </v-card-actions>
      </v-card>
    </template>
  </v-menu>
</template>
