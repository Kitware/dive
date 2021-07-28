import type { GirderModel, GirderModelType } from '@girder/components/src';
import { inject } from '@vue/composition-api';
import type { BrandData } from 'platform/web-girder/api/viame.service';
import type { GirderMetadata } from 'platform/web-girder/constants';
import { Store } from 'vuex';

export interface LocationState {
  location: null | GirderModel | { type: GirderModelType };
  // location: null | {
  //   _id?: string;
  //   _modelType?: string;
  //   type?: GirderModelType;
  //   meta?: Record<string, unknown>;
  // };
  selected: GirderModel[];
}

export interface LocationGetters {
  locationIsViameFolder: boolean;
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

// https://blog.e-mundo.de/post/vuex-with-typescript-tricks-to-improve-your-developer-experience/
export type GettersDefinition<T, S> = {
  [P in keyof T]: (state: S, getters: T) => T[P];
};

export function useStore(): Store<RootState> {
  const store: Store<RootState> | undefined = inject('store');
  if (store === undefined) {
    throw new Error('Store was undefined');
  }
  return store;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isGirderModel(value: any): value is GirderModel {
  return value._id && value._modelType;
}
