import {
  ref, watch, Ref, nextTick,
} from 'vue';

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
  selectNext?: (delta: number) => void;
}) {
  const virtualList = ref(null as null | Vue);

  function scrollTo(id: AnnotationId | null): void {
    if (id !== null && virtualList.value !== null) {
      const annotation = getAnnotation(id);
      if (annotation) {
        const offset = filteredListRef.value.findIndex(
          (filtered) => filtered.annotation.id === id,
        );
        const scrollEl = virtualList.value.$el;
        if (offset === -1) {
          scrollEl.scrollTop = 0;
        } else {
          // try to show the selected track as the third track in the list
          scrollEl.scrollTop = Math.max(0, (offset * itemHeight) - (2 * itemHeight));
        }
        // Programmatic scrollTop does not always emit a scroll event.
        const { onScroll } = virtualList.value as Vue & { onScroll?: () => void };
        if (typeof onScroll === 'function') {
          onScroll();
        }
      }
    }
  }

  function scrollToSelected(): void {
    if (selectedIdRef.value !== null) {
      nextTick(() => scrollTo(selectedIdRef.value));
    } else if (multiSelectList.value.length >= 1) {
      nextTick(() => scrollTo(multiSelectList.value[0]));
    }
  }

  // If we mount with selected we scroll to it automatically
  scrollToSelected();

  function scrollPreventDefault(
    _element: HTMLElement,
    keyEvent: KeyboardEvent,
    direction: 'up' | 'down',
  ): void {
    if (selectNext && filteredListRef.value.length > 0) {
      selectNext(direction === 'up' ? -1 : 1);
    }
    keyEvent.preventDefault();
  }

  watch(selectedIdRef, (id) => {
    nextTick(() => scrollTo(id));
  });
  watch(filteredListRef, scrollToSelected);
  watch(multiSelectList, scrollToSelected);

  return {
    virtualList,
    scrollTo,
    scrollToSelected,
    scrollPreventDefault,
  };
}
