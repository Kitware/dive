import { DatasetMeta, DatasetMetaMutable, DatasetType } from 'dive-common/apispec';

/**
 * Static properties loaded from the girder folder data/metadata
 */
interface GirderMetadataStatic extends DatasetMetaMutable {
  id: string;
  type: Readonly<DatasetType>;
  fps: Readonly<number | string>;
  name: string;
  createdAt: string;
  ffprobe_info?: Record<string, string>;
  annotate: boolean;
}

/**
 * Full metadata including dynamic properties (image list, video url)
 */
type GirderMetadata = GirderMetadataStatic & DatasetMeta;

export {
  GirderMetadataStatic,
  GirderMetadata,
};
