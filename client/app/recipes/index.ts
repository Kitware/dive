import Recipe from 'vue-media-annotator/recipe';

import PolygonBase from './polygonbase';
import HeadTail from './headtail';

export interface RecipeMapEntry {
  toggleable: boolean;
  id: string;
  icon?: string;
  recipe: Recipe;
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
    },
    [poly.name]: {
      toggleable: false,
      id: poly.name,
      recipe: poly,
    },
  };
}
