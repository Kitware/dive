import type { GirderModel, GirderModelType } from '@girder/components';
import type { BrandData } from 'platform/web-girder/api';
import type { GirderMetadata } from 'platform/web-girder/constants';

export interface GirderJob {
  _id: string;
  title: string;
  type?: string;
  status: number;
  progress?: { current?: number; total?: number };
  updated: string;
  kwargs?: string | Record<string, unknown>;
  dataset_id?: string;
  login?: string;
  [key: string]: unknown;
}

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
  selected: GirderModel[];
}

export interface DatasetState {
  meta: GirderMetadata | null;
}

export interface BrandState {
  brandData: BrandData;
}

export interface UserState {
  user: null | {
    admin: boolean;
    email: string;
    firstName: string;
    login: string;
    lastName: string;
    status: string;
  };
}
export interface JobState {
  jobIds: Record<string, number>;
  datasetStatus: Record<string, { status: number; jobId: string }>;
  completeJobsInfo: Record<string, { type: string; title: string; success: boolean }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isGirderModel(value: any): value is GirderModel {
  return value._id && value._modelType;
}
