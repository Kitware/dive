<script lang="ts">
import {
  isConversion,
  isExportTrainedPipeline,
  isRunPipeline,
  isRunTraining,
  JobArgs,
} from 'platform/desktop/constants';
import {
  defineComponent,
  ref,
  Ref,
  watch,
  onMounted,
} from 'vue';
import {
  queuedCpuJobs,
  queuedGpuJobs,
} from 'platform/desktop/frontend/store/jobs';
import { datasets } from '../store/dataset';

export default defineComponent({
  setup() {
    const queuedJobSpecs: Ref<JobArgs[]> = ref([]);
    function updateQueuedJobSpecs() {
      queuedJobSpecs.value = [];
      queuedGpuJobs.value.forEach((spec: JobArgs) => queuedJobSpecs.value.push(spec));
      queuedCpuJobs.value.forEach((spec: JobArgs) => queuedJobSpecs.value.push(spec));
    }
    watch([() => queuedCpuJobs, () => queuedGpuJobs], updateQueuedJobSpecs, { deep: true });

    function getQueuedJobTitle(jobSpec: JobArgs): string {
      if (isConversion(jobSpec)) {
        return `conversion: ${datasets.value[jobSpec.meta.id]?.name || jobSpec.meta.id}`;
      }
      if (isRunPipeline(jobSpec)) {
        return `pipeline: ${datasets.value[jobSpec.datasetId]?.name || jobSpec.datasetId}`;
      }
      if (isExportTrainedPipeline(jobSpec)) {
        return `export trained pipeline: ${jobSpec.path}`;
      }
      if (isRunTraining(jobSpec)) {
        const title = `training: ${datasets.value[jobSpec.datasetIds[0]]?.name || jobSpec.datasetIds[0]}`;
        if (jobSpec.datasetIds.length > 1) {
          return `${title} (and ${jobSpec.datasetIds.length - 1} more)`;
        }
        return title;
      }
      return 'queued job';
    }

    function getJobDatasets(jobSpec: JobArgs): string[] {
      if (isConversion(jobSpec)) {
        return [jobSpec.meta.id];
      }
      if (isRunPipeline(jobSpec)) {
        return [jobSpec.datasetId];
      }
      if (isRunTraining(jobSpec)) {
        return jobSpec.datasetIds;
      }
      return [];
    }

    onMounted(() => {
      updateQueuedJobSpecs();
    });

    return {
      queuedJobSpecs,
      datasets,
      getQueuedJobTitle,
      getJobDatasets,
      isRunPipeline,
      isExportTrainedPipeline,
    };
  },
});
</script>

<template>
  <v-container>
    <v-col>
      <v-row>
        <v-col>
          <h1 class="text-h4 mb-4 font-weight-light">
            Queued Jobs ({{ queuedJobSpecs.length }})
          </h1>
          <v-card
            v-for="jobSpec, index in queuedJobSpecs"
            :key="index"
          >
            <v-card-title class="primary--text text--lighten-3 text-decoration-none pt-0">
              <v-icon class="pr-4">
                mdi-timer-sand
              </v-icon>
              {{ getQueuedJobTitle(jobSpec) }}
            </v-card-title>
            <v-card-text>
              <table class="key-value-table">
                <tr v-if="isRunPipeline(jobSpec) || isExportTrainedPipeline(jobSpec)">
                  <td>Pipe</td>
                  <td>{{ jobSpec.pipeline.name }}</td>
                </tr>
                <tr v-if="getJobDatasets(jobSpec).length > 0">
                  <td>Datasets</td>
                  <td>
                    <span
                      v-for="dataset in getJobDatasets(jobSpec)"
                      :key="dataset"
                    >
                      <router-link
                        class="mr-1"
                        :to="{ name: 'viewer', params: { id: dataset } }"
                      >
                        {{ datasets[dataset].name }}
                      </router-link>
                    </span>
                  </td>
                </tr>
              </table>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-col>
  </v-container>
</template>

<style lang="scss" scoped>
@import 'dive-common/components/styles/KeyValueTable.scss';
</style>
