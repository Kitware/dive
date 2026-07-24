/// <reference types="vitest" />

import { isFrameMetadataReadableName } from './readability';

describe('isFrameMetadataReadableName', () => {
  it.each([
    ['frame-metadata.csv', true],
    ['FLIGHT_LOG.CSV', true],
    ['notes.txt', true],
    ['notes.TxT', true],
    ['flight_log.json', false],
    ['telemetry.yml', false],
    ['csv', false],
    ['archive.csv.zip', false],
    ['dir.csv/notes.json', false],
  ])('reads %s: %s', (name, expected) => {
    expect(isFrameMetadataReadableName(name)).toBe(expected);
  });
});
