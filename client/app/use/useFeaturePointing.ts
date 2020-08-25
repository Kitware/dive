import { Ref } from '@vue/composition-api';
import Track, { TrackId } from 'vue-media-annotator/track';
import { findBounds, updateBounds } from 'vue-media-annotator/utils';

export type FeaturePointingTarget = 'head' | 'tail' | null;

export default function useFeaturePointing({
  selectedTrackId,
  trackMap,
  selectTrack,
  frame,
}: {
  selectedTrackId: Ref<TrackId | null>;
  trackMap: Map<TrackId, Track>;
  selectTrack: (trackId: TrackId | null, edit: boolean) => void;
  frame: Ref<number>;
}) {
  /** removing the entire HeadTails or one of the points */
  function removeHeadTails(frameNum: number, track: Track, index: number) {
    selectTrack(track.trackId, false);
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
  /**
   * When creating a HeadTails Line this will update the individual points
   * or creating a line if we have both points available
   */
  function updateHeadTails(
    frameNum: number,
    track: Track,
    interpolate: boolean,
    key: string,
    data: GeoJSON.Feature<GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString>,
  ) {
    //Update the Head and Tails points as well
    if (data.geometry.type === 'LineString' && key === 'HeadTails') {
      const { coordinates } = data.geometry;

      const geoJSONPointHead: GeoJSON.Point = {
        type: 'Point',
        coordinates: coordinates[0],
      };
      track.setFeature({
        frame: frameNum,
        keyframe: true,
        interpolate,
      },
      [{
        type: 'Feature',
        geometry: geoJSONPointHead,
        properties: {
          key: 'head',
        },
      }]);
      const geoJSONPointTail: GeoJSON.Point = {
        type: 'Point',
        coordinates: coordinates[1],
      };
      track.setFeature({
        frame: frameNum,
        keyframe: true,
        interpolate,
      },
      [{
        type: 'Feature',
        geometry: geoJSONPointTail,
        properties: {
          key: 'tail',
        },
      }]);
    } else if (data.geometry.type === 'Point') {
      //So now we have to add the Line if both points exist
      const coordinates: GeoJSON.Position[] = [];
      coordinates.push(data.geometry.coordinates);
      if (key === 'head') {
        const tail = track.getFeatureGeometry(frameNum, {
          type: 'Point',
          key: 'tail',
        });
        if (tail.length) {
          coordinates.push(tail[0].geometry.coordinates as GeoJSON.Position);
        }
      } else if (key === 'tail') {
        const head = track.getFeatureGeometry(frameNum, {
          type: 'Point',
          key: 'head',
        });
        if (head.length) {
          coordinates.unshift(head[0].geometry.coordinates as GeoJSON.Position);
        }
      }
      //Now we add the headTails item if the two points exist
      if (coordinates.length === 2) {
        const { features } = track.canInterpolate(frameNum);
        const [real] = features;
        //Update bounds based on type and condition of the updated bounds
        let oldBounds;
        if (real) {
          oldBounds = real.bounds;
        }

        const lineData: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates,
          },
          properties: {
            key: 'HeadTails',
          },
        };
        const newbounds = findBounds(lineData);
        const updatedBounds = updateBounds(oldBounds, newbounds, lineData);
        track.setFeature(
          {
            frame: frameNum,
            bounds: updatedBounds,
            keyframe: true,
            interpolate,
          },
          [lineData],
        );
      }
    }
  }


  function handleRemoveFeaturePoint() {
    if (selectedTrackId.value !== null) {
      const track = trackMap.get(selectedTrackId.value);
      if (track) {
        removeHeadTails(frame.value, track, -1);
      }
    }
  }

  return {
    handleRemoveFeaturePoint,
    removeHeadTails,
    updateHeadTails,
  };
}
