<script lang="ts">
import {
  Job,
  JobType,
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
  removeJobFromQueue,
  // removeJobFromQueue,
} from 'platform/desktop/frontend/store/jobs';
import { datasets } from '../store/dataset';

export default defineComponent({
  setup() {
    const queuedJobSpecs: Ref<Job[]> = ref([]);
    function updateQueuedJobSpecs() {
      queuedJobSpecs.value = [];
      queuedGpuJobs.value.forEach((spec: Job) => queuedJobSpecs.value.push(spec));
      queuedCpuJobs.value.forEach((spec: Job) => queuedJobSpecs.value.push(spec));
    }
    watch([() => queuedCpuJobs, () => queuedGpuJobs], updateQueuedJobSpecs, { deep: true });

    function getQueuedJobTitle(jobSpec: Job): string {
      if (jobSpec.type === JobType.Conversion) {
        return `conversion: ${datasets.value[jobSpec.meta.id]?.name || jobSpec.meta.id}`;
      }
      if (jobSpec.type === JobType.RunPipeline) {
        return `pipeline: ${datasets.value[jobSpec.datasetId]?.name || jobSpec.datasetId}`;
      }
      if (jobSpec.type === JobType.ExportTrainedPipeline) {
        return `export trained pipeline: ${jobSpec.path}`;
      }
      if (jobSpec.type === JobType.RunTraining) {
        const title = `training: ${datasets.value[jobSpec.datasetIds[0]]?.name || jobSpec.datasetIds[0]}`;
        if (jobSpec.datasetIds.length > 1) {
          return `${title} (and ${jobSpec.datasetIds.length - 1} more)`;
        }
        return title;
      }
      return 'queued job';
    }

    function getJobDatasets(jobSpec: Job): string[] {
      if (jobSpec.type === JobType.Conversion) {
        return [jobSpec.meta.id];
      }
      if (jobSpec.type === JobType.RunPipeline) {
        return [jobSpec.datasetId];
      }
      if (jobSpec.type === JobType.RunTraining) {
        return jobSpec.datasetIds;
      }
      return [];
    }

    onMounted(() => {
      updateQueuedJobSpecs();
    });

    return {
      JobType,
      queuedJobSpecs,
      datasets,
      getQueuedJobTitle,
      getJobDatasets,
      removeJobFromQueue,
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
            <v-row>
              <v-col cols="9">
                <v-card-title class="primary--text text--lighten-3 text-decoration-none pt-0">
                  <v-icon class="pr-4">
                    mdi-timer-sand
                  </v-icon>
                  {{ getQueuedJobTitle(jobSpec) }}
                </v-card-title>
                <v-card-text>
                  <table class="key-value-table">
                    <tr v-if="jobSpec.type === JobType.RunPipeline || jobSpec.type === JobType.ExportTrainedPipeline">
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
              </v-col>
              <v-col cols="3">
                <v-btn
                  text
                  small
                  class="mb-2 error--text text--lighten-3 tet-decoration-none"
                  @click="removeJobFromQueue(jobSpec)"
                >
                  <v-icon
                    color="error lighten-3"
                    class="pr-2"
                  >
                    mdi-cancel
                  </v-icon>
                  Cancel Job
                </v-btn>
              </v-col>
            </v-row>
          </v-card>
        </v-col>
      </v-row>
    </v-col>
  </v-container>
</template>

<style lang="scss" scoped>
@import 'dive-common/components/styles/KeyValueTable.scss';
</style>
