// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import { describe, expect, it } from 'vitest';

import suggestUploadSlots from './uploadSlots';

function file(name: string): File {
  return new File([name], name, { type: 'application/octet-stream' });
}

function accountedNames(slots: ReturnType<typeof suggestUploadSlots>): string[] {
  return [
    ...slots.mediaList.map((f) => f.name),
    ...(slots.annotationFile ? [slots.annotationFile.name] : []),
    ...(slots.configFile ? [slots.configFile.name] : []),
    ...(slots.metadataFile ? [slots.metadataFile.name] : []),
    ...slots.unslotted.map((entry) => entry.name),
  ].sort();
}

describe('suggestUploadSlots', () => {
  it('routes a reserved-name attachment to the metadata slot, images to media', () => {
    const slots = suggestUploadSlots([file('img001.png'), file('img002.png'), file('frame-metadata.csv')]);
    expect(slots.mediaList.map((f) => f.name)).toEqual(['img001.png', 'img002.png']);
    expect(slots.metadataFile?.name).toBe('frame-metadata.csv');
    expect(slots.annotationFile).toBeNull();
    expect(slots.configFile).toBeNull();
    expect(slots.unslotted).toEqual([]);
  });

  it('reports extra reserved-name attachments instead of failing the whole selection', () => {
    const slots = suggestUploadSlots([
      file('img001.png'),
      file('frame-metadata.csv'),
      file('frame_metadata.json'),
    ]);
    expect(slots.metadataFile?.name).toBe('frame-metadata.csv');
    expect(slots.unslotted).toEqual([
      { name: 'frame_metadata.json', reason: 'Only one metadata file can be uploaded per dataset' },
    ]);
  });

  it('suggests a single annotation CSV and keeps it out of the media slot', () => {
    const slots = suggestUploadSlots([file('img001.png'), file('tracks.csv')]);
    expect(slots.mediaList.map((f) => f.name)).toEqual(['img001.png']);
    expect(slots.annotationFile?.name).toBe('tracks.csv');
  });

  it('detects a config JSON alongside an annotation CSV', () => {
    const slots = suggestUploadSlots([file('img001.png'), file('tracks.csv'), file('dataset.meta.json')]);
    expect(slots.configFile?.name).toBe('dataset.meta.json');
    expect(slots.annotationFile?.name).toBe('tracks.csv');
    expect(slots.mediaList.map((f) => f.name)).toEqual(['img001.png']);
  });

  it('leaves a second CSV unslotted rather than in the media slot the server rejects', () => {
    // A second CSV in the media slot makes server validation fail outright ("Can only upload a
    // single CSV Annotation per import"), which blocks the whole selection. Report it instead.
    const slots = suggestUploadSlots([file('img001.png'), file('tracks.csv'), file('nav_2024.csv')]);
    expect(slots.mediaList.map((f) => f.name)).toEqual(['img001.png']);
    expect(slots.annotationFile?.name).toBe('tracks.csv');
    expect(slots.unslotted).toEqual([
      { name: 'nav_2024.csv', reason: 'Only one annotation file can be uploaded per dataset' },
    ]);
  });

  it('reports a second configuration JSON rather than sending both to validation', () => {
    const slots = suggestUploadSlots([
      file('img001.png'), file('a.meta.json'), file('b.config.json'),
    ]);
    expect(slots.configFile?.name).toBe('a.meta.json');
    expect(slots.annotationFile).toBeNull();
    expect(slots.mediaList.map((f) => f.name)).toEqual(['img001.png']);
    expect(slots.unslotted).toEqual([
      { name: 'b.config.json', reason: 'Only one configuration file can be uploaded per dataset' },
    ]);
  });

  it('slots a lone YAML annotation instead of leaving it to look like media', () => {
    const slots = suggestUploadSlots([file('video.mp4'), file('tracks.yml')]);
    expect(slots.mediaList.map((f) => f.name)).toEqual(['video.mp4']);
    expect(slots.annotationFile?.name).toBe('tracks.yml');
  });

  it('never silently drops any picked file (every input is slotted or reported)', () => {
    const picked = [
      file('img001.png'), file('img002.png'),
      file('tracks.csv'), file('extra.csv'),
      file('dataset.meta.json'), file('other.json'),
      file('frame-metadata.txt'), file('nav.unknown'),
    ];
    const slots = suggestUploadSlots(picked);
    expect(accountedNames(slots)).toEqual(picked.map((f) => f.name).sort());
  });
});
