import type {
  DatasetMeta, DatasetMetaMutable, DatasetType, Pipe,
} from 'dive-common/apispec';
import { Attribute } from 'vue-media-annotator/use/useAttributes';


export const JsonMetaCurrentVersion = 1;
export const SettingsCurrentVersion = 1;

export interface Settings {
  // version a schema version
  version: number;
  // viamePath path to viame install
  viamePath: string;
  // dataPath path to a userspace data directory
  dataPath: string;
}

export interface MultiCam {
  cameras: Record<string, {
    type: 'image-sequence' | 'video';
    originalBasePath: string;
    originalImageFiles: string[];
    originalVideoFile: string;
    transcodedImagesFiles?: string[];
    transcodedVideoFile?: string;
  }>;
  //Calibration file in .npz format used for stereo or other cameras
  calibration?: string;
  // Default Display Key for showing multiCam
  display: string;
}

/**
 * JsonMeta is a SUBSET of DatasetMeta contained within
 * the JsonFileSchema.  The remaining parts of DatasetMeta must
 * be generated at load time.
 */
export interface JsonMeta extends DatasetMetaMutable {
  // version used to manage schema migrations
  version: number;

  // immutable dataset type
  type: DatasetType | 'multi'; // TODO: This needs to be moved into DatasetType once the web version is complete

  // immutable datset identifier
  id: string;

  // this will become mutable in the future.
  fps: number;

  // the original name derived from media path
  name: string;

  // the import time of the dataset
  createdAt: string;

  // absolute base path on disk where dataset was imported from
  originalBasePath: string;

  // video file path
  // relateive to originalBasePath
  originalVideoFile: string;

  // output of web safe transcoding
  // relative to project path
  transcodedVideoFile?: string;

  // ordered image filenames IF this is an image dataset
  // relative to originalBasePath
  originalImageFiles: string[];

  // ordered image filenames of transcoded images
  // relative to project path
  transcodedImageFiles?: string[];

  // If the dataset required transcoding, specify the job
  // key that ran transcoding
  transcodingJobKey?: string;

  //Attributes are not datasetMetaMutable and are stored separate
  attributes?: Record<string, Attribute>;

  // Stereo or multi-camera datasets with uniform type (all images, all video)
  multiCam?: MultiCam;
}

export type DesktopMetadata = DatasetMeta & JsonMeta;

interface NvidiaSmiTextRecord {
  _text: string;
}

export interface NvidiaSmiReply {
  // output condensed output from nvidia smi xml converted to json
  output: {
    nvidia_smi_log: {
      driver_version: NvidiaSmiTextRecord;
      cuda_version: NvidiaSmiTextRecord;
      attached_gpus: NvidiaSmiTextRecord;
    };
  } | null;
  // process exit code
  exitCode: number | null;
  // error message
  error: string;
}

/** TODO promote to apispec */
export interface RunPipeline {
  datasetId: string;
  pipeline: Pipe;
}

/** TODO promote to apispec */
export interface RunTraining {
  // datasets to run training on
  datasetIds: string[];
  // new pipeline name to be created
  pipelineName: string;
  // training configuration file name
  trainingConfig: string;
}

export interface ConversionArgs {
  meta: JsonMeta;
  mediaList: [string, string][];
}

export interface DesktopJob {
  // key unique identifier for this job
  key: string;
  // command that was run
  command: string;
  // jobType identify type of job
  jobType: 'pipeline' | 'training' | 'conversion';
  // title whatever humans should see this job called
  title: string;
  // arguments to creation
  args: RunPipeline | RunTraining | ConversionArgs;
  // datasetIds of the involved datasets
  datasetIds: string[];
  // pid of the process spawned
  pid: number;
  // workingDir of the job's output
  workingDir: string;
  // exitCode if set, the job exited already
  exitCode: number | null;
  // startTime time of process initialization
  startTime: Date;
  // endTime time of process exit
  endTime?: Date;
}

export interface MediaImportPayload {
  jsonMeta: JsonMeta;
  globPattern: string;
  mediaConvertList: string[];
}

export interface DesktopJobUpdate extends DesktopJob {
  // body contents of update payload
  body: string[];
}

export type DesktopJobUpdater = (msg: DesktopJobUpdate) => void;

export interface FFProbeResults {
  streams?: [{
    codec_type?: string;
    codec_name?: string;
    sample_aspect_ratio?: string;
  }];
}

export type ConvertMedia =
(settings: Settings,
  args: ConversionArgs,
  updater: DesktopJobUpdater) => Promise<DesktopJob>;

export interface ExportDatasetArgs {
  id: string;
  exclude: boolean;
  path: string;
}
