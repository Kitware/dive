import { GirderModel } from '@girder/components/src';
import { BrandData } from 'platform/web-girder/api/viame.service';
import { GirderMetadata } from 'platform/web-girder/constants';

export interface LocationState {
  location: null | GirderModel;

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
