import EditAnnotationLayer from './EditAnnotationLayer';
import type { EditAnnotationTypes } from './EditAnnotationLayer';
import LineLayer from './AnnotationLayers/LineLayer';
import PointLayer from './AnnotationLayers/PointLayer';
import PolygonLayer from './AnnotationLayers/PolygonLayer';
import RectangleLayer from './AnnotationLayers/RectangleLayer';
import TextLayer from './AnnotationLayers/TextLayer';

type VisibleAnnotationTypes = EditAnnotationTypes | 'text' | 'tooltip' | 'TrackTail';

export {
  EditAnnotationLayer,
  EditAnnotationTypes,
  LineLayer,
  PointLayer,
  PolygonLayer,
  RectangleLayer,
  TextLayer,
  VisibleAnnotationTypes,
};
