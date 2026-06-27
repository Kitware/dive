import { computed, Ref } from 'vue';

import { useSegmentationCursorLoading } from '../../provides';

export default function useAnnotatorImageCursor(
  imageCursor: Ref<string>,
  cursor: Ref<string>,
  imageCursorEditing: Ref<boolean>,
) {
  const segmentationCursorLoading = useSegmentationCursorLoading();
  const displayImageCursor = computed(
    () => (segmentationCursorLoading.value ? 'mdi-loading' : imageCursor.value),
  );
  const showEditBadge = computed(
    () => !segmentationCursorLoading.value && imageCursorEditing.value && !!imageCursor.value,
  );
  const playbackCursor = computed(
    () => (segmentationCursorLoading.value ? 'none' : cursor.value),
  );

  return {
    displayImageCursor,
    playbackCursor,
    segmentationCursorLoading,
    showEditBadge,
  };
}
