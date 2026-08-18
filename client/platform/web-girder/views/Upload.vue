<script lang='ts'>
import {
  defineComponent, Ref, ref, computed, onBeforeUnmount,
} from 'vue';
import { useRouter } from 'vue-router/composables';

import {
  ImageSequenceType, VideoType, DefaultVideoFPS, FPSOptions, LargeImageType,
  inputAnnotationFileTypes, websafeVideoTypes, otherVideoTypes,
  getImageSequenceFileAccept, getLargeImageFileAccept,
  metadataFileTypes,
} from 'dive-common/constants';
import suggestUploadSlots from 'platform/web-girder/uploadSlots';

import {
  fileSuffixRegex,
} from 'platform/web-girder/constants';

import ImportButton from 'dive-common/components/ImportButton.vue';
import ImportMultiCamDialog from 'dive-common/components/ImportMultiCamDialog.vue';
import ImportMultiCamBatchDialog from 'dive-common/components/ImportMultiCamBatchDialog.vue';
import { MultiCamBatchCollect } from 'dive-common/multiCamBatchScan';
import {
  DatasetType, MediaImportResponse, MultiCamImportArgs, MultiCamImportFolderArgs,
} from 'dive-common/apispec';
import {
  createGirderFolder,
  createMulticamDataset,
  deleteResources,
  saveConfig,
  uploadCalibrationItem,
  uploadAndSetMetadataFile,
  uploadMetadataFileItem,
  validateUploadGroup,
  waitForFolderDatasetReady,
} from 'platform/web-girder/api';
import type {
  IgnoredUploadFile,
  ValidationResponse,
} from 'platform/web-girder/api';
import {
  clearMulticamFileRegistry,
  getCalibrationFile,
  getMetadataFile,
  getCameraPackageFiles,
  getFilesForSourceKey,
  getTransformFile,
  mediaFileNamesForImport,
  removeCameraFolderFiles,
  renameCameraFolderFiles,
  stashCameraFolderFiles,
  stashTransformFile,
} from 'platform/web-girder/multicamFileRegistry';
import { parseRegistrationSeed } from 'platform/web-girder/multicamRegistrationSeed';
import {
  isAllowedStereoCalibrationFilename,
  stereoCalibrationAllowedExtensionsLabel,
} from 'platform/web-girder/multicamCalibration';
import { filterByGlob } from 'platform/desktop/sharedUtils';
import { openFromDisk } from 'platform/web-girder/utils';
import { filesForCameraSource, scanMultiCamBatchFromFiles } from 'platform/web-girder/scanMultiCamBatch';
import eventBus from 'platform/web-girder/eventBus';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { getResponseError } from 'vue-media-annotator/utils';
import { clientSettings } from 'dive-common/store/settings';
import UploadGirder from './UploadGirder.vue';

export interface InteralFiles {
  file: File;
  status: string | 'done' | 'pending' | 'error';
  progress: {
    indeterminate: boolean;
    current: number;
    size: number;
  };
  upload: null; //Mixin function
  result: null; //Mixin stuff
}

export interface PendingUpload {
  createSubFolders: boolean;
  name: string;
  files: InteralFiles[];
  /**
   * Per-role upload slots. The user declares each file's role by which slot it goes in.
   * Media/annotation/config placement is a suggestion the server re-validates at upload;
   * the metadata attachment is uploaded separately from annotation classification.
   */
  mediaList: File[];
  annotationFile: File | null;
  /** Optional DIVE Configuration File (JSON attributes, styles, FPS, …). */
  configFile: File | null;
  /** Optional dataset-level attachment used by pipelines and, for TXT/CSV, frame metadata. */
  metadataFile: File | null;
  /** Media/annotation/config package the server validated for upload (rebuilt at start). */
  uploadFiles: File[];
  /** Picked files that have no slot on this row, each with the reason it is not uploaded. */
  unslotted: IgnoredUploadFile[];
  ignored: IgnoredUploadFile[];
  /** Blocking validation message for this row; the slots stay editable until it clears. */
  error: string | null;
  type: DatasetType | 'zip';
  fps: number;
  uploading: boolean;
  skipTranscoding?: boolean;
}

interface GirderUpload {
  formatSize: (a: number) => string;
  totalProgress: number;
  totalProgressPercent: number;
  totalSize: number;
  uploadCameraDataset: (args: {
    name: string;
    fps: number;
    type: DatasetType;
    uploadFiles: File[];
    skipTranscoding?: boolean;
    parentFolderId?: string;
  }) => Promise<{ folder: { _id: string }; jobIds: string[] }>;
}

function isMultiCamFolderArgs(args: MultiCamImportArgs): args is MultiCamImportFolderArgs {
  return 'sourceList' in args;
}

const MULTICAM_PROGRESS_START = 2;
const MULTICAM_PROGRESS_END = 98;
/** Share of each camera's progress bar allocated to Girder file upload vs server processing. */
const MULTICAM_CAMERA_UPLOAD_WEIGHT = 0.72;

interface MulticamImportProgress {
  percent: number;
  message: string;
}

function multicamCameraSlotPercent(
  cameraIndex: number,
  totalCameras: number,
  subFraction: number,
): number {
  const span = (MULTICAM_PROGRESS_END - MULTICAM_PROGRESS_START) / totalCameras;
  return MULTICAM_PROGRESS_START + (cameraIndex * span) + (subFraction * span);
}

const MULTI_VIDEO_METADATA_REASON = 'Frame metadata is not supported when multiple videos are uploaded';

/**
 * The server names every file it did not accept, so what to upload is the validated
 * selection minus those names.
 */
function acceptedUploadFiles(files: File[], validation: ValidationResponse): File[] {
  const ignoredNames = new Set(validation.roles.ignored);
  return files.filter((file) => !ignoredNames.has(file.name));
}

/** The server's ignored role, each name paired with the reason it reported for it. */
function validationIgnoredFiles(validation: ValidationResponse): IgnoredUploadFile[] {
  return validation.roles.ignored.map((name) => ({
    name,
    reason: validation.reasons[name] ?? 'Not accepted for upload',
  }));
}

/** Only a multi-video upload fans out into per-video subfolders. */
function fansOutToSubFolders(validation: ValidationResponse): boolean {
  return validation.type === VideoType && validation.roles.media.length > 1;
}

/**
 * The folder name a row starts with: the single media file's name, or — when the row holds
 * several media files — the first one with its suffix stripped. Derived from the server's
 * media role, so a row that was rejected on pick still gets a name once it validates.
 */
function defaultRowName(validation: ValidationResponse, folderHint?: string): string {
  if (folderHint) {
    return folderHint;
  }
  const [firstMedia = ''] = validation.roles.media;
  return validation.roles.media.length > 1
    ? firstMedia.replace(fileSuffixRegex, '')
    : firstMedia;
}

/**
 * Every picked file this row will not upload, with the reason: what the server ignored, what
 * had no slot, and — for a fan-out row — the metadata attachment, which cannot be frame-keyed
 * against several videos at once.
 */
function rowIgnoredFiles(
  row: Pick<PendingUpload, 'unslotted' | 'createSubFolders' | 'metadataFile'>,
  validation: ValidationResponse,
): IgnoredUploadFile[] {
  return [
    ...validationIgnoredFiles(validation),
    ...row.unslotted,
    ...(row.createSubFolders && row.metadataFile
      ? [{ name: row.metadataFile.name, reason: MULTI_VIDEO_METADATA_REASON }]
      : []),
  ];
}

export default defineComponent({
  components: {
    ImportButton,
    ImportMultiCamDialog,
    ImportMultiCamBatchDialog,
    UploadGirder,
  },
  props: {
    location: {
      type: Object,
      required: true,
    },
  },
  setup(props, { emit }) {
    const preUploadErrorMessage: Ref<string | null> = ref(null);
    const pendingUploads: Ref<PendingUpload[]> = ref([]);
    /** True from the moment Start upload is clicked until its upload settles. */
    const preparing = ref(false);
    const stereo = ref(false);
    const multiCamOpenType = ref<'image-sequence' | 'video'>('image-sequence');
    const importMultiCamDialog = ref(false);
    const importMultiCamBatchDialog = ref(false);
    const batchImportFiles: Ref<File[]> = ref([]);
    const multicamImporting = ref(false);
    const multicamImportProgress = ref<MulticamImportProgress | null>(null);
    const girderUpload: Ref<null | GirderUpload> = ref(null);
    let multicamUploadProgressTimer: ReturnType<typeof setInterval> | null = null;

    const clearMulticamUploadProgressTimer = () => {
      if (multicamUploadProgressTimer !== null) {
        clearInterval(multicamUploadProgressTimer);
        multicamUploadProgressTimer = null;
      }
    };

    const setMulticamImportProgress = (percent: number, message: string) => {
      multicamImportProgress.value = {
        percent: Math.max(0, Math.min(100, Math.round(percent))),
        message,
      };
    };

    const trackMulticamCameraUploadProgress = (
      cameraIndex: number,
      totalCameras: number,
      cameraName: string,
    ) => {
      clearMulticamUploadProgressTimer();
      multicamUploadProgressTimer = setInterval(() => {
        const uploadPct = girderUpload.value?.totalProgressPercent ?? 0;
        setMulticamImportProgress(
          multicamCameraSlotPercent(
            cameraIndex,
            totalCameras,
            (uploadPct / 100) * MULTICAM_CAMERA_UPLOAD_WEIGHT,
          ),
          `Uploading ${cameraName} (${cameraIndex + 1} of ${totalCameras})`,
        );
      }, 250);
    };

    onBeforeUnmount(clearMulticamUploadProgressTimer);
    const { prompt } = usePrompt();
    const router = useRouter();

    const addPendingZipUpload = (name: string, allFiles: File[]) => {
      const fps = clientSettings.annotationFPS || DefaultVideoFPS;
      const defaultFilename = allFiles.length ? allFiles[0].name.replace(/\..*/, '') : 'Zip Upload';
      pendingUploads.value.push({
        createSubFolders: false,
        name: defaultFilename,
        files: [], //Will be set in the GirderUpload Component
        mediaList: allFiles,
        annotationFile: null,
        configFile: null,
        metadataFile: null,
        uploadFiles: allFiles,
        unslotted: [],
        ignored: [],
        error: null,
        type: 'zip',
        fps,
        uploading: false,
      });
    };

    // Accept filters per slot, mirroring the file dialog's own filters.
    // 'config' is the DIVE JSON configuration file; 'metadata' is the optional
    // pipeline sidecar — keep these names distinct from each other.
    const filterFileUpload = (type: DatasetType | 'config' | 'annotation' | 'metadata') => {
      if (type === 'config') {
        return '.json';
      }
      if (type === 'annotation') {
        return inputAnnotationFileTypes.map((item) => `.${item}`).join(',');
      }
      if (type === 'metadata') {
        return metadataFileTypes.map((item) => `.${item}`).join(',');
      }
      if (type === 'video') {
        return websafeVideoTypes.concat(otherVideoTypes).join(',');
      }
      if (type === 'large-image') {
        return getLargeImageFileAccept();
      }
      return getImageSequenceFileAccept();
    };

    /**
     * Until a row validates, its type is only the import menu the user opened, which the
     * server may yet contradict (an image-sequence pick of TIFFs validates as large-image).
     * An error row is therefore left unfiltered: filtering by the guess would hide the very
     * files the user has to re-pick to clear the error.
     */
    const mediaSlotAccept = (pendingUpload: PendingUpload) => (
      pendingUpload.error || pendingUpload.type === 'zip'
        ? undefined
        : filterFileUpload(pendingUpload.type)
    );

    // Every slot file the server validates, in a single list.
    const slotFileList = (pendingUpload: PendingUpload): File[] => [
      ...pendingUpload.mediaList,
      ...(pendingUpload.annotationFile ? [pendingUpload.annotationFile] : []),
      ...(pendingUpload.configFile ? [pendingUpload.configFile] : []),
    ];

    const addPendingUpload = async (
      allFiles: File[],
      suggestedFps?: number, // suggested FPS for large/images
      expectedType?: DatasetType,
      folderHint?: string,
    ) => {
      const slots = suggestUploadSlots(allFiles);
      // Validate the media/annotation/config selection so the media type is server-determined.
      const row: PendingUpload = {
        createSubFolders: false,
        name: '',
        files: [], //Will be set in the GirderUpload Component
        mediaList: slots.mediaList,
        annotationFile: slots.annotationFile,
        configFile: slots.configFile,
        metadataFile: slots.metadataFile,
        uploadFiles: [],
        unslotted: slots.unslotted,
        ignored: [...slots.unslotted],
        error: null,
        type: expectedType ?? ImageSequenceType,
        fps: suggestedFps || clientSettings.annotationFPS || DefaultVideoFPS,
        uploading: false,
        skipTranscoding: true,
      };
      const slotFiles = slotFileList(row);
      const validation = (await validateUploadGroup(slotFiles.map((f) => f.name))).data;
      // A rejected selection still gets a row: its slot editor is the only place the user
      // can correct the problem without reopening the OS file picker.
      if (!validation.ok) {
        row.error = validation.message || 'Upload validation failed';
        pendingUploads.value.push(row);
        return;
      }
      // Server validation is authoritative for the media/annotation/config roles.
      row.createSubFolders = fansOutToSubFolders(validation);
      row.name = defaultRowName(validation, folderHint);
      row.uploadFiles = acceptedUploadFiles(slotFiles, validation);
      row.ignored = rowIgnoredFiles(row, validation);
      row.type = expectedType === LargeImageType ? LargeImageType : validation.type;
      pendingUploads.value.push(row);
    };
    /**
     * Initial opening of file dialog. The complete selection is sent to server
     * validation, which is what classifies the files.
     */
    const openImport = async (dstype: DatasetType | 'zip') => {
      // Multi-file picker (not directory): web uploads an explicit selection. Multi-dot frame
      // names are kept selectable via getImageSequenceFileAccept() in openFromDisk.
      const ret = await openFromDisk(dstype);
      if (ret.canceled || !ret.fileList || ret.fileList.length === 0) {
        return;
      }
      preUploadErrorMessage.value = null;
      try {
        if (dstype === 'zip') {
          const name = ret.fileList.length === 1 ? ret.fileList[0].name : '';
          addPendingZipUpload(name, ret.fileList);
        } else {
          const suggestedFps = dstype === 'image-sequence' || dstype === 'large-image' ? 1 : undefined;
          await addPendingUpload(ret.fileList, suggestedFps, dstype);
        }
      } catch (err) {
        preUploadErrorMessage.value = getResponseError(err);
      }
    };
    const openMultiCamDialog = (args: { stereo: boolean; openType: 'image-sequence' | 'video' }) => {
      stereo.value = args.stereo;
      multiCamOpenType.value = args.openType;
      importMultiCamDialog.value = true;
    };
    const multiCamImportCheck = async (sourcePath: string): Promise<MediaImportResponse> => {
      const files = getFilesForSourceKey(sourcePath) ?? [];
      const mediaType = multiCamOpenType.value === VideoType ? VideoType : ImageSequenceType;
      return {
        jsonConfig: {
          originalImageFiles: mediaFileNamesForImport(files, mediaType),
        },
        globPattern: '',
        mediaConvertList: [],
      };
    };

    const registerSubfolderCameras = (assignments: {
      cameraName: string;
      sourcePath: string;
      files: File[];
    }[]) => {
      assignments.forEach(({ sourcePath, files }) => {
        stashCameraFolderFiles(sourcePath, files);
      });
    };
    const unregisterSubfolderCamera = (sourcePath: string) => {
      removeCameraFolderFiles(sourcePath);
    };
    const renameSubfolderCamera = (oldSourcePath: string, newSourcePath: string) => {
      renameCameraFolderFiles(oldSourcePath, newSourcePath);
    };

    interface MultiCamFolderImportOptions {
      openViewer?: boolean;
      closeUpload?: boolean;
      showProgressOverlay?: boolean;
      progressLabel?: string;
      /** Prompt registration warnings inline; batch collects surface them per row instead. */
      promptRegistrationWarnings?: boolean;
    }

    const runMultiCamFolderImport = async (
      args: MultiCamImportFolderArgs,
      options: MultiCamFolderImportOptions = {},
    ): Promise<{ id: string; registrationWarnings: string[] }> => {
      const {
        openViewer = true,
        closeUpload = true,
        showProgressOverlay = true,
        progressLabel = '',
        promptRegistrationWarnings = true,
      } = options;
      const labelPrefix = progressLabel ? `${progressLabel} — ` : '';
      if (!props.location?._id || props.location._modelType !== 'folder') {
        throw new Error('Select a folder to upload into before importing multicam data.');
      }
      const uploadComponent = girderUpload.value;
      if (!uploadComponent?.uploadCameraDataset) {
        throw new Error('Upload is not ready. Close and reopen the upload dialog.');
      }

      if (showProgressOverlay) {
        multicamImporting.value = true;
        multicamImportProgress.value = { percent: 0, message: `${labelPrefix}Preparing import…` };
      }
      preUploadErrorMessage.value = null;
      let datasetFolderId: string | null = null;
      let multicamLinked = false;
      try {
        const datasetName = args.datasetName?.trim();
        if (!datasetName) {
          throw new Error('Dataset name is required');
        }
        // Parse attached transform/registration files up front so a bad file
        // fails the import before anything is created (desktop parity).
        const transformEntries = Object.entries(args.sourceList)
          .filter(([, source]) => source.transformFile)
          .map(([cameraName, source]) => ({
            cameraName,
            fileName: source.transformFile as string,
            file: getTransformFile(source.transformFile as string),
          }));
        const registrationSeed = transformEntries.length
          ? await parseRegistrationSeed(transformEntries, Object.keys(args.sourceList))
          : null;
        // annotationFPS of -1 ("Video FPS") is truthy in JS; for image /
        // large-image multicam resolve it to 1 so create_multicam matches
        // child folders after post-process (which also maps -1 → 1).
        const annotationFps = clientSettings.annotationFPS;
        let fps = DefaultVideoFPS;
        if (args.type !== VideoType) {
          fps = annotationFps > 0 ? annotationFps : 1;
        }
        setMulticamImportProgress(MULTICAM_PROGRESS_START, `${labelPrefix}Creating dataset folder…`);
        const { data: datasetFolder } = await createGirderFolder({
          folderId: props.location._id,
          name: datasetName,
          description: 'Multi Camera dataset',
        });
        datasetFolderId = datasetFolder._id;
        const cameras: Record<string, { folderId: string; type?: Exclude<DatasetType, 'multi'> }> = {};
        const cameraOrder = args.cameraOrder?.length
          ? args.cameraOrder
          : Object.keys(args.sourceList);
        const cameraEntries = cameraOrder
          .filter((name) => args.sourceList[name])
          .map((name) => [name, args.sourceList[name]] as const);
        const totalCameras = cameraEntries.length;
        // Collect files the server accepted-but-ignored per camera so they can be
        // surfaced before navigation — no selected file is silently dropped.
        const ignoredAcrossCameras: { camera: string; name: string; reason: string }[] = [];

        for (let i = 0; i < cameraEntries.length; i += 1) {
          const [cameraName, source] = cameraEntries[i];
          let folderFiles = getFilesForSourceKey(source.sourcePath) ?? [];
          if (source.glob) {
            // Cameras sharing one folder (per-modality suffixes) upload only their glob's files
            folderFiles = folderFiles.filter((file) => filterByGlob(source.glob as string, [file.name]).length === 1);
          }
          if (!folderFiles.length) {
            throw new Error(`No media files found for camera "${cameraName}"`);
          }
          const cameraMetadataFile = source.metadataFile
            ? getMetadataFile(source.metadataFile)
            : undefined;
          if (source.metadataFile && !cameraMetadataFile) {
            throw new Error(
              `Metadata file for camera "${cameraName}" was not found. Choose it again.`,
            );
          }
          // Flatten before validation so the names the server validates match the
          // names uploaded to Girder.
          const { files: cameraFiles, replaced } = getCameraPackageFiles(
            folderFiles,
            source.trackFile,
            source.metadataFile,
          );
          // eslint-disable-next-line no-await-in-loop -- validate then upload each camera sequentially
          const validation = (await validateUploadGroup(cameraFiles.map((f) => f.name))).data;
          if (!validation.ok) {
            throw new Error(validation.message || `Invalid files for camera "${cameraName}"`);
          }
          if (cameraMetadataFile && validation.roles.frameMetadata.length) {
            throw new Error(
              `Camera "${cameraName}" has more than one metadata file. Choose one file and try again.`,
            );
          }
          const cameraType = source.type ?? args.type;
          const uploadType = validation.type;
          const compatibleTypes = new Set<DatasetType>([cameraType, args.type, 'large-image', 'image-sequence']);
          if (uploadType === 'multi' || !compatibleTypes.has(uploadType)) {
            throw new Error(`Camera "${cameraName}" must use ${cameraType} media`);
          }
          // Server validation is the authority: upload exactly what it accepted,
          // which includes validated camera-folder sidecars and annotation/config
          // files, not just validation.roles.media.
          const uploadFiles = acceptedUploadFiles(cameraFiles, validation);
          validationIgnoredFiles(validation).forEach((entry) => ignoredAcrossCameras.push({
            camera: cameraName, name: entry.name, reason: entry.reason,
          }));
          replaced.forEach((entry) => ignoredAcrossCameras.push({
            camera: cameraName,
            name: entry.name,
            reason: 'a different file you chose for this camera has the same name',
          }));
          trackMulticamCameraUploadProgress(i, totalCameras, cameraName);
          // eslint-disable-next-line no-await-in-loop
          const { folder, jobIds } = await uploadComponent.uploadCameraDataset({
            name: cameraName,
            fps,
            type: uploadType,
            uploadFiles,
            skipTranscoding: true,
            parentFolderId: datasetFolder._id,
          });
          clearMulticamUploadProgressTimer();
          setMulticamImportProgress(
            multicamCameraSlotPercent(i, totalCameras, MULTICAM_CAMERA_UPLOAD_WEIGHT),
            `${labelPrefix}Processing ${cameraName} (${i + 1} of ${totalCameras})`,
          );
          // eslint-disable-next-line no-await-in-loop -- finalize only after post-process marks folder as a dataset
          await waitForFolderDatasetReady(folder._id, {
            onProgress: (fraction) => {
              const processShare = 1 - MULTICAM_CAMERA_UPLOAD_WEIGHT;
              setMulticamImportProgress(
                multicamCameraSlotPercent(
                  i,
                  totalCameras,
                  MULTICAM_CAMERA_UPLOAD_WEIGHT + fraction * processShare,
                ),
                `${labelPrefix}Processing ${cameraName} (${i + 1} of ${totalCameras})`,
              );
            },
            requireViewableImages: uploadType === ImageSequenceType,
            requireLargeImageItems: uploadType === LargeImageType,
          }, jobIds);
          if (cameraMetadataFile) {
            // eslint-disable-next-line no-await-in-loop
            await uploadAndSetMetadataFile(folder._id, cameraMetadataFile);
          }
          setMulticamImportProgress(
            multicamCameraSlotPercent(i + 1, totalCameras, 0),
            totalCameras > 1 && i + 1 < totalCameras
              ? `${labelPrefix}Finished ${cameraName}, starting next camera…`
              : `${labelPrefix}Finished ${cameraName}`,
          );
          cameras[cameraName] = { folderId: folder._id, type: uploadType };
        }

        setMulticamImportProgress(92, `${labelPrefix}Finalizing multicam dataset…`);
        let calibrationFileId: string | undefined;
        if (args.calibrationFile) {
          setMulticamImportProgress(94, `${labelPrefix}Uploading calibration…`);
          const calFile = getCalibrationFile(args.calibrationFile);
          if (!calFile) {
            throw new Error(
              'Calibration file was not found. Use "Choose calibration" in the import dialog to select the file again.',
            );
          }
          if (stereo.value && !isAllowedStereoCalibrationFilename(calFile.name)) {
            throw new Error(
              `Stereo calibration must be ${stereoCalibrationAllowedExtensionsLabel()}.`,
            );
          }
          calibrationFileId = await uploadCalibrationItem(datasetFolder._id, calFile);
        }

        let metadataFileId: string | undefined;
        if (args.metadataFile) {
          setMulticamImportProgress(95, `${labelPrefix}Uploading metadata file…`);
          const metadataFile = getMetadataFile(args.metadataFile);
          if (!metadataFile) {
            throw new Error(
              'Metadata file was not found. Use "Choose metadata" in the import dialog to select the file again.',
            );
          }
          metadataFileId = await uploadMetadataFileItem(datasetFolder._id, metadataFile);
        }

        const subType = stereo.value ? 'stereo' : 'multicam';
        setMulticamImportProgress(97, `${labelPrefix}Linking cameras…`);
        const { data: parentFolder } = await createMulticamDataset({
          parentFolderId: datasetFolder._id,
          name: datasetName,
          fps,
          type: args.type,
          subType,
          defaultDisplay: args.defaultDisplay,
          cameras,
          cameraOrder,
          calibrationFileId,
          metadataFileId,
        });
        multicamLinked = true;

        if (parentFolder.importWarnings?.length) {
          await prompt({
            title: 'Import Warnings',
            text: parentFolder.importWarnings,
            positiveButton: 'OK',
          });
        }

        if (registrationSeed?.values) {
          // Seed the dataset's saved camera registration (the same
          // registration the in-app panel edits and the Align button
          // applies); the camera* fields are allowlisted in the meta PATCH.
          setMulticamImportProgress(98, `${labelPrefix}Saving camera registration…`);
          await saveConfig(parentFolder._id, {
            cameraHomographies: registrationSeed.values.homographies,
            cameraCorrespondences: registrationSeed.values.correspondences,
            cameraTransformTypes: registrationSeed.values.transformTypes,
            ...(registrationSeed.values.source
              ? { cameraRegistrationSource: registrationSeed.values.source }
              : {}),
          });
        }
        if (promptRegistrationWarnings && registrationSeed?.warnings.length) {
          await prompt({
            title: 'Registration Warnings',
            text: registrationSeed.warnings,
            positiveButton: 'OK',
          });
        }

        if (ignoredAcrossCameras.length) {
          await prompt({
            title: 'Some files were not uploaded',
            text: [
              'These selected files were not needed for the dataset and were left out:',
              ...ignoredAcrossCameras.map(
                (entry) => `${entry.camera}: ${entry.name} — ${entry.reason}`,
              ),
            ],
            positiveButton: 'OK',
          });
        }

        if (openViewer) {
          setMulticamImportProgress(100, `${labelPrefix}Opening viewer…`);
          clearMulticamFileRegistry();
          await router.push({ name: 'viewer', params: { id: parentFolder._id } });
          if (closeUpload) {
            close();
          }
        }
        return {
          id: parentFolder._id,
          registrationWarnings: registrationSeed?.warnings ?? [],
        };
      } catch (err) {
        if (datasetFolderId && !multicamLinked) {
          try {
            await deleteResources([{ _id: datasetFolderId, _modelType: 'folder' }]);
          } catch (cleanupErr) {
            if (showProgressOverlay) {
              await errorHandler({ err: cleanupErr, name: 'Multicam import cleanup' });
            }
          }
        }
        if (showProgressOverlay) {
          preUploadErrorMessage.value = getResponseError(err);
          await errorHandler({ err, name: 'Multicam import' });
        }
        throw err;
      } finally {
        clearMulticamUploadProgressTimer();
        if (showProgressOverlay) {
          multicamImporting.value = false;
          multicamImportProgress.value = null;
        }
      }
    };

    const multiCamImport = async (args: MultiCamImportArgs) => {
      importMultiCamDialog.value = false;
      if (!isMultiCamFolderArgs(args)) {
        preUploadErrorMessage.value = 'Glob-based multicam import is not supported on web yet.';
        return;
      }
      await runMultiCamFolderImport(args);
    };

    const chooseAndScanBatch = async () => {
      const ret = await openFromDisk('image-sequence', true);
      if (ret.canceled || !ret.fileList?.length) {
        return null;
      }
      batchImportFiles.value = ret.fileList;
      const root = ret.root ?? ret.filePaths[0]?.split('/').filter(Boolean)[0] ?? '';
      if (!root) {
        throw new Error('Could not determine the selected root folder.');
      }
      return scanMultiCamBatchFromFiles(root, ret.fileList);
    };

    const importBatchCollect = async (collect: MultiCamBatchCollect, datasetName: string) => {
      if (!collect.importArgs) {
        return undefined;
      }
      clearMulticamFileRegistry();
      collect.cameras.forEach((camera) => {
        stashCameraFolderFiles(
          camera.sourcePath,
          filesForCameraSource(camera.sourcePath, batchImportFiles.value),
        );
      });
      // Re-stash the collect's registration Files by their scan-time paths so
      // the seeding lookup finds them (the registry is cleared per collect).
      Object.values(collect.importArgs.sourceList).forEach((source) => {
        if (!source.transformFile) {
          return;
        }
        const file = batchImportFiles.value.find(
          (f) => (f.webkitRelativePath || f.name).replace(/\\/g, '/') === source.transformFile,
        );
        if (file) {
          stashTransformFile(source.transformFile, file);
        }
      });
      const { registrationWarnings } = await runMultiCamFolderImport(
        { ...collect.importArgs, datasetName },
        {
          openViewer: false,
          closeUpload: false,
          showProgressOverlay: false,
          progressLabel: collect.name,
          promptRegistrationWarnings: false,
        },
      );
      clearMulticamFileRegistry();
      return registrationWarnings;
    };
    // Filter to show how many files are left to upload
    const filesNotUploaded = (item: PendingUpload) => item.files.filter(
      (file) => file.status !== 'done' && file.status !== 'error',
    ).length;
    // Processes the pending upload from the GirderUpload system to determine the progress
    const computeUploadProgress = (pendingUpload: PendingUpload) => {
      // use methods and properties from mixins
      if (girderUpload.value) {
        //Need to use the girderUpload ref to get these values out of the mixin
        const { formatSize, totalProgress, totalSize } = girderUpload.value;
        if (pendingUpload.files.length === 1 && !pendingUpload.uploading) {
          return formatSize(pendingUpload.files[0].progress.size);
        } if ([ImageSequenceType, LargeImageType].includes(pendingUpload.type)) {
          return `${filesNotUploaded(pendingUpload)} files remaining`;
        } if (pendingUpload.type === VideoType && !pendingUpload.uploading) {
          return `${filesNotUploaded(pendingUpload)} videos remaining`;
        } if ((pendingUpload.type === VideoType || pendingUpload.type === 'zip') && pendingUpload.uploading) {
          // For videos we display the total progress when uploading because
          // single videos can be large
          return `${formatSize(totalProgress)} of ${formatSize(totalSize)}`;
        }
      }
      throw new Error(`could not determine adequate formatting for ${pendingUpload}`);
    };
    const getFilenameInputStateLabel = (pendingUpload: PendingUpload) => {
      const plural = pendingUpload.createSubFolders
        ? 's'
        : '';
      return `Folder Name${plural}`;
    };
    const getFilenameInputStateDisabled = (pendingUpload: PendingUpload) => (
      pendingUpload.uploading || (pendingUpload.createSubFolders && pendingUpload.type !== 'zip')
    );
    const getFilenameInputStateHint = (pendingUpload: PendingUpload) => (
      (pendingUpload.createSubFolders && pendingUpload.type !== 'zip') ? 'default folder names are used when "Create Subfolders" is selected' : ''
    );
    const getFilenameInputValue = (pendingUpload: PendingUpload) => (
      pendingUpload.createSubFolders && pendingUpload.type !== 'zip' ? 'default' : pendingUpload.name
    );
    /**
     * Rebuild every non-zip row's validated media/annotation/config package from its
     * (possibly edited) slots, then start the shared Girder upload. The server stays the
     * authority for those roles; the metadata attachment is uploaded separately.
     */
    const prepAndUpload = async (uploadFn: () => Promise<void>) => {
      // Validation is an awaited round-trip, so without this gate a second click starts the
      // whole upload again before the first one has set any row's `uploading` flag.
      if (preparing.value || uploading.value) {
        return;
      }
      preparing.value = true;
      preUploadErrorMessage.value = null;
      try {
        for (let i = 0; i < pendingUploads.value.length; i += 1) {
          const pendingUpload = pendingUploads.value[i];
          if (pendingUpload.type !== 'zip') {
            const slotFiles = slotFileList(pendingUpload);
            // eslint-disable-next-line no-await-in-loop -- validate each row before upload
            const validation = (await validateUploadGroup(slotFiles.map((f) => f.name))).data;
            if (!validation.ok) {
              pendingUpload.error = validation.message || 'Upload validation failed';
              return;
            }
            pendingUpload.error = null;
            // A row rejected on pick has no name yet; name it now that the user's
            // correction validates, so it never uploads into an unnamed folder.
            if (!pendingUpload.name) {
              pendingUpload.name = defaultRowName(validation);
            }
            // Server confirms the media type here too: an error row's type was only the
            // import menu until now, and the (unfiltered) slot editor may have changed
            // media kinds. Preserve the large-image menu preference when the server
            // still classifies the files as an image sequence, matching addPendingUpload.
            pendingUpload.type = pendingUpload.type === LargeImageType
              && validation.type === ImageSequenceType
              ? LargeImageType
              : validation.type;
            pendingUpload.createSubFolders = fansOutToSubFolders(validation);
            pendingUpload.uploadFiles = acceptedUploadFiles(slotFiles, validation);
            pendingUpload.ignored = rowIgnoredFiles(pendingUpload, validation);
          }
        }
        await uploadFn();
      } catch (err) {
        preUploadErrorMessage.value = getResponseError(err);
      } finally {
        preparing.value = false;
      }
    };
    const requiredRule = (val: string | null) => (
      (val || '').length > 0 || 'This field is required'
    );
    const mediaFilesRequiredRule = (val: File[] | null) => (
      (val || []).length > 0 || 'Media Files are required'
    );
    const remove = (pendingUpload: PendingUpload) => {
      // Identity, not index: a row retired twice must never take a different row with it.
      pendingUploads.value = pendingUploads.value.filter((row) => row !== pendingUpload);
    };
    function close() {
      emit('close');
    }
    const closeMultiCamBatchDialog = (importedCount = 0) => {
      importMultiCamBatchDialog.value = false;
      batchImportFiles.value = [];
      if (importedCount > 0) {
        eventBus.$emit('refresh-data-browser');
      }
    };
    function abort() {
      if (pendingUploads.value.length === 0) {
        close();
      }
    }
    const uploading = computed(() => pendingUploads.value.some((v) => v.uploading));
    const buttonAttrs = computed(() => {
      if (pendingUploads.value.length === 0) {
        return {
          block: true,
          color: 'primary',
          disabled: uploading.value,
        };
      }
      return {
        block: true,
        color: 'grey darken-3',
        depressed: true,
        disabled: uploading.value,
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorHandler = async ({ err, name }: {err: any; name: string}) => {
      const text = getResponseError(err);
      await prompt({
        title: `${name}: Import Error`,
        text,
        positiveButton: 'OK',
      });
    };
    return {
      buttonAttrs,
      FPSOptions,
      preUploadErrorMessage,
      pendingUploads,
      stereo,
      multiCamOpenType,
      importMultiCamDialog,
      importMultiCamBatchDialog,
      girderUpload,
      multicamImporting,
      multicamImportProgress,
      preparing,
      uploading,
      clientSettings,
      //methods
      close,
      closeMultiCamBatchDialog,
      openImport,
      openMultiCamDialog,
      multiCamImportCheck,
      multiCamImport,
      chooseAndScanBatch,
      importBatchCollect,
      registerSubfolderCameras,
      unregisterSubfolderCamera,
      renameSubfolderCamera,
      computeUploadProgress,
      getFilenameInputStateLabel,
      getFilenameInputValue,
      getFilenameInputStateDisabled,
      getFilenameInputStateHint,
      filterFileUpload,
      mediaSlotAccept,
      requiredRule,
      mediaFilesRequiredRule,
      prepAndUpload,
      remove,
      abort,
      errorHandler,
    };
  },
});
</script>

<template>
  <div class="upload">
    <v-dialog
      :value="importMultiCamDialog || multicamImporting"
      persistent
      overlay-opacity="0.95"
      max-width="80%"
    >
      <v-card
        v-if="multicamImporting"
        outlined
      >
        <v-card-title class="text-h5">
          {{ multicamImportProgress?.message ?? 'Importing multicam dataset' }}
          <v-progress-linear
            :value="multicamImportProgress?.percent ?? 0"
            color="light-blue"
            class="mt-3"
            height="8"
          />
          <div
            v-if="multicamImportProgress"
            class="text-caption mt-1 grey--text text--lighten-1"
          >
            {{ multicamImportProgress.percent }}%
          </div>
        </v-card-title>
      </v-card>
      <ImportMultiCamDialog
        v-else-if="importMultiCamDialog"
        :stereo="stereo"
        :data-type="multiCamOpenType"
        :enable-transform-import="true"
        :enable-subfolder-import="true"
        :register-subfolder-cameras="registerSubfolderCameras"
        :unregister-subfolder-camera="unregisterSubfolderCamera"
        :rename-subfolder-camera="renameSubfolderCamera"
        :import-media="multiCamImportCheck"
        @begin-multicam-import="multiCamImport($event)"
        @abort="importMultiCamDialog = false; preUploadErrorMessage = null"
      />
    </v-dialog>
    <v-dialog
      :value="importMultiCamBatchDialog"
      persistent
      overlay-opacity="0.95"
      max-width="80%"
    >
      <ImportMultiCamBatchDialog
        v-if="importMultiCamBatchDialog"
        :choose-and-scan="chooseAndScanBatch"
        :import-collect="importBatchCollect"
        @abort="closeMultiCamBatchDialog"
      />
    </v-dialog>
    <v-card
      outlined
      color="default"
    >
      <v-toolbar
        flat
        dark
      >
        <v-toolbar-title>Upload datasets</v-toolbar-title>
        <v-spacer />
        <v-btn
          icon
          @click="close"
        >
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>
      <v-progress-linear
        v-show="girderUpload && girderUpload.totalProgressPercent"
        :value="girderUpload && girderUpload.totalProgressPercent"
        absolute
        height="6px"
      />
      <upload-girder
        ref="girderUpload"
        :pending-uploads="pendingUploads"
        :pre-upload-error-message="preUploadErrorMessage"
        :location="location"
        class="mx-6"
        @remove-upload="remove"
        @update:uploading="$emit('update:uploading', $event)"
        @abort="abort"
        @error="errorHandler"
      >
        <template #default="{ upload }">
          <v-card
            v-for="(pendingUpload, i) of pendingUploads"
            :key="i"
            outlined
            class="pa-4 my-4"
          >
            <v-row class="align-center">
              <v-col class="py-0">
                <v-text-field
                  :value="getFilenameInputValue(pendingUpload)"
                  class="upload-name"
                  :rules="[requiredRule]"
                  required
                  :label="getFilenameInputStateLabel(pendingUpload)"
                  :disabled="getFilenameInputStateDisabled(pendingUpload)"
                  :hint="getFilenameInputStateHint(pendingUpload)"
                  persistent-hint
                  @input="pendingUpload.name = $event"
                />
              </v-col>
              <v-col
                cols="3"
                class="py-0"
              >
                <v-select
                  v-model="pendingUpload.fps"
                  :items="FPSOptions"
                  :disabled="pendingUpload.uploading"
                  type="number"
                  required
                  label="FPS"
                  :append-icon="pendingUpload.annotationFile
                    ? 'mdi-alert' : 'mdi-chevron-down'"
                  :hint="pendingUpload.annotationFile
                    ? 'should match annotation fps' : 'annotation fps'"
                  persistent-hint
                  @change="clientSettings.annotationFPS = $event"
                />
              </v-col>
              <v-col
                cols="1"
                class="py-0"
              >
                <v-btn
                  icon
                  outlined
                  :disabled="pendingUpload.uploading"
                  @click="remove(pendingUpload)"
                >
                  <v-icon>mdi-close</v-icon>
                </v-btn>
              </v-col>
            </v-row>
            <v-alert
              v-if="pendingUpload.error"
              dense
              outlined
              type="error"
              class="mt-4 mb-0 text-body-2"
            >
              {{ pendingUpload.error }}
            </v-alert>
            <!--
              mt-3 states the gap outright instead of relying on Vuetify's `.row + .row` rule: the
              error alert and the ignored-file list sit between these rows, and when either renders
              the row falls back to the base -12px and rides up over it.
            -->
            <v-row
              v-if="!pendingUpload.createSubFolders && pendingUpload.type !== 'zip'"
              class="mt-3"
            >
              <!-- pb-3 offsets the row's negative bottom margin so the card encloses the hint. -->
              <v-col class="pt-0 pb-3 mx-2">
                <v-row>
                  <v-file-input
                    v-model="pendingUpload.mediaList"
                    multiple
                    show-size
                    counter
                    :disabled="pendingUpload.uploading"
                    :prepend-icon="
                      ['image-sequence', 'large-image'].includes(pendingUpload.type)
                        ? 'mdi-image-multiple'
                        : 'mdi-file-video'
                    "
                    :label="
                      pendingUpload.type === 'image-sequence'
                        ? 'Image files'
                        : pendingUpload.type === 'video'
                          ? 'Video file'
                          : 'Tiled Image files'
                    "
                    :rules="[mediaFilesRequiredRule]"
                    :accept="mediaSlotAccept(pendingUpload)"
                  />
                </v-row>
                <v-row>
                  <v-file-input
                    v-model="pendingUpload.annotationFile"
                    show-size
                    counter
                    prepend-icon="mdi-file-table"
                    label="Annotation File (Optional)"
                    hint="Optional"
                    :disabled="pendingUpload.uploading"
                    :accept="filterFileUpload('annotation')"
                  />
                </v-row>
                <v-row>
                  <v-file-input
                    v-model="pendingUpload.configFile"
                    show-size
                    counter
                    label="Configuration File (Optional)"
                    hint="Optional"
                    :disabled="pendingUpload.uploading"
                    :accept="filterFileUpload('config')"
                  />
                </v-row>
                <!--
                  no-gutters drops the row's negative bottom margin, which would otherwise crop
                  the persistent hint against the card edge and the upload progress line.
                -->
                <v-row
                  no-gutters
                  class="mt-3"
                >
                  <v-file-input
                    v-model="pendingUpload.metadataFile"
                    show-size
                    counter
                    prepend-icon="mdi-file-cog"
                    label="Metadata File (Optional)"
                    hint="Passed to pipelines that request it. CSV and TXT frame rows also appear as Frame Metadata."
                    persistent-hint
                    :disabled="pendingUpload.uploading"
                    :accept="filterFileUpload('metadata')"
                  />
                </v-row>
              </v-col>
            </v-row>
            <v-row v-if="pendingUpload.type === 'video'">
              <v-checkbox
                v-model="pendingUpload.skipTranscoding"
                label="Skip Transcoding"
              />
              <v-tooltip
                open-delay="200"
                right
                max-width="200"
              >
                <template #activator="{ on }">
                  <v-icon
                    small
                    v-on="on"
                  >
                    mdi-help
                  </v-icon>
                </template>
                <span>Attempt to skip transcoding of video file if it is an
                  '.mp4' and encoded using the h264 codec.
                  If skipping fails it will fallback to transcoding.</span>
              </v-tooltip>
            </v-row>
            <!--
              Below the slots, where it reads as the remainder of the selection the slot counts
              above do not account for. mt-3 clears the negative bottom margin the row above ends on.
            -->
            <div
              v-if="pendingUpload.ignored.length"
              class="mx-4 mt-6"
            >
              <div class="text-caption warning--text">
                Ignored (not uploaded):
              </div>
              <div
                v-for="(ignoredFile, ignoredIndex) in pendingUpload.ignored"
                :key="`${ignoredIndex}-${ignoredFile.name}`"
                class="text-caption grey--text"
              >
                {{ ignoredFile.name }} ({{ ignoredFile.reason }})
              </div>
            </div>
            <!-- mt-3 clears the negative bottom margin the row above ends on. -->
            <div
              v-if="uploading"
              class="mx-4 mt-3 text-body-2 d-flex align-center"
            >
              <v-progress-circular
                indeterminate
                size="16"
                width="2"
                class="mr-2"
              />
              {{ computeUploadProgress(pendingUpload) }}
            </div>
          </v-card>
          <div>
            <v-list>
              <v-list-item>
                <import-button
                  :name="`Add ${pendingUploads.length ? 'Another ' : ''}Image Sequence`"
                  icon="mdi-folder-open"
                  open-type="image-sequence"
                  class="grow my-2"
                  :small="!!pendingUploads.length"
                  :multi-cam-import="true"
                  :batch-multi-cam-import="true"
                  :button-attrs="buttonAttrs"
                  @open="openImport($event)"
                  @multi-cam="openMultiCamDialog"
                  @multi-cam-batch="importMultiCamBatchDialog = true"
                />
              </v-list-item>
              <v-list-item>
                <import-button
                  :name="`Add ${pendingUploads.length ? 'Another ' : ''}Video`"
                  icon="mdi-file-video"
                  class="grow my-2"
                  :small="!!pendingUploads.length"
                  open-type="video"
                  :multi-cam-import="true"
                  :button-attrs="buttonAttrs"
                  @open="openImport($event)"
                  @multi-cam="openMultiCamDialog"
                />
              </v-list-item>
              <v-list-item>
                <import-button
                  :name="`Add ${pendingUploads.length ? 'Another ' : ''}Tiled TIFF / NITF`"
                  icon="mdi-folder-open"
                  open-type="large-image"
                  class="grow my-2"
                  :small="!!pendingUploads.length"
                  :button-attrs="buttonAttrs"
                  tooltip="Upload tiled geospatial images for the large-image viewer. Supports TIFF (.tif, .tiff), NITF (.nitf, .ntf), and other tiled raster data with internal pyramid overviews."
                  @open="openImport($event)"
                />
              </v-list-item>
              <v-list-item>
                <import-button
                  :name="`Add ${pendingUploads.length ? 'Another ' : ''}Zip File`"
                  icon="mdi-zip-box"
                  class="grow my-2"
                  :small="!!pendingUploads.length"
                  open-type="zip"
                  :button-attrs="buttonAttrs"
                  @open="openImport($event)"
                />
              </v-list-item>
              <v-list />
            </v-list>
          </div>
          <div v-if="pendingUploads.length && pendingUploads.some((item) => item.type === 'zip')">
            <h3 class="text-center">
              <a
                target="_blank"
                href="https://kitware.github.io/dive/Web-Version/#zip-files"
              >
                Supported Zip Files
              </a>
            </h3>
          </div>
          <v-btn
            v-if="pendingUploads.length"
            :disabled="uploading || preparing"
            block
            large
            color="primary"
            class="my-6"
            @click="prepAndUpload(upload)"
          >
            <v-icon class="pr-3">
              mdi-upload
            </v-icon>
            Start upload
          </v-btn>
        </template>
      </upload-girder>
    </v-card>
  </div>
</template>
