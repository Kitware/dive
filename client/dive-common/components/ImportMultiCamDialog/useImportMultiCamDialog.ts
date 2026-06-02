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
  isValidCameraName,
  organizeSubfolderCameras,
  pickDefaultMulticamCamera,
} from 'dive-common/components/ImportMultiCamDialog/multicamSubfolderLayout';
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
    listParentFolderCameras,
    resolveMulticamCameraSourcePath,
  } = useApi();
  const importType: Ref<MulticamImportType> = ref('');
  const folderList: Ref<Record<string, { sourcePath: string; trackFile: string }>> = ref({});
  const parentFolderName = ref('');
  const subfolderLayoutLabel = ref('');
  const keywordFolder = ref('');
  const pendingImportPayloads: Ref<Record<string, MediaImportResponse | null>> = ref({});
  const globList: Ref<Record<string, { glob: string; trackFile: string }>> = ref({});
  const calibrationFile = ref('');
  const datasetName = ref('');
  const subfolderOriginalNames: Ref<Record<string, string>> = ref({});
  const cameraOrder: Ref<string[]> = ref([]);
  const defaultDisplay = ref('left');
  const importAnnotationFilesCheck = ref(false);
  const { error: importError, request: importRequest } = useRequest();

  onMounted(async () => {
    if (props.stereo && getLastCalibration) {
      const lastCalibration = await getLastCalibration();
      if (lastCalibration) {
        calibrationFile.value = lastCalibration;
      }
    }
  });

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
    subfolderOriginalNames.value = {};
    cameraOrder.value = [];
    defaultDisplay.value = props.stereo ? 'left' : 'center';
    if (props.stereo && importType.value === 'multi') {
      folderList.value = {
        left: { sourcePath: '', trackFile: '' },
        right: { sourcePath: '', trackFile: '' },
      };
      globList.value = {
        left: { glob: '', trackFile: '' },
        right: { glob: '', trackFile: '' },
      };
    } else {
      folderList.value = {};
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
    }
  };
  clearCameraSet();

  if (props.dataType === VideoType) {
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
        Vue.set(subfolderOriginalNames.value, cameraName, organized.assignments[i].folderName);
        Vue.set(folderList.value, cameraName, { sourcePath, trackFile: '' });
        // eslint-disable-next-line no-await-in-loop -- import each camera media sequentially
        const mediaPayload = await props.importMedia(sourcePath);
        Vue.set(pendingImportPayloads.value, cameraName, mediaPayload);
      }
      defaultDisplay.value = pickDefaultMulticamCamera(
        registryPayload.map((item) => item.cameraName),
        { preferLeftForStereo: props.stereo },
      );
      syncDefaultDisplay();
    });
  }

  function renameCamera(oldKey: string, newName: string) {
    const newKey = (typeof newName === 'string' ? newName : '').trim();
    if (!newKey || newKey === oldKey) {
      return;
    }
    if (!isValidCameraName(newKey)) {
      throw new Error('Camera name must be letters and numbers only');
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

  async function openAnnotationFile(folder: string) {
    const ret = await openFromDisk('annotation');
    if (!ret.canceled) {
      if (ret.filePaths?.length) {
        const path = ret.filePaths[0];
        folderList.value[folder].trackFile = path;
      }
    }
  }

  async function open(dstype: DatasetType | 'calibration' | 'text', folder: string | 'calibration') {
    const ret = await openFromDisk(dstype, dstype === 'image-sequence');
    if (!ret.canceled) {
      const path = ret.filePaths[0];
      if (folder === 'calibration') {
        calibrationFile.value = path;
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
        const { sourcePath } = folderList.value[folder];
        Vue.set(
          pendingImportPayloads.value,
          folder,
          await importRequest(() => props.importMedia(sourcePath)),
        );
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
      Vue.set(folderList.value, name, { sourcePath: '', trackFile: '' });
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
          sourceList[key] = folderList.value[key];
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

  return {
    importType,
    folderList,
    keywordFolder,
    pendingImportPayloads,
    globList,
    filteredImages,
    calibrationFile,
    defaultDisplay,
    displayKeys,
    displayKeysKey,
    orderedCameraKeys,
    camerasReady,
    canMoveCamera,
    moveCamera,
    importAnnotationFilesCheck,
    parentFolderName,
    subfolderLayoutLabel,
    subfolderOriginalNames,
    datasetName,
    datasetNameRules,
    errorMessage,
    nextSteps,
    open,
    openParentFolder,
    prepForImport,
    addNewSet,
    clearCameraSet,
    deleteSet,
    onRenameCamera,
    openAnnotationFile,
  };
}
