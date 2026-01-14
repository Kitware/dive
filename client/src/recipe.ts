/**
 * A recipe is a macro for annotation automation that changes the
 * annotator state and adds or removes geometry while the recipe is active.
 *
 * Recipes can be activated by hotkeys or UI externally.
 * Recipes will usually deactivate themselves when the recipe is complete.
 */
import { Ref } from 'vue';

import { Mousetrap } from './types';
import Track from './track';
import { EditAnnotationTypes } from './layers/EditAnnotationLayer';

export interface UpdateResponse {
  data: Record<
    string,
    GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>[]
  >;
  union: GeoJSON.Polygon[] | [];
  unionWithoutBounds: GeoJSON.Polygon[];
  done?: boolean;
  newType?: EditAnnotationTypes;
  newSelectedKey?: string;
}

interface Recipe {
  name: string;
  icon: Ref<string>;
  active: Ref<boolean>;
  toggleable: Ref<boolean>;
  bus: Vue;
  update: (
    mode: 'in-progress' | 'editing',
    frameNum: number,
    track: Track,
    data: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString | GeoJSON.Point>[],
    key?: string,
  ) => Readonly<UpdateResponse>;
  delete: (
    frame: number,
    t: Track,
    key: string,
    mode: EditAnnotationTypes,
  ) => void;
  deletePoint: (
    frame: number,
    t: Track,
    index: number,
    key: string,
    mode: EditAnnotationTypes,
  ) => void;
  activate: () => unknown;
  mousetrap: () => Mousetrap[];
  deactivate: () => void;
  /** Optional method to confirm/lock the current annotation (e.g., for segmentation) */
  confirm?: () => void;
}

export default Recipe;
