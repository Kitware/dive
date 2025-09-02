import Vue, { ref, watch, Ref } from 'vue';

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
  trackSelect,
}: {
  itemHeight: Readonly<number>;
  getAnnotation: (id: AnnotationId) => Track | Group | undefined;
  filteredListRef: Ref<AnnotationWithContext<Track | Group>[]>;
  selectedIdRef: Ref<Readonly<AnnotationId | null>>;
  multiSelectList: Ref<Readonly<AnnotationId[]>>;
  trackSelect: (id: AnnotationId | null, edit: boolean, modifiers?: { ctrl: boolean }) => void;
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
      if (filteredListRef.value.length === 0) {
        return;
      }
      const index = filteredListRef.value.findIndex((item) => item.annotation.id === selectedIdRef.value);
      if (index === -1 && direction === 'up') {
        const newId = filteredListRef.value[filteredListRef.value.length - 1].annotation.id;
        trackSelect(newId, false);
      } else if (index === -1 && direction === 'down') {
        const newId = filteredListRef.value[0].annotation.id;
        trackSelect(newId, false);
      } else if (direction === 'up') {
        if (index > 0) {
          trackSelect(filteredListRef.value[index - 1].annotation.id, false);
        } else {
          const newId = filteredListRef.value[filteredListRef.value.length - 1].annotation.id;
          trackSelect(newId, false);
        }
      } else if (direction === 'down') {
        if (index === filteredListRef.value.length - 1) {
          trackSelect(filteredListRef.value[0].annotation.id, false);
        } else {
          const newId = filteredListRef.value[index + 1].annotation.id;
          trackSelect(newId, false);
        }
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
