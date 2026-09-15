import { Pipelines, TrainingConfigs } from 'dive-common/apispec';
import girderRest from 'platform/web-girder/plugins/girder';

export interface BrandData {
  vuetify?: unknown;
  favicon?: string;
  logo?: string;
  name?: string;
  loginMessage?: string;
  alertMessage?: string;
  trainingMessage?: string;
}

/** The served Fast-FoundationStereo export, as `dive_configuration/stereo_foundation_model/spec` reports it. */
export interface StereoFoundationModelSpec {
  name: string;
  url: string;
  md5: string;
  /** Input size from a sidecar yaml; null for a bare .onnx (read from the graph instead). */
  height: number | null;
  width: number | null;
  size: number;
}

export interface StatsResponse {
  table_stats: {
    datasets: number; // Total count of datasets
    jobs: {
      [jobType: string]: number; // Count of jobs by type
    };
    newUsers: number; // Total count of new users
  };
  groupByUser?: {
    datasets: {
      [username: string]: number; // Datasets per user
    };
    jobs: {
      [username: string]: number; // Jobs per user
    };
  };
  groupByMonth?: {
    datasets: {
      [yearMonth: string]: number; // Datasets by year-month
    };
    newUsers: {
      [yearMonth: string]: number; // New users by year-month
    };
    jobs: {
      [yearMonth: string]: number; // Total jobs by year-month
    };
  };
}

export type DateRange = '60 days' | '3 months' | '6 months' | '1 year' | '3 years' | '5 years' | undefined;

export type GroupBy = 'user' | 'month' | undefined;

export type AddOns = [string, string, string, boolean][];

export interface DiveConfiguration {
  distributedWorker?: string;
  pipelinesEnabled?: boolean;
  trainingEnabled?: boolean;
  jobsDisabled?: boolean;
  jobsDisabledMessage?: string;
}

export interface JobsDisabledConfig {
  disabled: boolean;
  message: string;
}

export const DEFAULT_JOBS_DISABLED_MESSAGE = 'Updates will be happening soon, we are disabling jobs until after the updates';

function getConfig() {
  return girderRest.get<DiveConfiguration>('dive_configuration');
}

function getBrandData() {
  return girderRest.get<BrandData>('dive_configuration/brand_data');
}

function putBrandData(brandData: BrandData) {
  return girderRest.put('dive_configuration/brand_data', brandData);
}

function putJobsDisabled(config: JobsDisabledConfig) {
  return girderRest.put<JobsDisabledConfig>('dive_configuration/jobs_disabled', config);
}

function getPipelineList() {
  return girderRest.get<Pipelines>('dive_configuration/pipelines');
}

function getTrainingConfigurations() {
  return girderRest.get<TrainingConfigs>('dive_configuration/training_configs');
}

function getAddons() {
  return girderRest.get<AddOns>('dive_configuration/addons');
}

function getStereoFoundationModelSpec() {
  return girderRest.get<StereoFoundationModelSpec>('dive_configuration/stereo_foundation_model/spec');
}

function getStereoFoundationModel() {
  return girderRest.get<ArrayBuffer>('dive_configuration/stereo_foundation_model', {
    responseType: 'arraybuffer',
  });
}

function postAddons(urls: string[], forceDownload: boolean) {
  return girderRest.post(`dive_configuration/upgrade_pipelines?force=${forceDownload}`, urls);
}

function updateContainers() {
  return girderRest.post('dive_configuration/update_containers');
}

function getStats(dateRange?: DateRange, overrideDateTime?: string, groupBy?: GroupBy, limit?: number) {
  return girderRest.get<StatsResponse>('dive_configuration/stats', {
    params: {
      dateRange,
      overrideDateTime,
      groupBy,
      limit,
    },
  });
}

export {
  getBrandData,
  getConfig,
  putBrandData,
  putJobsDisabled,
  getPipelineList,
  getTrainingConfigurations,
  getAddons,
  getStereoFoundationModelSpec,
  getStereoFoundationModel,
  postAddons,
  updateContainers,
  getStats,
};
