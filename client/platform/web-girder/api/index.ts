/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import girderRest from 'platform/web-girder/plugins/girder';

import { deleteItem } from './girder.service';
import { clearCalibrationFolderMetadata, getDatasetCalibration } from './dataset.service';

export * from './annotation.service';
export * from './configuration.service';
export * from './dataset.service';
export * from './girder.service';
export * from './multicamResolve';
export * from './rpc.service';
export * from './waitForFolderDatasetReady';
export * from './largeImage.service';

/**
 * All API functions should return their raw AxiosResponse,
 * but sometimes, we need a function that returns the response body.
 *
 * takes a function that returns an axios response
 * returns a decorated function that returns the data
 *
 * Usage:
 * const myUnwrapped = unwrap(myAxiosRequestFunction)
 * myUnwrapped(...params)
 */
type ArgsType<T> = T extends (...args: infer U) => Promise<any> ? U : never;
type ReturnType<T> = T extends (...args: any) => Promise<AxiosResponse<infer U>> ? U : never;
export function unwrap<T extends(...args: any) => Promise<AxiosResponse<any>>>(func: T):
  (...args: ArgsType<T>) => Promise<ReturnType<T>> {
  return async (...args: any) => (await func(...args)).data;
}

export function getUri(config: AxiosRequestConfig) {
  return girderRest.apiRoot.replace(/\/*$/i, '/') + girderRest.getUri(config).replace(/^\/*/, '');
}

/** Trigger a browser download of the dataset's source calibration file. */
export async function downloadCalibration(datasetId: string): Promise<void> {
  const { data } = await getDatasetCalibration(datasetId);
  if (!data?.itemId) {
    throw new Error('No calibration file is available to download.');
  }
  window.location.assign(getUri({ url: `item/${data.itemId}/download` }));
}

/** Delete the Girder items holding the dataset's calibration files. */
export async function deleteCalibration(datasetId: string): Promise<void> {
  const { data } = await getDatasetCalibration(datasetId);
  const itemIds = new Set<string>();
  if (data?.itemId) {
    itemIds.add(data.itemId);
  }
  if (data?.jsonItemId) {
    itemIds.add(data.jsonItemId);
  }
  await Promise.all([...itemIds].map((itemId) => deleteItem(itemId)));
  await clearCalibrationFolderMetadata(datasetId);
}
