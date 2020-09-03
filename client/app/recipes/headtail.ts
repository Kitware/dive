import Track from 'vue-media-annotator/track';
import Recipe, { RecipeUpdateCallbackArgs } from 'vue-media-annotator/recipe';

export default class HeadTail implements Recipe {
  active: boolean;

  constructor() {
    this.active = true;
  }

  static remove(frameNum: number, track: Track, index: number) {
    track.removeFeatureGeometry(frameNum, {
      key: 'HeadTails',
      type: 'LineString',
    });
    if (index === -1 || index === 0) {
      track.removeFeatureGeometry(frameNum, {
        key: 'head',
        type: 'Point',
      });
    }
    if (index === -1 || index === 1) {
      track.removeFeatureGeometry(frameNum, {
        key: 'tail',
        type: 'Point',
      });
    }
  }

  update(
    frameNum: number,
    track: Track,
    key: string,
    data: GeoJSON.LineString | GeoJSON.Polygon,
    callback: (args: RecipeUpdateCallbackArgs) => void,
  ): boolean {
    const linestring = data as GeoJSON.LineString;
    if (this.active) {
      console.log(frameNum, track.trackId, key, data, this);
      if (linestring.coordinates.length === 2) {
        callback({
          newMode: 'editing',
          newType: 'Point',
        });
      }
    }
    return false;
  }

  // activate(track: Track) {

  // }

  // handleGeojsonUpdate() {

  // }

  // handleEditingGeojsonUpdate() {

  // }
}
