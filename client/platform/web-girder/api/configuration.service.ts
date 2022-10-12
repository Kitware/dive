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

export {
  getBrandData,
  putBrandData,
  getPipelineList,
  getTrainingConfigurations,
  getAddons,
  postAddons,
};
