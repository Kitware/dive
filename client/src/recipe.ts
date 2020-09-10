/**
 * A recipe is a macro for annotation automation that changes the
 * annotator state and adds or removes geometry while the recipe is active.
 *
 * Recipes can be activated by hotkeys or UI externally.
 * Recipes will usually deactivate themselves when the recipe is complete.
 */
import { Ref } from '@vue/composition-api';

import Track from './track';
import { EditAnnotationTypes } from './layers/EditAnnotationLayer';

export interface UpdateResponse {
  data: Record<
    string,
    GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>[]
  >;
  union: GeoJSON.Polygon[];
  unionWithoutBounds: GeoJSON.Polygon[];
  newMode?: 'editing' | 'creation';
  newType?: EditAnnotationTypes;
  newSelectedKey?: string;
}

interface Recipe {
  name: string;
  update: (
    mode: 'in-progress' | 'editing',
    frameNum: number,
    track: Track,
    data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>[],
    key?: string,
  ) => Readonly<UpdateResponse>;
  activate: () => void;
  deactivate: () => void;
  active: Ref<boolean>;
}


export default Recipe;
