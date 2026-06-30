/// <reference types="vitest" />
import {
  findJoinColumns,
  normalizeKey,
  parseFrameMetadataSource,
  selectFrameMetadataSource,
} from 'platform/desktop/backend/serializers/frameMetadata';

describe('desktop frame metadata serializer', () => {
  it('normalizes media keys the same way as image name maps', () => {
    expect(normalizeKey('nested/20191009.154056.00082_rect_color.tif')).toBe(
      '20191009.154056.00082_rect_color',
    );
  });

  it('parses NOAA-style rows with multiple image columns', () => {
    const mediaKeys = new Map([
      ['20191009.154056.00082_rect_color', 0],
      ['20191009.154056.00081_rect_color', 0],
    ]);
    const text = [
      'port_image date time latitude longitude water_depth altitude starboard_image',
      '20191009.154056.00082_rect_color.tif 2019/10/09 15:40:56.1122 46.575870 -124.603094 192.80 2.78 20191009.154056.00081_rect_color.tif',
      '',
    ].join('\n');

    const source = parseFrameMetadataSource(text, mediaKeys, 'nav.txt');

    expect(source).not.toBeNull();
    expect(source?.sourceName).toBe('nav.txt');
    expect(source?.header).toEqual([
      'port_image',
      'date',
      'time',
      'latitude',
      'longitude',
      'water_depth',
      'altitude',
      'starboard_image',
    ]);
    expect(source?.joinColumns).toEqual(['port_image', 'starboard_image']);
    expect(source?.payloadColumns).toEqual([
      'date',
      'time',
      'latitude',
      'longitude',
      'water_depth',
      'altitude',
    ]);
    expect(Object.keys(source?.records || {}).sort()).toEqual([
      '20191009.154056.00081_rect_color',
      '20191009.154056.00082_rect_color',
    ]);
    const portRecord = source?.records['20191009.154056.00082_rect_color'];
    expect(Object.keys(portRecord || {})).toEqual(source?.header);
    expect(portRecord?.latitude).toBe('46.575870');
    expect(Object.values(portRecord || {}).every((value) => typeof value === 'string')).toBe(true);
  });

  it('parses comma, tab, and whitespace delimited sources', () => {
    const mediaKeys = new Map([['image_0001', 0]]);

    [
      'filename,depth,latitude\nimage_0001.jpg,192.80,46.575870\n',
      'filename\tdepth\tlatitude\nimage_0001.jpg\t192.80\t46.575870\n',
      'filename depth latitude\nimage_0001.jpg 192.80 46.575870\n',
    ].forEach((text) => {
      const source = parseFrameMetadataSource(text, mediaKeys);

      expect(source).not.toBeNull();
      expect(source?.header).toEqual(['filename', 'depth', 'latitude']);
      expect(source?.joinColumns).toEqual(['filename']);
      expect(source?.records.image_0001).toEqual({
        filename: 'image_0001.jpg',
        depth: '192.80',
        latitude: '46.575870',
      });
    });
  });

  it('finds join columns by filename value matches', () => {
    const rows = [
      {
        port_image: '20191009.154056.00082_rect_color.tif',
        latitude: '46.575870',
        starboard_image: '20191009.154056.00081_rect_color.tif',
      },
    ];

    expect(findJoinColumns(
      ['port_image', 'latitude', 'starboard_image'],
      rows,
      new Map([
        ['20191009.154056.00082_rect_color', 0],
        ['20191009.154056.00081_rect_color', 0],
      ]),
    )).toEqual(['port_image', 'starboard_image']);
  });

  it('rejects VIAME annotation CSV even when its image column matches', () => {
    const mediaKeys = new Map([['20191009.154056.00082_rect_color', 0]]);
    const viameCsv = [
      '# 1: Detection or Track-id,2: Video or Image Identifier,3: Unique Frame Identifier,4-7: Img-bbox(TL_x,TL_y,BR_x,BR_y),8: Detection or Length Confidence,9: Target Length (0 or -1 if invalid),10-11+: Repeated Species,Confidence Pairs or Attributes',
      '1,20191009.154056.00082_rect_color.tif,0,0,0,10,10,1.0,-1,fish,0.9',
      '',
    ].join('\n');

    expect(parseFrameMetadataSource(viameCsv, mediaKeys)).toBeNull();
  });

  it('accepts VIAME-shaped telemetry without the VIAME header', () => {
    const mediaKeys = new Map([['image_0001', 0]]);
    const text = [
      'index,image,frame,x,y,depth,altitude,heading,temperature',
      '1,image_0001.jpg,100,46.5,-124.6,192.8,2.7,180.5,4.2',
      '',
    ].join('\n');

    const source = parseFrameMetadataSource(text, mediaKeys);

    expect(source).not.toBeNull();
    expect(source?.joinColumns).toEqual(['image']);
    expect(source?.records.image_0001.depth).toBe('192.8');
  });

  it('rejects bare image lists and unrelated text', () => {
    const mediaKeys = new Map([['image_0001', 0]]);

    expect(parseFrameMetadataSource('image\nimage_0001.jpg\n', mediaKeys)).toBeNull();
    expect(parseFrameMetadataSource('note,value\nhello,world\n', mediaKeys)).toBeNull();
  });

  it('rejects ambiguous candidates and non-text extensions', () => {
    const mediaKeys = new Map([['image_0001', 0]]);
    const acceptedText = 'filename,depth\nimage_0001.jpg,192.80\n';

    expect(selectFrameMetadataSource(
      [
        ['metadata.json', acceptedText],
        ['telemetry-a.txt', acceptedText],
      ],
      mediaKeys,
    )?.sourceName).toBe('telemetry-a.txt');
    expect(selectFrameMetadataSource(
      [
        ['telemetry-a.txt', acceptedText],
        ['telemetry-b.csv', 'filename,temperature\nimage_0001.jpg,4.2\n'],
      ],
      mediaKeys,
    )).toBeNull();
  });
});
