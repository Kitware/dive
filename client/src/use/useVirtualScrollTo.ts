import { ref, watch, Ref } from '@vue/composition-api';
import Vue from 'vue';

import type Group from '../Group';
import type Track from '../track';
import type { AnnotationId } from '../BaseAnnotation';
import type { AnnotationWithContext } from '../BaseFilterControls';

export default function useVirtualScrollTo({
  itemHeight,
  getAnnotation,
  filteredListRef,
  selectedIdRef,
  multiSelectList,
  selectNext,
}: {
  itemHeight: Readonly<number>;
  getAnnotation: (id: AnnotationId) => Track | Group | undefined;
  filteredListRef: Ref<AnnotationWithContext<Track | Group>[]>;
  selectedIdRef: Ref<Readonly<AnnotationId | null>>;
  multiSelectList: Ref<Readonly<AnnotationId[]>>;
  selectNext: (id: AnnotationId) => void;
}) {
  const virtualList = ref(null as null | Vue);

  function scrollTo(id: AnnotationId | null): void {
    if (id !== null && virtualList.value !== null) {
      const annotation = getAnnotation(id);
      if (annotation) {
        const offset = filteredListRef.value.findIndex(
          (filtered) => filtered.annotation.id === id,
        );
        if (offset === -1) {
          virtualList.value.$el.scrollTop = 0;
        } else {
          // try to show the selected track as the third track in the list
          virtualList.value.$el.scrollTop = (offset * itemHeight) - (2 * itemHeight);
        }
      }
    }
  }

  function scrollToSelected(): void {
    if (selectedIdRef.value !== null) {
      Vue.nextTick(() => scrollTo(selectedIdRef.value));
    } else if (multiSelectList.value.length >= 1) {
      Vue.nextTick(() => scrollTo(multiSelectList.value[0]));
    }
  }

  // If we mount with selected we scroll to it automatically
  scrollToSelected();

  function scrollPreventDefault(
    element: HTMLElement,
    keyEvent: KeyboardEvent,
    direction: 'up' | 'down',
  ): void {
    if (virtualList.value !== null && element === virtualList.value.$el) {
      if (direction === 'up') {
        selectNext(-1);
      } else if (direction === 'down') {
        selectNext(1);
      }
      keyEvent.preventDefault();
    }
  }

  watch(selectedIdRef, scrollTo);
  watch(filteredListRef, scrollToSelected);
  watch(multiSelectList, scrollToSelected);

  return {
    virtualList,
    scrollTo,
    scrollToSelected,
    scrollPreventDefault,
  };
}
