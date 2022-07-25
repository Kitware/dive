<script lang="ts">
import {
  computed,
  defineComponent, onMounted, ref, Ref,
} from '@vue/composition-api';
import {
  cancelJob, deleteJob, getJobTypesStatus, getRecentJobs,
} from 'platform/web-girder/api/admin.service';
import type { GirderJob } from '@girder/components/src';
import JobProgress from '@girder/components/src/components/Job/JobProgress.vue';
import { all, getByValue, Status } from '@girder/components/src/components/Job/status';
import moment from 'moment';
import { isObject } from 'lodash';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';

const JobStatus = all();
const JobStatusMap = {
  Cancelled: JobStatus.CANCELED,
  Error: JobStatus.ERROR,
  Success: JobStatus.SUCCESS,
  Inactive: JobStatus.INACTIVE,
  Running: JobStatus.RUNNING,
  Cancelling: JobStatus.WORKER_CANCELING,
} as Record<string, Status>;

export default defineComponent({
  name: 'AdminJobs',
  components: {
    JobProgress,
  },
  setup() {
    const limit = ref(50);
    const offset = ref(0);
    const { prompt } = usePrompt();
    const table: Ref<(GirderJob & {type: string})[]> = ref([]);
    const jobTypes: Ref<string[]> = ref([]);
    const jobStatusList: Ref<string[]> = ref(['Cancelled', 'Error', 'Inactive', 'Running', 'Cancelling', 'Success']);
    const filterStatus: Ref<string[]> = ref(['Running', 'Error', 'Inactive']);
    const filterTypes: Ref<string[]> = ref([]);
    const headers: Ref<{text: string; value: string}[]> = ref([
      { text: 'Title', value: 'title' },
      { text: 'Type', value: 'type' },
      { text: 'Login', value: 'login' },
      { text: 'User Dir', value: 'userDir' },
      { text: 'Created', value: 'created' },
      { text: 'Updated', value: 'modified' },
      { text: 'Status', value: 'status' },
      { text: 'Info', value: 'params' },
      { text: 'Actions', value: 'actions' },
    ]);
    const initTypes = async () => {
      const typesAndStatus = (await getJobTypesStatus());
      jobTypes.value = typesAndStatus.data.types;
      filterTypes.value = typesAndStatus.data.types;
    };
    // First we need to download the CSV from github
    const getData = async () => {
      const statusNums = filterStatus.value.map(
        (status) => JobStatusMap[status].value,
      ).filter((item) => item !== undefined);
      table.value = (await getRecentJobs(
        limit.value,
        offset.value,
        statusNums,
        filterTypes.value,
      )).data;
    };
    const data = computed(() => table.value.map(
      (item) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let params: Record<string, any> = {};
        if (isObject(item.kwargs)) {
          params = item.kwargs;
        } else if (typeof (item.kwargs) === 'string') {
          const temp = JSON.parse(item.kwargs);
          if (temp.params !== undefined) {
            params = temp.params;
          }
        }
        return {
          title: item?.title || 'Unknown',
          type: item.type,
          login: params?.user_login || 'Unknown',
          userDir: params?.user_id || 'Unknown',
          created: moment(item.created).format('MM/DD/YY @ h:mm a'),
          modified: moment(item.updated).format('MM/DD/YY @ h:mm a'),
          status: item.status,
          params,
          actions: item._id,
        };
      },
    ));
    onMounted(async () => {
      await initTypes();
      await getData();
    });

    const formatStatus = (status: number, updated: string) => {
      const statusDef = getByValue(status);
      return {
        statusText: statusDef.text,
        statusColor: statusDef.color,
        statusTextColor: 'white',
        statusIcon: statusDef.icon,
        updateString: moment(updated).format('dddd, MMMM D, YYYY @ h:mm a'),
        progressNumber: 100,
        indeterminate: statusDef.indeterminate,
        class: statusDef.indeterminate ? ['mdi-spin'] : undefined,
      };
    };
    const getJobStatusColor = (status: string) => JobStatusMap[status]?.color || 'default';
    const removeTypeChip = (item: string) => {
      filterTypes.value.splice(filterTypes.value.indexOf(item), 1);
      filterTypes.value = [...filterTypes.value];
      getData();
    };
    const removeStatusChip = (item: string) => {
      filterStatus.value.splice(filterStatus.value.indexOf(item), 1);
      filterStatus.value = [...filterStatus.value];
      getData();
    };

    const modifyJob = async (state: 'Delete' | 'Cancel', jobId: string, title: string) => {
      const result = await prompt({
        title: `${state} Job`,
        text: ['Do you want to delete thie following job?', title],
        confirm: true,
      });
      if (!result) {
        return;
      }
      if (state === 'Delete') {
        await deleteJob(jobId);
      } else if (state === 'Cancel') {
        await cancelJob(jobId);
      }
      await getData();
    };

    return {
      table,
      headers,
      data,
      getData,
      formatStatus,
      jobTypes,
      jobStatusList,
      filterTypes,
      filterStatus,
      removeTypeChip,
      removeStatusChip,
      getJobStatusColor,
      modifyJob,
    };
  },

});
</script>

<template>
  <v-container>
    <v-card>
      <v-card-title> Recent Jobs </v-card-title><!--  -->
      <v-card-text>
        <v-row>
          <v-combobox
            v-model="filterTypes"
            :items="jobTypes"
            chips
            label="Job Types"
            multiple
            outlined
            @change="getData"
          >
            <template v-slot:selection="{ attrs, item, select, selected }">
              <v-chip
                v-bind="attrs"
                :input-value="selected"
                close
                @click="select"
                @click:close="removeTypeChip(item)"
              >
                <strong>{{ item }}</strong>&nbsp;
              </v-chip>
            </template>
          </v-combobox>
        </v-row>
        <v-row>
          <v-combobox
            v-model="filterStatus"
            :items="jobStatusList"
            chips
            label="Job Statuses"
            multiple
            outlined
            @change="getData"
          >
            <template v-slot:selection="{ attrs, item, select, selected }">
              <v-chip
                v-bind="attrs"
                :input-value="selected"
                :color="getJobStatusColor(item)"
                close
                @click="select"
                @click:close="removeStatusChip(item)"
              >
                <strong>{{ item }}</strong>&nbsp;
              </v-chip>
            </template>
          </v-combobox>
        </v-row>
        <v-data-table
          :headers="headers"
          :items="data"
          item-key="Title"
          :items-per-page="-1"
          hide-default-footer
          class="elevation-1"
        >
          <template v-slot:item.userDir="{ item }">
            <div v-if="item.userDir === 'Unknown'">
              Unknown
            </div>
            <v-tooltip
              v-else
              bottom
            >
              <template #activator="{on, attrs}">
                <v-btn
                  v-bind="attrs"
                  small
                  depressed
                  :to="`/user/${item.userDir}`"
                  color="info"
                  class="ma-1"
                  v-on="on"
                >
                  <v-icon small>
                    mdi-account
                  </v-icon>
                </v-btn>
              </template>
              <span>Launch User Directory</span>
            </v-tooltip>
          </template>
          <template v-slot:item.type="{ item }">
            {{ item.type }}
          </template>
          <template v-slot:item.status="{ item }">
            <JobProgress :formatted-job="formatStatus(item.status)" />
          </template>
          <template v-slot:item.params="{ item }">
            <div v-if="item.type === 'pipelines'">
              <div v-if="item.params.input_folder">
                <v-tooltip
                  bottom
                >
                  <template #activator="{on, attrs}">
                    <v-btn
                      v-bind="attrs"
                      x-small
                      depressed
                      :to="{ name: 'viewer', params: { id: item.params.input_folder } }"
                      color="info"
                      class="ml-0"
                      v-on="on"
                    >
                      <v-icon small>
                        mdi-eye
                      </v-icon>
                    </v-btn>
                  </template>
                  <span>Launch dataset viewer</span>
                </v-tooltip>
              </div>
            </div>
          </template>
          <template v-slot:item.actions="{ item }">
            <v-tooltip bottom>
              <template #activator="{on, attrs}">
                <v-btn
                  v-bind="attrs"
                  x-small
                  depressed
                  :href="`/girder/#job/${item.actions}`"
                  color="info"
                  class="mx-2"
                  v-on="on"
                >
                  <v-icon small>
                    mdi-text-box-outline
                  </v-icon>
                </v-btn>
              </template>
              <span>View job logs and manage job</span>
            </v-tooltip>
            <v-tooltip
              v-if="item.status < 3 "
              bottom
            >
              <template #activator="{on, attrs}">
                <v-btn
                  v-bind="attrs"
                  x-small
                  depressed
                  color="warning"
                  class="my-2 mr-1"
                  v-on="on"
                  @click="modifyJob('Cancel', item.actions, item.title)"
                >
                  <v-icon small>
                    mdi-close-circle-outline
                  </v-icon>
                </v-btn>
              </template>
              <span>Cancel Job</span>
            </v-tooltip>
            <v-tooltip
              bottom
            >
              <template #activator="{on, attrs}">
                <v-btn
                  v-bind="attrs"
                  x-small
                  depressed
                  color="error"
                  class="my-2"
                  v-on="on"
                  @click="modifyJob('Delete', item.actions, item.title)"
                >
                  <v-icon small>
                    mdi-delete
                  </v-icon>
                </v-btn>
              </template>
              <span>Delete Job</span>
            </v-tooltip>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>
