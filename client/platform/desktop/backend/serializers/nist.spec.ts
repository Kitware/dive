/// <reference types="jest" />
import fs from 'fs-extra';
import { NistFile, exportNist, convertNisttoJSON } from 'platform/desktop/backend/serializers/nist';
import { AnnotationSchema, MultiTrackRecord } from 'dive-common/apispec';
import { AnnotationsCurrentVersion } from 'platform/desktop/constants';

interface NistTestFile {
  inputTrackJSON: MultiTrackRecord;
  inputNistObjects: NistFile;
}
const testData: NistTestFile = fs.readJSONSync('../testutils/nist.spec.json');
const inputAnnotations: AnnotationSchema = {
  tracks: testData.inputTrackJSON,
  groups: {},
  version: AnnotationsCurrentVersion,
};

describe('NIST format testing', () => {
  it('testing exporting and importing NIST formats', async () => {
    const nistExported = await exportNist(inputAnnotations, 'testVideo.mp4');
    expect(nistExported).toEqual(testData.inputNistObjects);
    const output = await convertNisttoJSON(testData.inputNistObjects, 'testVideo.mp4', [0, 0, 1920, 1080]);
    expect(output.tracks).toEqual(testData.inputTrackJSON);
  });
});
