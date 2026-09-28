import { parsePipelineDataTypes } from './pipelineDataTypes';

describe('parsePipelineDataTypes', () => {
  it('maps a single type to its icon', () => {
    expect(parsePipelineDataTypes('BBOX')).toEqual([{ name: 'BBOX', qualifier: undefined, icon: 'mdi-vector-square' }]);
  });

  it('splits compound outputs into one icon each', () => {
    expect(parsePipelineDataTypes('BBOX + POLYGON + KEYPOINTS').map((t) => t.icon))
      .toEqual(['mdi-vector-square', 'mdi-vector-polygon', 'mdi-vector-point']);
    expect(parsePipelineDataTypes('BBOX + MASK + HEAD-TAIL').map((t) => t.icon))
      .toEqual(['mdi-vector-square', 'mdi-vector-polygon', 'mdi-vector-line']);
  });

  it('keeps parenthesised qualifiers off the icon lookup', () => {
    expect(parsePipelineDataTypes('IMAGE (per camera), BBOX (per camera)')).toEqual([
      { name: 'IMAGE', qualifier: 'per camera', icon: 'mdi-image' },
      { name: 'BBOX', qualifier: 'per camera', icon: 'mdi-vector-square' },
    ]);
    expect(parsePipelineDataTypes('IMAGE (EO, IR)')).toEqual([{ name: 'IMAGE', qualifier: 'EO, IR', icon: 'mdi-image' }]);
  });

  it('is case insensitive and leaves unknown types without an icon', () => {
    expect(parsePipelineDataTypes('mask')[0].icon).toBe('mdi-vector-polygon');
    expect(parsePipelineDataTypes('DEPTH-MAP')).toEqual([{ name: 'DEPTH-MAP', qualifier: undefined, icon: undefined }]);
  });

  it('returns nothing for a missing header', () => {
    expect(parsePipelineDataTypes(undefined)).toEqual([]);
    expect(parsePipelineDataTypes('  ')).toEqual([]);
  });
});
