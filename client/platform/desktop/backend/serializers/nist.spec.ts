/// <reference types="jest" />
import fs from 'fs-extra';
import { NistFile, exportNist, convertNisttoJSON } from 'platform/desktop/backend/serializers/nist';
import { MultiTrackRecord } from 'dive-common/apispec';

interface NistTestFile {
    inputTrackJSON: MultiTrackRecord;
    outputNistJSON: NistFile;
    inputNistObjects: NistFile;
    nistToTracks: MultiTrackRecord;
}
const testData: NistTestFile = fs.readJSONSync('../testutils/nist.spec.json');

describe('NIST format testing', () => {
  it('testing exporting and importing NIST formats', async () => {
    const nistExported = await exportNist(testData.inputTrackJSON, 'testVideo.mp4');
    expect(nistExported).toEqual(testData.outputNistJSON);
    const tracksConverted = await convertNisttoJSON(testData.inputNistObjects, 'testVideo.mp4', [0, 0, 1920, 1080]);
    const multiTrackConverted: MultiTrackRecord = {};
    tracksConverted.tracks.forEach((track) => {
      multiTrackConverted[track.trackId] = track;
    });
    //expect(multiTrackConverted).toEqual(testData.inputTrackJSON);
  });
});
