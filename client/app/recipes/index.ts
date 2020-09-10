import Recipe from 'vue-media-annotator/recipe';
import { EditAnnotationTypes } from 'vue-media-annotator/layers/EditAnnotationLayer';

import PolygonBase from './polygonbase';
import HeadTail, { HeadTailLineKey } from './headtail';

export interface RecipeMapEntry {
  toggleable: boolean;
  id: string;
  icon?: string;
  recipe: Recipe;
  key: string;
  editing: EditAnnotationTypes;
}

export default function get(): Record<string, RecipeMapEntry> {
  const ht = new HeadTail() as Recipe;
  const poly = new PolygonBase() as Recipe;
  return {
    [ht.name]: {
      toggleable: true,
      id: ht.name,
      icon: 'mdi-fish',
      recipe: ht,
      editing: 'LineString',
      key: HeadTailLineKey,
    },
    [poly.name]: {
      toggleable: false,
      id: poly.name,
      recipe: poly,
      editing: 'Polygon',
      key: '',
    },
  };
}
