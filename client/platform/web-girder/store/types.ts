import type { GirderModel, GirderModelType } from '@girder/components/src';
import type { BrandData } from 'platform/web-girder/api';
import type { GirderMetadata } from 'platform/web-girder/constants';

/**
 * Location can be either
 *  a proper girder model,
 *  a root virtual model,
 *  or a simplified id/type pair.
 * These types are mutually exclusive.
 */
export type RootlessLocationType = GirderModel | { '_id': string; '_modelType': GirderModelType };
export type LocationType = RootlessLocationType | { type: 'collections' | 'users' | 'root' };
export interface LocationState {
  location: LocationType | null;
}

export interface DatasetState {
  meta: GirderMetadata | null;
}

export interface BrandState {
  brandData: null | BrandData;
}


export interface RootState {
  Location: LocationState;
  Dataset: DatasetState;
  Brand: BrandState;
}
