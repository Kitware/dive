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

function getBrandData() {
  return girderRest.get<BrandData>('dive_configuration/brand_data');
}

function putBrandData(brandData: BrandData) {
  return girderRest.put('dive_configuration/brand_data', brandData);
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
  putBrandData,
  getPipelineList,
  getTrainingConfigurations,
  getAddons,
  postAddons,
  updateContainers,
  getStats,
};
