import { GirderModel } from '@girder/components/src';
import {
  ref, computed, watchEffect,
} from '@vue/composition-api';
import { CustomStyle } from 'vue-media-annotator/use/useStyling';

import { getFolder, getItemDownloadUri } from 'app/api/girder.service';
import { getValidWebImages } from 'app/api/viame.service';
import { getClipMeta } from 'app/api/viameDetection.service';
import { ImageSequenceType, VideoType } from 'app/constants';

const defaultFrameRate = 30;

interface VIAMEDataset extends GirderModel {
  meta: {
    type: 'video' | 'image-sequence';
    fps: number;
    customTypeStyling?: Record<string, CustomStyle>;
    confidenceFilters?: Record<string, number>;
  };
}

interface FrameImage {
  url: string;
  filename: string;
}

export default function useGirderDataset() {
  const dataset = ref(null as VIAMEDataset | null);
  const imageData = ref([] as FrameImage[]);
  const videoUrl = ref('');
  const frameRate = computed(() => (dataset.value && dataset.value.meta.fps as number)
    || defaultFrameRate);

  const annotatorType = computed(() => {
    if (!dataset.value) {
      return null;
    } if (dataset.value.meta.type === VideoType) {
      return 'VideoAnnotator';
    } if (dataset.value.meta.type === ImageSequenceType) {
      return 'ImageAnnotator';
    }
    throw new Error(`Unknown dataset type: ${dataset.value.meta.type}`);
  });

  // set imageData or videoUrl depending on dataset type
  watchEffect(async () => {
    const _dataset = dataset.value;
    if (!_dataset) {
      return;
    }
    if (_dataset.meta.type === VideoType) {
      // Video type annotator
      const clipMeta = await getClipMeta(_dataset._id);
      if (!clipMeta.videoUrl) {
        // TODO: better error handling
        throw new Error('Expected clipMeta.videoUrl, but was empty.');
      }
      videoUrl.value = clipMeta.videoUrl;
    } else if (_dataset.meta.type === ImageSequenceType) {
      // Image Sequence type annotator
      const items = await getValidWebImages(_dataset._id);
      imageData.value = items.map((item) => ({
        url: getItemDownloadUri(item._id),
        filename: item.name,
      }
      ));
    } else {
      throw new Error(`Unable to load media for dataset type: ${_dataset.meta.type}`);
    }
  });

  async function loadDataset(datasetId: string) {
    const folder = await getFolder(datasetId) as VIAMEDataset;
    if (!folder) {
      throw new Error(`could not fetch dataset for id ${datasetId}`);
    }
    dataset.value = folder;
    return dataset.value;
  }

  return {
    dataset,
    frameRate,
    annotatorType,
    imageData,
    videoUrl,
    loadDataset,
  };
}
