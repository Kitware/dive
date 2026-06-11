import {
  nextTick, ref, watch, type ComponentPublicInstance, type Ref,
} from 'vue';

import type Group from '../Group';
import type Track from '../track';
import type { AnnotationId } from '../BaseAnnotation';
import type { AnnotationWithContext } from '../BaseFilterControls';

type VirtualListInstance = ComponentPublicInstance & { onScroll?: () => void };

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
  const virtualList = ref<VirtualListInstance | null>(null);

  function scrollTo(id: AnnotationId | null): void {
    if (id !== null && virtualList.value !== null) {
      const annotation = getAnnotation(id);
      if (annotation) {
        const offset = filteredListRef.value.findIndex(
          (filtered) => filtered.annotation.id === id,
        );
        const scrollEl = virtualList.value.$el as HTMLElement;
        if (offset === -1) {
          scrollEl.scrollTop = 0;
        } else {
          scrollEl.scrollTop = Math.max(0, (offset * itemHeight) - (2 * itemHeight));
        }
        if (typeof virtualList.value.onScroll === 'function') {
          virtualList.value.onScroll();
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
