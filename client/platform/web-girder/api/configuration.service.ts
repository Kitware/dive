import { Pipelines, TrainingConfigs } from 'dive-common/apispec';
import girderRest from 'platform/web-girder/plugins/girder';

export interface BrandData {
  vuetify?: unknown;
  favicon?: string;
  logo?: string;
  name?: string;
  loginMessage?: string;
  alertMessage?: string;
}

function getBrandData() {
  return girderRest.get<BrandData>('dive_configuration/brand_data');
}

function getPipelineList() {
  return girderRest.get<Pipelines>('dive_configuration/pipelines');
}

function getTrainingConfigurations() {
  return girderRest.get<TrainingConfigs>('dive_configuration/training_configs');
}

export {
  getBrandData,
  getPipelineList,
  getTrainingConfigurations,
};
