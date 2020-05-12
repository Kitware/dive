import {
  ref, computed, inject, watchEffect,
} from '@vue/composition-api';

const ImageSequenceType = 'image-sequence';
const VideoType = 'video';
const defaultFrameRate = 30;

export default function useGirderDataset() {
  const girderRest = inject('girderRest');

  const dataset = ref(null);
  const imageUrls = ref([]);
  const videoUrl = ref(null);

  const frameRate = computed(() => (dataset.value && dataset.value.meta.fps) || defaultFrameRate);

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

  // set imageUrls or videoUrl depending on dataset type
  watchEffect(async () => {
    const _dataset = dataset.value;
    if (!_dataset) {
      return;
    }
    if (_dataset.meta.type === VideoType) {
      // Video type annotator
      const { data: clipMeta } = await girderRest.get(
        'viame_detection/clip_meta',
        {
          params: { folderId: _dataset._id },
        },
      );
      if (!clipMeta.videoUrl) {
        // TODO: better error handling
        throw new Error('Expected clip_meta.video, but was empty.');
      }
      videoUrl.value = clipMeta.videoUrl;
    } else if (_dataset.meta.type === ImageSequenceType) {
      // Image Sequence type annotator
      const { data: items } = await girderRest.get('item', {
        // TODO: what if there are more than 200K?
        params: { folderId: _dataset._id, limit: 200000 },
      });
      imageUrls.value = items
        .filter((item) => {
          const name = item.name.toLowerCase();
          return (
            name.endsWith('png')
            || name.endsWith('jpeg')
            || name.endsWith('jpg')
          );
        })
        .map((item) => `api/v1/item/${item._id}/download`);
    } else {
      throw new Error(`Unable to load media for dataset type: ${_dataset.meta.type}`);
    }
  });

  async function loadDataset(datasetId) {
    const { data } = await girderRest.get(`folder/${datasetId}`);
    if (!data) {
      throw new Error(`could not fetch dataset for id ${datasetId}`);
    }
    dataset.value = data;
  }

  return {
    dataset,
    frameRate,
    annotatorType,
    imageUrls,
    videoUrl,
    loadDataset,
  };
}
