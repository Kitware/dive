/**
 * A recipe is a macro for annotation automation that changes the
 * annotator state and adds or removes geometry while the recipe is active.
 *
 * Recipes can be activated by hotkeys or UI externally.
 * Recipes will generally deactivate themselves when the recipe is complete.
 *
 * Examples:
 *
 * Drawing a head-tail line for fish.
 *   User activates recipe
 *   Recipe puts editor into line creation mode
 *   User clicks starting point
 *   EditAnnotationLayer emits the point creation event.
 *   Recipe records event.
 *   User clicks ending point
 *   EditAnnotationLayer emits the point creation event.
 *   Recipe ends the Line annotation creation process.
 */

import Track from './track';
import { EditAnnotationTypes } from './layers/EditAnnotationLayer';

export interface RecipeUpdateCallbackArgs {
  newMode?: 'editing' | 'creation';
  newType?: EditAnnotationTypes;
  newSelectedKey?: string;
}

export default interface Recipe {
  update: (
    frameNum: number,
    track: Track,
    key: string,
    data: GeoJSON.Polygon | GeoJSON.LineString,
    callback: (args: RecipeUpdateCallbackArgs) => void) => boolean;
};
