import type { FrameDataTrack } from '../../layers/LayerTypes';
import type { EditAnnotationTypes } from '../../layers/EditAnnotationLayer';

/**
 * Tracks whose box corners stay editable while their line is being edited.
 * A line still being drawn is excluded: hovering a box handle would strip the
 * line's creation actions from the map.
 */
export default function lineBoxCompanionTracks(
  editingTrack: false | EditAnnotationTypes,
  rectanglesVisible: boolean,
  selectedKey: string,
  editingTracks: FrameDataTrack[],
): FrameDataTrack[] {
  if (editingTrack !== 'LineString' || !rectanglesVisible) return [];
  return editingTracks.filter(({ features }) => !!features?.bounds
    && !!features.geometry?.features.some((feature) => feature.geometry.type === 'LineString'
      && (feature.properties?.key ?? '') === selectedKey
      && feature.geometry.coordinates.length >= 2));
}
