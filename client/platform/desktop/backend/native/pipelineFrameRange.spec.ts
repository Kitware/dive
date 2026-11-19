import {
  describe, it, expect, afterEach,
} from 'vitest';
import fs from 'fs-extra';
import mockfs from 'mock-fs';
import { offsetCsvFrames } from './pipelineFrameRange';

afterEach(() => {
  mockfs.restore();
});

describe('offsetCsvFrames', () => {
  it('adds the range start to every data row and leaves the rest alone', async () => {
    mockfs({
      '/job': {
        'detector_output.csv': [
          '# 1: Detection or Track-id,2: Video or Image Identifier,3: Unique Frame Identifier,4-7: Img-bbox(TL_x,TL_y,BR_x,BR_y),8: Detection or Length Confidence,9: Target Length (0 or -1 if invalid),10-11+: Repeated Species,Confidence Pairs or Attributes',
          '# metadata,fps: 5,exported_by: "dive:typescript"',
          '0,frame_040.png,0,10,10,20,20,0.9,-1,fish,0.9',
          '1,frame_041.png,1,10,10,20,20,0.9,-1,fish,0.9',
          '',
          '2,frame_100.png,60,10,10,20,20,0.9,-1,fish,0.9',
          'short,row',
          '',
        ].join('\n'),
      },
    });

    const out = await offsetCsvFrames('/job/detector_output.csv', 40);

    expect(out).toBe('/job/detector_output_absolute.csv');
    expect((await fs.readFile(out, 'utf-8')).split('\n')).toEqual([
      '# 1: Detection or Track-id,2: Video or Image Identifier,3: Unique Frame Identifier,4-7: Img-bbox(TL_x,TL_y,BR_x,BR_y),8: Detection or Length Confidence,9: Target Length (0 or -1 if invalid),10-11+: Repeated Species,Confidence Pairs or Attributes',
      '# metadata,fps: 5,exported_by: "dive:typescript"',
      '0,frame_040.png,40,10,10,20,20,0.9,-1,fish,0.9',
      '1,frame_041.png,41,10,10,20,20,0.9,-1,fish,0.9',
      '',
      '2,frame_100.png,100,10,10,20,20,0.9,-1,fish,0.9',
      'short,row',
      '',
    ]);
    // The pipeline's own output is kept as it was.
    expect(await fs.readFile('/job/detector_output.csv', 'utf-8')).toContain('0,frame_040.png,0,');
  });
});
