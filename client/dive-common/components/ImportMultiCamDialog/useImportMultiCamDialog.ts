/**
 * Composable backing the multicam import dialog. Its return value is `ImportMultiCamContext`
 * (`ctx`): shared reactive state, computeds, and handlers passed from the shell to child
 * panels via the `ctx` prop — not the shell's platform props from Upload/Recent.
 */
import Vue, {
  computed, onMounted, ref, Ref,
} from 'vue';
import { filterByGlob } from 'platform/desktop/sharedUtils';
import {
  MediaImportResponse,
  DatasetType,
  useApi,
  MultiCamImportFolderArgs,
  MultiCamImportKeywordArgs,
} from 'dive-common/apispec';
import {
  applyParentPathToAssignments,
  commonPathPrefix,
  groupParentFolderByCamera,
  inferSubfolderImportType,
  isValidCameraName,
  organizeSubfolderCameras,
  parentFolderLabelFromAbsolutePaths,
  pickDefaultMulticamCamera,
  subfolderVideoDisplayLabel,
} from 'dive-common/components/ImportMultiCamDialog/multicamSubfolderLayout';
import { findStereoCalibrationInFileList } from 'dive-common/stereoParentFolder';
import { ImageSequenceType, VideoType } from 'dive-common/constants';
import { useRequest } from 'dive-common/use';
import {
  MulticamImportType,
  validateMulticamImageSets,
} from 'dive-common/components/ImportMultiCamDialog/validateMulticamImageSets';

export interface UseImportMultiCamDialogProps {
  stereo?: boolean;
  dataType: typeof VideoType | typeof ImageSequenceType;
  importMedia: (path: string) => Promise<MediaImportResponse>;
  /**
   * Offer a per-camera calibration .json transform file picker for cameras
   * after the first (desktop only; the file is parsed by the desktop backend
   * at import time). Ignored for stereo imports, which use calibration files.
   */
  enableTransformImport?: boolean;
  enableSubfolderImport?: boolean;
  registerSubfolderCameras?: (assignments: {
    cameraName: string;
    sourcePath: string;
    files: File[];
  }[]) => void;
  unregisterSubfolderCamera?: (sourcePath: string) => void;
  renameSubfolderCamera?: (oldSourcePath: string, newSourcePath: string) => void;
}

export function useImportMultiCamDialog(
  props: UseImportMultiCamDialogProps,
  emit: (event: 'begin-multicam-import', args: MultiCamImportFolderArgs | MultiCamImportKeywordArgs) => void,
) {
  const {
    openFromDisk,
    getLastCalibration,
    saveCalibration,
    stashCalibrationFile,
    listParentFolderCameras,
    resolveMulticamCameraSourcePath,
    findParentFolderCalibrationFile,
    findParentFolderTransformFiles,
  } = useApi();
  const importType: Ref<MulticamImportType> = ref('');
  const folderList: Ref<Record<string, {
    sourcePath: string;
    trackFile: string;
    transformFile: string;
    type?: DatasetType;
  }>> = ref({});
  const parentFolderName = ref('');
  const subfolderLayoutLabel = ref('');
  const keywordFolder = ref('');
  const pendingImportPayloads: Ref<Record<string, MediaImportResponse | null>> = ref({});
  const globList: Ref<Record<string, { glob: string; trackFile: string }>> = ref({});
  const calibrationFile = ref('');
  const lastCalibrationPath = ref('');
  const calibrationAutoDiscoveryFailed = ref(false);
  const datasetName = ref('');
  const subfolderOriginalNames: Ref<Record<string, string>> = ref({});
  const cameraOrder: Ref<string[]> = ref([]);
  const defaultDisplay = ref('left');
  const importAnnotationFilesCheck = ref(false);
  // When set, cameras may have differing frame counts; frames are aligned downstream
  // by their filename-encoded timestamps instead of by exact positional index. Enables
  // importing datasets with dropped frames (e.g. KAMERA). See validateMulticamImageSets.
  const inferFrameIndexFromFilename = ref(false);
  const { error: importError, request: importRequest } = useRequest();

  onMounted(async () => {
    if (props.stereo && getLastCalibration) {
      const lastCalibration = await getLastCalibration();
      if (lastCalibration) {
        lastCalibrationPath.value = lastCalibration;
      }
    }
  });

  const lastCalibrationFileName = computed(() => {
    if (!lastCalibrationPath.value) {
      return '';
    }
    return lastCalibrationPath.value.replace(/^.*[\\/]/, '');
  });

  const showLastCalibrationSuggestion = computed(
    () => props.stereo
      && !calibrationFile.value
      && !!lastCalibrationPath.value,
  );

  // Per-camera transform pickers: multicam only (stereo uses calibration),
  // folder-based modes only, and never for the first (reference) camera.
  const transformImportEnabled = computed(
    () => !!props.enableTransformImport && !props.stereo,
  );

  const orderedCameraKeys = computed(() => {
    const keys = Object.keys(folderList.value);
    const ordered = cameraOrder.value.filter((key) => keys.includes(key));
    const remaining = keys.filter((key) => !ordered.includes(key));
    return [...ordered, ...remaining];
  });

  const syncDefaultDisplay = () => {
    const keys = orderedCameraKeys.value.length
      ? orderedCameraKeys.value
      : Object.keys(folderList.value);
    if (!keys.length) {
      return;
    }
    if (!keys.includes(defaultDisplay.value)) {
      defaultDisplay.value = pickDefaultMulticamCamera(keys, { preferLeftForStereo: props.stereo });
    }
  };

  const clearCameraSet = () => {
    keywordFolder.value = '';
    parentFolderName.value = '';
    subfolderLayoutLabel.value = '';
    datasetName.value = '';
    calibrationFile.value = '';
    calibrationAutoDiscoveryFailed.value = false;
    subfolderOriginalNames.value = {};
    cameraOrder.value = [];
    defaultDisplay.value = props.stereo ? 'left' : 'center';
    if (props.stereo && importType.value === 'multi') {
      folderList.value = {
        left: { sourcePath: '', trackFile: '', transformFile: '' },
        right: { sourcePath: '', trackFile: '', transformFile: '' },
      };
    } else {
      folderList.value = {};
    }
    if (props.stereo && importType.value === 'keyword') {
      globList.value = {
        left: { glob: '', trackFile: '' },
        right: { glob: '', trackFile: '' },
      };
    } else {
      globList.value = {};
    }

    if (importType.value === 'multi' || importType.value === 'subfolders') {
      if (props.stereo && importType.value === 'multi') {
        pendingImportPayloads.value = {
          left: null,
          right: null,
        };
        cameraOrder.value = ['left', 'right'];
      } else {
        pendingImportPayloads.value = {};
      }
    } else if (importType.value === 'keyword') {
      pendingImportPayloads.value = { keyword: null };
      if (props.stereo) {
        cameraOrder.value = ['left', 'right'];
        defaultDisplay.value = 'left';
      }
    }
  };
  clearCameraSet();

  if (props.dataType === VideoType && !props.enableSubfolderImport) {
    importType.value = 'multi';
  }

  const displayKeys = computed(() => {
    if (importType.value === 'multi' || importType.value === 'subfolders') {
      return orderedCameraKeys.value;
    }
    if (importType.value === 'keyword') return Object.keys(globList.value);
    return [];
  });

  const canMoveCamera = (key: string, delta: number) => {
    const order = orderedCameraKeys.value;
    const index = order.indexOf(key);
    if (index === -1) {
      return false;
    }
    const target = index + delta;
    return target >= 0 && target < order.length;
  };

  const moveCamera = (key: string, delta: number) => {
    const order = [...orderedCameraKeys.value];
    const index = order.indexOf(key);
    if (index === -1) {
      return;
    }
    const target = index + delta;
    if (target < 0 || target >= order.length) {
      return;
    }
    order.splice(index, 1);
    order.splice(target, 0, key);
    cameraOrder.value = order;
  };

  const displayKeysKey = computed(() => displayKeys.value.join('|'));

  const camerasReady = computed(() => {
    if (importType.value !== 'multi' && importType.value !== 'subfolders') {
      return false;
    }
    const keys = Object.keys(folderList.value);
    if (!keys.length) {
      return false;
    }
    return keys.every(
      (key) => folderList.value[key].sourcePath !== ''
        && pendingImportPayloads.value[key] !== null,
    );
  });

  const globImages = computed(() => {
    const filtered: Record<string, string[]> = {};
    Object.entries(globList.value).forEach(([cameraName, val]) => {
      const payload = pendingImportPayloads.value.keyword;
      filtered[cameraName] = filterByGlob(val.glob, payload?.jsonMeta.originalImageFiles);
    });
    return filtered;
  });

  const folderImages = computed(() => {
    const filtered: Record<string, string[]> = {};
    Object.entries(folderList.value).forEach(([cameraName]) => {
      const payload = pendingImportPayloads.value[cameraName];
      filtered[cameraName] = payload?.jsonMeta.originalImageFiles || [];
    });
    return filtered;
  });

  const filteredImages = computed(() => (importType.value === 'keyword'
    ? globImages.value : folderImages.value));

  const errorMessage = computed(() => {
    if (importError.value) {
      return importError.value;
    }

    if (
      Object.values(pendingImportPayloads.value).length === 0
      || Object.values(pendingImportPayloads.value).some((v) => v === null)
      || importType.value === ''
    ) {
      return null;
    }

    return validateMulticamImageSets(
      importType.value,
      filteredImages.value,
      Object.keys(globList.value).length,
      props.dataType,
      inferFrameIndexFromFilename.value,
    );
  });

  const nextSteps = computed(() => {
    if (errorMessage.value !== null) {
      return false;
    }
    if (importType.value === 'multi' || importType.value === 'subfolders') {
      return camerasReady.value && datasetName.value.trim().length > 0;
    }
    if (importType.value === 'keyword' && keywordFolder.value) {
      return true;
    }
    return false;
  });

  const showFinalizeStep = computed(() => {
    if (importType.value === 'subfolders') {
      return false;
    }
    if (importType.value === 'multi') {
      return camerasReady.value;
    }
    if (importType.value === 'keyword') {
      return nextSteps.value;
    }
    return false;
  });

  async function openParentFolder() {
    const ret = await openFromDisk(props.dataType, true);
    if (ret.canceled) {
      return;
    }
    const useDesktopDiscovery = !ret.fileList?.length && !!ret.filePaths?.[0]
      && !!listParentFolderCameras;
    if (!ret.fileList?.length && !useDesktopDiscovery) {
      return;
    }

    await importRequest(async () => {
      let parentPath = '';
      let grouped: Map<string, File[]> | undefined;
      let folderNames: string[] = [];
      let desktopCameras: { name: string; sourcePath: string }[] | undefined;
      const mediaType = props.dataType === VideoType ? 'video' : 'image-sequence';

      if (ret.fileList?.length) {
        const paths = ret.fileList.map((f) => f.webkitRelativePath || f.name);
        parentPath = ret.root || commonPathPrefix(paths);
        grouped = groupParentFolderByCamera(ret.fileList, {
          allowRootLevelVideos: props.dataType === VideoType,
          mediaType,
        }, parentPath);
        folderNames = [...grouped.keys()];
      } else {
        const [firstPath] = ret.filePaths;
        parentPath = firstPath;
        desktopCameras = await listParentFolderCameras!(parentPath, mediaType);
        folderNames = desktopCameras.map((camera) => camera.name);
      }

      const organized = organizeSubfolderCameras(folderNames, {
        preferLeftForStereo: props.stereo,
      });
      if (organized.error) {
        throw new Error(organized.error);
      }

      const parentLabel = parentPath.split(/[/\\]/).pop() || parentPath || 'parent folder';
      parentFolderName.value = parentLabel;
      subfolderLayoutLabel.value = organized.layoutLabel;
      if (!datasetName.value.trim()) {
        datasetName.value = parentFolderName.value;
      }

      await discoverParentFolderCalibration(
        parentPath,
        ret.fileList,
        ret.root || parentPath,
      );

      let { assignments } = organized;
      if (useDesktopDiscovery) {
        if (desktopCameras?.length) {
          assignments = assignments.map((assignment) => {
            const discovered = desktopCameras?.find(
              (camera) => camera.name === assignment.folderName,
            );
            return discovered
              ? { ...assignment, sourcePath: discovered.sourcePath }
              : assignment;
          });
        } else {
          assignments = applyParentPathToAssignments(parentPath, assignments);
        }
        if (resolveMulticamCameraSourcePath) {
          assignments = await Promise.all(assignments.map(async (assignment) => ({
            ...assignment,
            sourcePath: await resolveMulticamCameraSourcePath(assignment.sourcePath, mediaType),
          })));
        }
      }

      const registryPayload = assignments.map((assignment) => ({
        cameraName: assignment.cameraName,
        sourcePath: assignment.sourcePath,
        files: grouped?.get(assignment.folderName) ?? [],
      }));
      if (props.registerSubfolderCameras) {
        props.registerSubfolderCameras(registryPayload);
      }

      folderList.value = {};
      pendingImportPayloads.value = {};
      subfolderOriginalNames.value = {};
      cameraOrder.value = registryPayload.map((item) => item.cameraName);

      for (let i = 0; i < registryPayload.length; i += 1) {
        const { cameraName, sourcePath, files } = registryPayload[i];
        if (grouped && !files.length) {
          throw new Error(`Camera "${organized.assignments[i].folderName}" has no media files`);
        }
        Vue.set(
          subfolderOriginalNames.value,
          cameraName,
          subfolderSourceDisplayLabel(
            sourcePath,
            organized.assignments[i].folderName,
            files,
          ),
        );
        Vue.set(folderList.value, cameraName, {
          sourcePath,
          trackFile: '',
          transformFile: '',
          type: props.registerSubfolderCameras && props.dataType !== VideoType
            ? inferSubfolderImportType(files, { largeImageForTiff: true })
            : props.dataType,
        });
        // eslint-disable-next-line no-await-in-loop -- import each camera media sequentially
        const mediaPayload = await props.importMedia(sourcePath);
        Vue.set(pendingImportPayloads.value, cameraName, mediaPayload);
      }
      defaultDisplay.value = pickDefaultMulticamCamera(
        registryPayload.map((item) => item.cameraName),
        { preferLeftForStereo: props.stereo },
      );
      syncDefaultDisplay();
      await discoverParentFolderTransform(parentPath);
    });
  }

  function renameCamera(oldKey: string, newName: string) {
    const newKey = (typeof newName === 'string' ? newName : '').trim();
    if (!newKey || newKey === oldKey) {
      return;
    }
    if (!isValidCameraName(newKey)) {
      throw new Error('Camera name must be letters, numbers, and underscores only');
    }
    if (folderList.value[newKey]) {
      throw new Error(`Camera name "${newKey}" already exists`);
    }
    const entry = folderList.value[oldKey];
    const payload = pendingImportPayloads.value[oldKey];
    const original = subfolderOriginalNames.value[oldKey];
    const { sourcePath } = entry;

    if (importType.value === 'subfolders' && props.renameSubfolderCamera) {
      props.renameSubfolderCamera(sourcePath, newKey);
    }

    Vue.set(folderList.value, newKey, {
      sourcePath: (importType.value === 'subfolders' && !listParentFolderCameras) ? newKey : sourcePath,
      trackFile: entry.trackFile,
      transformFile: entry.transformFile,
    });
    Vue.delete(folderList.value, oldKey);

    if (payload !== undefined) {
      Vue.set(pendingImportPayloads.value, newKey, payload);
      Vue.delete(pendingImportPayloads.value, oldKey);
    }
    if (original) {
      Vue.set(subfolderOriginalNames.value, newKey, original);
      Vue.delete(subfolderOriginalNames.value, oldKey);
    }
    if (defaultDisplay.value === oldKey) {
      defaultDisplay.value = newKey;
    }
    cameraOrder.value = cameraOrder.value.map((k) => (k === oldKey ? newKey : k));
    syncDefaultDisplay();
  }

  async function updateSubfolderCameraSource(
    cameraKey: string,
    sourcePath: string,
    displayRoot?: string,
    files: File[] = [],
  ) {
    const mediaType = props.dataType === VideoType ? 'video' : 'image-sequence';
    let resolvedPath = sourcePath;
    if (resolveMulticamCameraSourcePath) {
      resolvedPath = await resolveMulticamCameraSourcePath(sourcePath, mediaType);
    }
    const oldSourcePath = folderList.value[cameraKey]?.sourcePath;
    if (oldSourcePath && props.unregisterSubfolderCamera) {
      props.unregisterSubfolderCamera(oldSourcePath);
    }
    const displayName = props.dataType === VideoType
      ? subfolderSourceDisplayLabel(resolvedPath, cameraKey, files)
      : ((displayRoot || sourcePath).split(/[/\\]/).pop() || cameraKey);
    Vue.set(subfolderOriginalNames.value, cameraKey, displayName);
    folderList.value[cameraKey].sourcePath = resolvedPath;
    folderList.value[cameraKey].trackFile = '';
    folderList.value[cameraKey].transformFile = '';
    if (props.registerSubfolderCameras && files.length) {
      props.registerSubfolderCameras([{
        cameraName: cameraKey,
        sourcePath: resolvedPath,
        files,
      }]);
    }
    Vue.set(
      pendingImportPayloads.value,
      cameraKey,
      await props.importMedia(resolvedPath),
    );
  }

  async function openAnnotationFile(folder: string) {
    const ret = await openFromDisk('annotation');
    if (!ret.canceled) {
      if (ret.filePaths?.length) {
        const path = ret.filePaths[0];
        folderList.value[folder].trackFile = path;
      }
    }
  }

  function showTransformFileField(folder: string) {
    return transformImportEnabled.value
      && (importType.value === 'multi' || importType.value === 'subfolders')
      && orderedCameraKeys.value.indexOf(folder) > 0;
  }

  async function openTransformFile(folder: string) {
    const ret = await openFromDisk('transform');
    if (!ret.canceled && ret.filePaths?.length) {
      [folderList.value[folder].transformFile] = ret.filePaths;
    }
  }

  function clearTransformFile(folder: string) {
    folderList.value[folder].transformFile = '';
  }

  async function open(
    dstype: DatasetType | 'calibration' | 'text',
    folder: string | 'calibration',
    directory = false,
  ) {
    const ret = await openFromDisk(dstype, directory || dstype === 'image-sequence');
    if (!ret.canceled) {
      const path = ret.filePaths[0];
      if (folder === 'calibration') {
        calibrationFile.value = path;
        calibrationAutoDiscoveryFailed.value = false;
        lastCalibrationPath.value = path;
        if (saveCalibration) {
          saveCalibration(path);
        }
      } else if (importType.value === 'multi') {
        if (ret.root) {
          folderList.value[folder].sourcePath = ret.root;
        } else {
          folderList.value[folder].sourcePath = path;
        }
        folderList.value[folder].trackFile = '';
        folderList.value[folder].transformFile = '';
        const { sourcePath } = folderList.value[folder];
        if (props.registerSubfolderCameras && ret.fileList?.length) {
          props.registerSubfolderCameras([{
            cameraName: folder,
            sourcePath,
            files: ret.fileList,
          }]);
        }
        Vue.set(
          pendingImportPayloads.value,
          folder,
          await importRequest(() => props.importMedia(sourcePath)),
        );
        syncSuggestedDatasetNameFromCameraPaths();
      } else if (importType.value === 'subfolders') {
        const sourcePath = ret.root || path;
        await importRequest(() => updateSubfolderCameraSource(
          folder,
          sourcePath,
          ret.root,
          ret.fileList ?? [],
        ));
      } else if (importType.value === 'keyword') {
        [keywordFolder.value] = ret.filePaths;
        if (ret.root) {
          keywordFolder.value = ret.root;
        }
        pendingImportPayloads.value.keyword = await importRequest(() => props.importMedia(path));
      }
    }
  }

  const deleteSet = (key: string) => {
    if (importType.value === 'multi' || importType.value === 'subfolders') {
      const { sourcePath } = folderList.value[key];
      if (importType.value === 'subfolders' && props.unregisterSubfolderCamera) {
        props.unregisterSubfolderCamera(sourcePath);
      }
      Vue.delete(folderList.value, key);
      Vue.delete(pendingImportPayloads.value, key);
      Vue.delete(subfolderOriginalNames.value, key);
      cameraOrder.value = cameraOrder.value.filter((k) => k !== key);
      syncDefaultDisplay();
    } else if (importType.value === 'keyword') {
      Vue.delete(globList.value, key);
    }
  };

  async function onRenameCamera(oldKey: string, newName: string) {
    try {
      renameCamera(oldKey, newName);
    } catch (err) {
      await importRequest(() => Promise.reject(err));
    }
  }

  const addNewSet = (name: string) => {
    if (importType.value === 'multi') {
      Vue.set(folderList.value, name, { sourcePath: '', trackFile: '', transformFile: '' });
      Vue.set(pendingImportPayloads.value, name, null);
      cameraOrder.value = [...cameraOrder.value, name];
    } else if (importType.value === 'keyword') {
      Vue.set(globList.value, name, { glob: '', trackFile: '' });
    }
  };

  const prepForImport = () => {
    if (!importAnnotationFilesCheck.value) {
      Object.keys(folderList.value).forEach((key) => {
        folderList.value[key].trackFile = '';
      });
    }
    if (importType.value === 'multi' || importType.value === 'subfolders') {
      const sourceList: MultiCamImportFolderArgs['sourceList'] = {};
      orderedCameraKeys.value.forEach((key) => {
        if (folderList.value[key]) {
          const {
            sourcePath, trackFile, transformFile, type,
          } = folderList.value[key];
          if (type === 'multi') {
            // Sub Cameras shouldn't be multi types
            return;
          }
          sourceList[key] = {
            sourcePath,
            trackFile,
            ...(type ? { type } : {}),
          };
          // Transforms only apply to cameras after the first (reference) one.
          if (transformFile && showTransformFileField(key)) {
            sourceList[key].transformFile = transformFile;
          }
        }
      });
      const args: MultiCamImportFolderArgs = {
        datasetName: datasetName.value.trim(),
        defaultDisplay: defaultDisplay.value,
        cameraOrder: orderedCameraKeys.value,
        sourceList,
        calibrationFile: calibrationFile.value,
        type: props.dataType,
      };
      emit('begin-multicam-import', args);
    } else if (importType.value === 'keyword') {
      const args: MultiCamImportKeywordArgs = {
        defaultDisplay: defaultDisplay.value,
        sourcePath: keywordFolder.value,
        globList: globList.value,
        calibrationFile: calibrationFile.value,
        type: 'image-sequence',
      };
      emit('begin-multicam-import', args);
    }
  };

  const datasetNameRules = [
    (val: string) => (val || '').trim().length > 0 || 'Dataset name is required',
  ];

  function syncSuggestedDatasetNameFromCameraPaths() {
    if (importType.value !== 'multi') {
      return;
    }
    const paths = Object.values(folderList.value)
      .map((entry) => entry.sourcePath)
      .filter((path) => path);
    const label = parentFolderLabelFromAbsolutePaths(paths);
    if (label && !datasetName.value.trim()) {
      datasetName.value = label;
    }
  }

  function clearCalibration() {
    calibrationFile.value = '';
  }

  function applyLastCalibration() {
    if (!lastCalibrationPath.value) {
      return;
    }
    calibrationFile.value = lastCalibrationPath.value;
    calibrationAutoDiscoveryFailed.value = false;
  }

  function subfolderSourceDisplayLabel(
    sourcePath: string,
    folderName: string,
    files: File[] = [],
  ): string {
    if (props.dataType === VideoType) {
      return subfolderVideoDisplayLabel(sourcePath, folderName, files);
    }
    return folderName;
  }

  /**
   * Auto-attach the DIVE camera-calibration .json files found in the parent
   * folder root as the import's transform files (desktop multicam subfolder
   * imports only). A per-camera calibration_<camera>.json is attached to its
   * matching camera slot; any other self-identified calibration file goes to
   * the first free camera after the reference -- the file's pairs name their
   * own cameras, so which slot carries it doesn't matter. Each shows in that
   * camera's (clearable) transform field.
   */
  async function discoverParentFolderTransform(parentPath: string) {
    if (!transformImportEnabled.value || !findParentFolderTransformFiles) {
      return;
    }
    const discovered = await findParentFolderTransformFiles(parentPath);
    discovered.forEach((filePath) => {
      const fileName = filePath.replace(/^.*[\\/]/, '');
      const cameraMatch = /^calibration_(.+)\.json$/i.exec(fileName);
      let target: string | undefined;
      if (cameraMatch && folderList.value[cameraMatch[1]]) {
        target = !folderList.value[cameraMatch[1]].transformFile ? cameraMatch[1] : undefined;
      } else {
        target = orderedCameraKeys.value.find(
          (key, index) => index > 0 && folderList.value[key] && !folderList.value[key].transformFile,
        );
      }
      if (target) {
        folderList.value[target].transformFile = filePath;
      }
    });
  }

  async function discoverParentFolderCalibration(
    parentPath: string,
    fileList?: File[],
    root?: string,
  ) {
    if (!props.stereo) {
      return;
    }
    let discoveredPath: string | null = null;
    let discoveredFile: File | undefined;
    if (fileList?.length) {
      const found = findStereoCalibrationInFileList(fileList, root || parentPath, commonPathPrefix);
      if (found) {
        discoveredPath = found.path;
        discoveredFile = found.file;
      }
    } else if (findParentFolderCalibrationFile) {
      discoveredPath = await findParentFolderCalibrationFile(parentPath);
    }
    if (!discoveredPath) {
      calibrationAutoDiscoveryFailed.value = true;
      return;
    }
    calibrationAutoDiscoveryFailed.value = false;
    calibrationFile.value = discoveredPath;
    if (discoveredFile && stashCalibrationFile) {
      stashCalibrationFile(discoveredPath, discoveredFile);
    }
  }

  return {
    importType,
    folderList,
    keywordFolder,
    pendingImportPayloads,
    globList,
    filteredImages,
    calibrationFile,
    lastCalibrationFileName,
    calibrationAutoDiscoveryFailed,
    showLastCalibrationSuggestion,
    applyLastCalibration,
    defaultDisplay,
    displayKeys,
    displayKeysKey,
    orderedCameraKeys,
    camerasReady,
    canMoveCamera,
    moveCamera,
    importAnnotationFilesCheck,
    inferFrameIndexFromFilename,
    parentFolderName,
    subfolderLayoutLabel,
    subfolderOriginalNames,
    datasetName,
    datasetNameRules,
    errorMessage,
    nextSteps,
    showFinalizeStep,
    open,
    openParentFolder,
    prepForImport,
    addNewSet,
    clearCameraSet,
    deleteSet,
    onRenameCamera,
    openAnnotationFile,
    transformImportEnabled,
    showTransformFileField,
    openTransformFile,
    clearTransformFile,
    clearCalibration,
  };
}
