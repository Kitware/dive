export interface AnnotationMenuSignals {
    type: 'toggleKeyFrame'; // Oring the signals
    data?: null; // Data for different signals
  }
  //Props for this component when rendering
export interface AnnotationMenuProps{
    visible: boolean;
    keyframe?: boolean;
    color?: string;
  }
