import {
  DatasetMeta, DatasetMetaMutable, DatasetType, MultiCamMedia, SubType,
} from 'dive-common/apispec';

/**
 * Static properties loaded from the girder folder data/metadata
 */
interface GirderMetadataStatic extends DatasetMetaMutable {
  /**
   * Required fields
   * Everything copied from DatasetMeta except imageData and videoUrl
   */
  id: Readonly<string>;
  name: Readonly<string>;
  createdAt: Readonly<string>;
  type: Readonly<DatasetType>;
  fps: Readonly<number>;
  annotate: Readonly<boolean>;
  subType: Readonly<SubType>;
  multiCamMedia: Readonly<MultiCamMedia | null>;

  /* optional */
  originalFps?: number;
  ffprobe_info?: Record<string, string>;
  foreign_media_id?: string;
}

/**
 * Full metadata including dynamic properties (image list, video url)
 */
type GirderMetadata = DatasetMeta & GirderMetadataStatic;

const fileSuffixRegex = /\.[^.]*$/;

export {
  fileSuffixRegex,
  GirderMetadataStatic,
  GirderMetadata,
};
