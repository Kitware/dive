import { DatasetMeta } from 'viame-web-common/apispec';

export const websafeVideoTypes = [
  'video/mp4',
  'video/webm',
];

export const websafeImageTypes = [
  'image/apng',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
];

export const SettingsCurrentVersion = 1;
export interface Settings {
  // version a schema version
  version: number;
  // viamePath path to viame install
  viamePath: string;
  // dataPath path to a userspace data directory
  dataPath: string;
}

export interface DesktopDataset {
  // name filename (for video) or folder name (for images)
  name: string;
  // basePath path of dataset working directory
  basePath: string;
  // vidoPath path of single video file
  videoPath?: string;
  // meta DatasetMeta
  meta: DatasetMeta;
}

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
  exitCode: number;
  // error message
  error: string;
}

export interface DesktopJob {
  // key unique identifier for this job
  key: string;
  // jobType identify type of job
  jobType: 'pipeline' | 'training';
  // pipelineName of the pipe or job being run
  pipelineName: string;
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

export interface DesktopJobUpdate extends DesktopJob {
  // body contents of update payload
  body: string[];
}

export interface RunPipeline {
  datasetId: string;
  pipelineName: string;
  settings: Settings;
}
