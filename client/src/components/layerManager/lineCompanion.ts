import { HeadPointKey, TailPointKey } from 'dive-common/recipes/headtail';
import type { FrameDataTrack } from '../../layers/LayerTypes';
import type { EditAnnotationTypes } from '../../layers/EditAnnotationLayer';

export interface LineCompanion {
  type: 'rectangle' | 'Point';
  key: string;
  tracks: FrameDataTrack[];
}

function lineAt(track: FrameDataTrack, key: string): boolean {
  return !!track.features?.geometry?.features.some((feature) => feature.geometry.type === 'LineString'
    && (feature.properties?.key ?? '') === key
    && feature.geometry.coordinates.length >= 2);
}

function pointKeys(track: FrameDataTrack): string[] {
  return (track.features?.geometry?.features ?? [])
    .filter((feature) => feature.geometry.type === 'Point'
      && [HeadPointKey, TailPointKey].includes(feature.properties?.key ?? ''))
    .map((feature) => feature.properties?.key as string);
}

/**
 * What the companion editor shows while the line tool is active: the box
 * corners of a track whose line exists, or the lone head/tail point of a
 * track that has one point and no line, so that point can be moved rather
 * than only extended into a line. Nothing for a track still being drawn.
 */
export default function lineCompanion(
  editingTrack: false | EditAnnotationTypes,
  rectanglesVisible: boolean,
  selectedKey: string,
  editingTracks: FrameDataTrack[],
): LineCompanion | null {
  if (editingTrack !== 'LineString') return null;
  const withLine = editingTracks.filter((track) => lineAt(track, selectedKey));
  if (withLine.length) {
    if (!rectanglesVisible) return null;
    const tracks = withLine.filter(({ features }) => !!features?.bounds);
    return tracks.length ? { type: 'rectangle', key: '', tracks } : null;
  }
  const single = editingTracks.filter((track) => pointKeys(track).length === 1);
  if (!single.length) return null;
  const [key] = pointKeys(single[0]);
  return { type: 'Point', key, tracks: single.filter((track) => pointKeys(track)[0] === key) };
}
