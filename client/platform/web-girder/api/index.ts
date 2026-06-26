/* eslint-disable @typescript-eslint/no-explicit-any */
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import girderRest from 'platform/web-girder/plugins/girder';

import { getDatasetCalibration } from './dataset.service';
import { deleteItem } from './girder.service';

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

/** Trigger a browser download of the dataset's current calibration file. */
export async function downloadCalibration(datasetId: string): Promise<void> {
  const { data } = await getDatasetCalibration(datasetId);
  if (data?.itemId) {
    window.location.assign(getUri({ url: `file/${data.itemId}/download` }));
  }
}

/** Delete the Girder item holding the dataset's calibration file. */
export async function deleteCalibration(datasetId: string): Promise<void> {
  const { data } = await getDatasetCalibration(datasetId);
  if (data?.itemId) {
    await deleteItem(data.itemId);
  }
}
