<script lang='ts'>
import {
  defineComponent, Ref, ref, computed, onBeforeUnmount,
} from 'vue';
import { useRouter } from 'vue-router/composables';

import {
  ImageSequenceType, VideoType, DefaultVideoFPS, FPSOptions, LargeImageType,
} from 'dive-common/constants';

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
  saveMetadata,
  uploadCalibrationItem,
  validateUploadGroup,
  waitForFolderDatasetReady,
} from 'platform/web-girder/api';
import type {
  IgnoredUploadFile,
  ValidatedUploadRoleMap,
} from 'platform/web-girder/api';
import { buildValidatedUploadPackage } from 'platform/web-girder/uploadPackage';
import {
  clearMulticamFileRegistry,
  getCalibrationFile,
  getCameraPackageFiles,
  getFilesForSourceKey,
  getTransformFile,
  flattenUploadFiles,
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
  uploadFiles: File[];
  roles: ValidatedUploadRoleMap;
  ignored: IgnoredUploadFile[];
  type: DatasetType | 'zip';
  fps: number;
  uploading: boolean;
  skipTranscoding?: boolean;
}

const emptyRoleMap = (): ValidatedUploadRoleMap => ({
  media: [], annotations: [], datasetConfig: [], frameMetadata: [],
});

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
    const stereo = ref(false);
    const multiCamOpenType = ref('image-sequence');
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
        uploadFiles: allFiles,
        roles: emptyRoleMap(),
        ignored: [],
        type: 'zip',
        fps,
        uploading: false,
      });
    };

    const addPendingUpload = async (
      allFiles: File[],
      suggestedFps?: number, // suggested FPS for large/images
      expectedType?: DatasetType,
    ) => {
      const validation = (await validateUploadGroup(allFiles.map((f) => f.name))).data;
      if (!validation.ok) {
        // Block: surface the reason and do not create an uploadable pending row.
        if (validation.message) {
          preUploadErrorMessage.value = validation.message;
        }
        throw new Error(validation.message || 'Upload validation failed');
      }
      const uploadType = expectedType === LargeImageType ? LargeImageType : validation.type;
      // Server validation is the single authority for what uploads; the browser
      // never re-classifies. uploadFiles is the original File objects, in the
      // server's upload order.
      const { uploadFiles, roles, ignored } = buildValidatedUploadPackage(allFiles, validation);
      const fps = suggestedFps || clientSettings.annotationFPS || DefaultVideoFPS;
      const defaultFilename = roles.media[0] ?? uploadFiles[0]?.name ?? '';
      // Only a multi-video upload fans out into per-video subfolders.
      const createSubFolders = validation.type === VideoType && roles.media.length > 1;
      pendingUploads.value.push({
        createSubFolders,
        name:
          uploadFiles.length > 1
            ? defaultFilename.replace(fileSuffixRegex, '')
            : defaultFilename,
        files: [], //Will be set in the GirderUpload Component
        uploadFiles,
        roles,
        ignored,
        type: uploadType,
        fps,
        uploading: false,
        skipTranscoding: true,
      });
    };
    /**
     * Initial opening of file dialog. The complete selection is sent to server
     * validation; the browser no longer pre-classifies files into buckets.
     */
    const openImport = async (dstype: DatasetType | 'zip') => {
      const ret = await openFromDisk(dstype);
      if (ret.canceled || !ret.fileList || ret.fileList.length === 0) {
        return;
      }
      const allFiles = ret.fileList;
      preUploadErrorMessage.value = null;
      try {
        if (dstype === 'zip') {
          const name = allFiles.length === 1 ? allFiles[0].name : '';
          addPendingZipUpload(name, allFiles);
        } else {
          const suggestedFps = dstype === 'image-sequence' || dstype === 'large-image' ? 1 : undefined;
          await addPendingUpload(allFiles, suggestedFps, dstype);
        }
      } catch (err) {
        preUploadErrorMessage.value = err.response?.data?.message || err;
      }
    };
    const openMultiCamDialog = (args: { stereo: boolean; openType: 'image-sequence' | 'video' }) => {
      stereo.value = args.stereo;
      multiCamOpenType.value = args.openType;
      importMultiCamDialog.value = true;
    };
    const multiCamImportCheck = (sourcePath: string): MediaImportResponse => {
      const files = getFilesForSourceKey(sourcePath) ?? [];
      return {
        jsonMeta: {
          originalImageFiles: files.map((file) => file.name),
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
        const fps = args.type === VideoType
          ? DefaultVideoFPS
          : (clientSettings.annotationFPS || 1);
        setMulticamImportProgress(MULTICAM_PROGRESS_START, `${labelPrefix}Creating dataset folder…`);
        const { data: datasetFolder } = await createGirderFolder({
          folderId: props.location._id,
          name: datasetName,
          description: 'Multicamera dataset',
        });
        datasetFolderId = datasetFolder._id;
        const cameras: Record<string, { folderId: string; type?: string }> = {};
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
          let folderFiles = flattenUploadFiles(getFilesForSourceKey(source.sourcePath) ?? []);
          if (source.glob) {
            // Cameras sharing one folder (per-modality suffixes) upload only their glob's files
            folderFiles = folderFiles.filter((file) => filterByGlob(source.glob as string, [file.name]).length === 1);
          }
          if (!folderFiles.length) {
            throw new Error(`No media files found for camera "${cameraName}"`);
          }
          // Complete camera package: folder files plus the explicit track file
          // (deduped by File identity), flattened before validation so the names
          // the server validates match the names uploaded to Girder.
          const cameraFiles = getCameraPackageFiles(folderFiles, source.trackFile);
          // eslint-disable-next-line no-await-in-loop -- validate then upload each camera sequentially
          const validation = (await validateUploadGroup(cameraFiles.map((f) => f.name))).data;
          if (!validation.ok) {
            throw new Error(validation.message || `Invalid files for camera "${cameraName}"`);
          }
          const cameraType = source.type ?? args.type;
          const uploadType = validation.type;
          const compatibleTypes = new Set([cameraType, args.type, 'large-image', 'image-sequence']);
          if (!compatibleTypes.has(uploadType)) {
            throw new Error(`Camera "${cameraName}" must use ${cameraType} media`);
          }
          // Server validation is the authority: upload exactly what it accepted,
          // which includes validated camera-folder sidecars and annotation/config
          // files, not just validation.roles.media.
          const { uploadFiles } = buildValidatedUploadPackage(cameraFiles, validation);
          validation.ignored.forEach((entry) => ignoredAcrossCameras.push({
            camera: cameraName, name: entry.name, reason: entry.reason,
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
              `Stereoscopic calibration must be ${stereoCalibrationAllowedExtensionsLabel()}.`,
            );
          }
          calibrationFileId = await uploadCalibrationItem(datasetFolder._id, calFile);
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
        });
        multicamLinked = true;

        if (registrationSeed?.values) {
          // Seed the dataset's saved camera registration (the same
          // registration the in-app panel edits and the Align button
          // applies); the camera* fields are allowlisted in the meta PATCH.
          setMulticamImportProgress(98, `${labelPrefix}Saving camera registration…`);
          await saveMetadata(parentFolder._id, {
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
          preUploadErrorMessage.value = err.response?.data?.message || err.message || String(err);
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
    /** Summary lines describing what the validated package will upload (D2). */
    const roleSummaryLines = (pendingUpload: PendingUpload): string[] => {
      const { roles } = pendingUpload;
      const lines: string[] = [];
      const pushLine = (count: number, noun: string) => {
        if (count > 0) {
          lines.push(`${count} ${noun}${count === 1 ? '' : 's'}`);
        }
      };
      pushLine(roles.media.length, 'media file');
      pushLine(roles.annotations.length, 'annotation file');
      pushLine(roles.datasetConfig.length, 'configuration file');
      pushLine(roles.frameMetadata.length, 'frame metadata file');
      return lines;
    };
    const remove = (pendingUpload: PendingUpload) => {
      const index = pendingUploads.value.indexOf(pendingUpload);
      pendingUploads.value.splice(index, 1);
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
      roleSummaryLines,
      addPendingUpload,
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
                  :rules="[val => (val || '').length > 0 || 'This field is required']"
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
                  :append-icon="pendingUpload.roles.annotations.length
                    ? 'mdi-alert' : 'mdi-chevron-down'"
                  :hint="pendingUpload.roles.annotations.length
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
            <v-row v-if="pendingUpload.type !== 'zip'">
              <v-col class="py-0 mx-2">
                <div
                  v-for="line in roleSummaryLines(pendingUpload)"
                  :key="line"
                  class="text-body-2"
                >
                  {{ line }}
                </div>
                <div
                  v-if="pendingUpload.ignored.length"
                  class="mt-2"
                >
                  <div class="text-caption warning--text">
                    Ignored (not uploaded):
                  </div>
                  <div
                    v-for="ignoredFile in pendingUpload.ignored"
                    :key="ignoredFile.name"
                    class="text-caption grey--text"
                  >
                    {{ ignoredFile.name }} ({{ ignoredFile.reason }})
                  </div>
                </div>
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
            <v-row v-if="uploading">
              <v-col class="py-0 mx-2 text-body-2 d-flex align-center">
                <v-progress-circular
                  indeterminate
                  size="16"
                  width="2"
                  class="mr-2"
                />
                {{ computeUploadProgress(pendingUpload) }}
              </v-col>
            </v-row>
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
            :disabled="uploading"
            block
            large
            color="primary"
            class="my-6"
            @click="upload"
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
