import {
  Ref, ref, watch, reactive, toRefs,
} from '@vue/composition-api';

export type AnnotationState = 'enabled' | 'disabled' | 'selected';
export type AnnotationTypes = 'rectangle' | 'polygon' | 'line' | 'point';
export interface AnnotationDisplay {
  id: AnnotationTypes;
  title: string;
  icon: string;
  state?: AnnotationState;
}

export interface EditorSettings {
  mode: Ref<'visible' | 'editing'>;
  helpMode: Ref<'visible' | 'editing' | 'creation'>;
  display: Ref<AnnotationDisplay[]>;
  states: Ref<{
    visible: Record<AnnotationTypes, AnnotationState>;
    editing: Record<AnnotationTypes, AnnotationState>;
  }>;
  selectedIndex: Ref<number>;
}

export default function useAnnotationMode({ editingTrack }: { editingTrack: Ref<boolean> }) {
  const annotationUpdate: Ref<boolean> = ref(false); //signal to update annotation

  const annotationModes = reactive({
    mode: 'visible',
    helpMode: 'visible',
    display: [
      { id: 'rectangle', title: 'Bounds', icon: 'mdi-vector-square' },
      { id: 'polygon', title: 'Polygon', icon: 'mdi-vector-polygon' },
      { id: 'line', title: 'Lines', icon: 'mdi-vector-line' },
      { id: 'point', title: 'Points', icon: 'mdi-vector-point' },

    ],
    states: {
      visible: {
        rectangle: 'selected',
        polygon: 'selected',
        point: 'selected',
        line: 'selected',
      },
      editing: {
        rectangle: 'selected',
        polygon: 'enabled',
        point: 'enabled',
        line: 'enabled',
      },
    },
    selectedIndex: -1,
  });

  function handleSetSelectedIndex(index: number) {
    annotationModes.selectedIndex = index;
  }

  function updateAnnotationMode({ mode, type, annotState }:
    {mode: 'visible' | 'editing'; type: AnnotationTypes; annotState: AnnotationState }) {
    //Depending on the current mode we update the state
    annotationModes.mode = mode;
    if (annotationModes.mode === 'visible') {
      annotationModes.states[mode][type] = annotState;
    } else if (annotationModes.mode === 'editing') {
      //Only one can be active at a time:
      (Object.keys(annotationModes.states.editing) as AnnotationTypes[]).forEach((key) => {
        annotationModes.states.editing[key] = 'enabled';
      });
      annotationModes.states[mode][type] = annotState;
    }
    annotationUpdate.value = !annotationUpdate.value;
  }
  function updateAnnotationHelpMode(helpMode: 'visible' | 'editing' | 'creation') {
    annotationModes.helpMode = helpMode;
  }
  watch(editingTrack, (newval: boolean) => {
    if (newval) {
      annotationModes.mode = 'editing';
    } else {
      annotationModes.mode = 'visible';
      annotationModes.helpMode = 'visible';
    }
  });
  return {
    setSelectedIndex: handleSetSelectedIndex,
    annotationModes: toRefs(annotationModes),
    annotationUpdate,
    updateAnnotationMode,
    updateAnnotationHelpMode,
  };
}
