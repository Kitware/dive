<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, onMounted, ref, toRef, watch, Ref, PropType, nextTick,
} from 'vue';

import Viewer from 'dive-common/components/Viewer.vue';
import NavigationTitle from 'dive-common/components/NavigationTitle.vue';
import RunPipelineMenu from 'dive-common/components/RunPipelineMenu.vue';
import ImportAnnotations from 'dive-common/components/ImportAnnotations.vue';
import SidebarContext from 'dive-common/components/SidebarContext.vue';
import context from 'dive-common/store/context';
import { useStore } from 'platform/web-girder/store/types';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { useApi, SegmentationPredictRequest } from 'dive-common/apispec';
import { convertLargeImage, segmentationPredict, segmentationInitialize } from 'platform/web-girder/api/rpc.service';
import { useRouter } from 'vue-router/composables';
import JobsTab from './JobsTab.vue';
import Export from './Export.vue';
import Clone from './Clone.vue';
import ViewerAlert from './ViewerAlert.vue';
import RevisionHistory from './RevisionHistory.vue';
import AnnotationSets from './AnnotationSets.vue';

const buttonOptions = {
  text: true,
  color: 'grey lighten-1',
  outlined: true,
  depressed: true,
  class: ['mx-1'],
};

const menuOptions = {
  offsetY: true,
  bottom: true,
};

context.register({
  component: RevisionHistory,
  description: 'Revision History',
});

context.register({
  component: AnnotationSets,
  description: 'Annotation Sets',
});

/**
 * ViewerLoader is responsible for loading
 * data from girder.
 */
export default defineComponent({
  components: {
    Clone,
    Export,
    JobsTab,
    RunPipelineMenu,
    NavigationTitle,
    Viewer,
    ImportAnnotations,
    RevisionHistory,
    SidebarContext,
    ViewerAlert,
    AnnotationSets,
    ...context.getComponents(),
  },

  // TODO: This will require an import from vue-router for Vue3 compatibility
  async beforeRouteLeave(to, from, next) {
    if (await this.viewerRef.navigateAwayGuard()) {
      next();
    }
  },

  props: {
    id: {
      type: String,
      required: true,
    },
    revision: {
      type: String,
      default: undefined,
    },
    set: {
      type: String,
      default: undefined,
    },
    comparisonSets: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },

  setup(props) {
    const { loadMetadata } = useApi();
    const { prompt } = usePrompt();
    const router = useRouter();
    const viewerRef = ref();
    const store = useStore();
    const brandData = toRef(store.state.Brand, 'brandData');
    const revisionNum = computed(() => {
      const parsed = Number.parseInt(props.revision, 10);
      if (Number.isNaN(parsed)) return undefined;
      return parsed;
    });
    const { getters } = store;
    const currentJob = computed(() => getters['Jobs/datasetCompleteJobs'](props.id));

    const typeList: Ref<string[]> = ref([]);

    const findType = async () => {
      const meta = await loadMetadata(props.id);
      typeList.value = [meta.type];
    };
    findType();
    const runningPipelines = computed(() => {
      const results: string[] = [];
      if (getters['Jobs/datasetRunningState'](props.id)) {
        results.push(props.id);
      }
      return results;
    });

    if (props.revision) {
      /* When a revision is loaded, toggle the revision history on */
      context.state.active = 'RevisionHistory';
    }

    watch(currentJob, async () => {
      if (currentJob.value !== false && currentJob.value !== undefined) {
        if (currentJob.value.success) {
          const result = await prompt({
            title: 'Pipeline Finished',
            text: [`Pipeline: ${currentJob.value.title}`,
              'finished running on the current dataset.  Click reload to load the annotations.  The current annotations will be replaced with the pipeline output.',
            ],
            confirm: true,
            positiveButton: 'Reload',
            negativeButton: '',
          });
          store.dispatch('Jobs/removeCompleteJob', { datasetId: props.id });
          if (result) {
            viewerRef.value.reloadAnnotations();
          }
        } else {
          await prompt({
            title: 'Pipeline Incomplete',
            text: [`Pipeline: ${currentJob.value.title}`,
              'either failed or was cancelled by the user',
            ],
          });
          store.dispatch('Jobs/removeCompleteJob', { datasetId: props.id });
        }
      }
    });

    onMounted(() => {
      window.addEventListener('beforeunload', viewerRef.value.warnBrowserExit);
      initializeSegmentation();
    });

    onBeforeUnmount(() => {
      window.removeEventListener('beforeunload', viewerRef.value.warnBrowserExit);
    });

    function routeRevision(revisionId: number | undefined, set?: string) {
      if (set && set !== 'default' && revisionId !== undefined) {
        router.replace({
          name: 'revision set viewer',
          params: { id: props.id, revision: revisionId.toString(), set },
        });
      } else if (revisionId === undefined) {
        router.replace({
          name: 'viewer',
          params: { id: props.id },
        });
      } else {
        router.replace({
          name: 'revision viewer',
          params: { id: props.id, revision: revisionId.toString() },
        });
      }
    }

    function routeSet(set: string) {
      if (set === 'default') {
        router.replace({
          name: 'viewer',
          params: { id: props.id },
        });
      } else {
        router.replace({
          name: 'set viewer',
          params: { id: props.id, set },
        });
      }
      viewerRef.value.reloadAnnotations();
    }

    async function largeImageWarning() {
      const result = await prompt({
        title: 'Large Image Warning',
        text: ['The current Image Sequence dataset has a large resolution',
          'This may prevent the image from being shown on certain hardware/browsers',
          'This can be automatically converted to a tiled Large Image for proper viewing',
        ],
        confirm: true,
        positiveButton: 'Convert',
        negativeButton: 'Cancel',

      });
      if (result) {
        convertLargeImage(props.id);
      }
    }

    /**
     * Initialize segmentation recipe with platform-specific functions
     */
    async function initializeSegmentation() {
      await nextTick(); // Wait for Viewer to be mounted
      if (!viewerRef.value?.segmentationRecipe) {
        console.warn('[Segmentation] segmentationRecipe not found on Viewer');
        return;
      }

      try {
        // Initialize the recipe
        // Web platform uses folderId + frameNum; the backend resolves the actual image path
        viewerRef.value.segmentationRecipe.initialize({
          predictFn: (request: SegmentationPredictRequest, frameNum: number) => segmentationPredict(props.id, frameNum, request),
          getImagePath: () => '', // Not used for web platform - backend resolves paths
          // Initialize the segmentation service when the recipe is activated (user clicks Segment button)
          initializeServiceFn: segmentationInitialize,
        });

        console.log('[Segmentation] Recipe initialized successfully for web');
      } catch (error) {
        console.error('[Segmentation] Failed to initialize recipe:', error);
      }
    }

    return {
      buttonOptions,
      brandData,
      context,
      menuOptions,
      revisionNum,
      viewerRef,
      getters,
      currentJob,
      runningPipelines,
      routeRevision,
      routeSet,
      largeImageWarning,
      typeList,
    };
  },
});
</script>

<template>
  <Viewer
    :id="id"
    :key="id"
    ref="viewerRef"
    :revision="revisionNum"
    :current-set="set"
    :read-only-mode="!!getters['Jobs/datasetRunningState'](id)"
    :comparison-sets="comparisonSets"
    @large-image-warning="largeImageWarning()"
    @update:set="routeSet"
  >
    <template #title>
      <ViewerAlert />
      <NavigationTitle :name="brandData.name" />
      <v-tabs
        icons-and-text
        hide-slider
        class="mx-2"
        style="flex-basis:0; flex-grow:0;"
      >
        <v-tab :to="getters['Location/locationRoute']">
          Data
          <v-icon>mdi-database</v-icon>
        </v-tab>
        <JobsTab />
      </v-tabs>
    </template>
    <template #title-right>
      <RunPipelineMenu
        v-bind="{ buttonOptions, menuOptions, typeList }"
        :selected-dataset-ids="[id]"
        :running-pipelines="runningPipelines"
        :read-only-mode="revisionNum !== undefined"
      />
      <ImportAnnotations
        :button-options="buttonOptions"
        :menu-options="menuOptions"
        :read-only-mode="!!getters['Jobs/datasetRunningState'](id) || revisionNum !== undefined"
        :dataset-id="id"
        block-on-unsaved
      />
      <Export
        v-bind="{ buttonOptions, menuOptions }"
        :dataset-ids="[id]"
        block-on-unsaved
      />
      <Clone
        v-if="$store.state.Dataset.meta"
        v-bind="{ buttonOptions, menuOptions }"
        :dataset-id="id"
        :revision="revisionNum"
      />
    </template>
    <template #right-sidebar>
      <SidebarContext>
        <template #default="{ name, subCategory }">
          <component
            :is="name"
            :sub-category="subCategory"
            @update:revision="routeRevision"
          />
        </template>
      </SidebarContext>
    </template>
  </Viewer>
</template>
