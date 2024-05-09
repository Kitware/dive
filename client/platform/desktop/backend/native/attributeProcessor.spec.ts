/* eslint-disable quote-props */
/* eslint-disable @typescript-eslint/naming-convention */

import { MultiTrackRecord } from 'dive-common/apispec';
import { TrackData } from 'vue-media-annotator/track';
import type { Attribute } from 'vue-media-annotator/use/AttributeTypes';
import fs from 'fs-extra';
import processTrackAttributes from './attributeProcessor';

type AttributeTestGroup = [TrackData[], MultiTrackRecord, Record<string, Attribute>][];

const testData: AttributeTestGroup = fs.readJSONSync('../testutils/attributes.spec.json');

describe('native.attributeProcessor', () => {
  it('Testing Attributes', async () => {
    for (let i = 0; i < testData.length; i += 1) {
      const currentData = testData[i];
      const output = processTrackAttributes(Object.values(currentData[0]));
      expect(output.data).toStrictEqual(currentData[1]);
      expect(output.attributes).toStrictEqual(currentData[2]);
    }
  });
});
