/// <reference types="vitest" />

import fs from 'fs';
import path from 'path';

import isFrameMetadataSourceName from './naming';
import { parseFrameMetadataTable } from './parser';

const SOURCE_NAMES_TRUTH_TABLE = path.resolve(
  __dirname,
  '../../../testutils/framemetadata.spec.json',
);

describe('frame metadata table parser', () => {
  it('parses comma, tab, and whitespace-delimited tables', () => {
    [
      'filename,depth\nimg001.png,10\n',
      'filename\tdepth\nimg001.png\t10\n',
      'filename depth\nimg001.png 10\n',
    ].forEach((text) => {
      expect(parseFrameMetadataTable(text)).toEqual({
        header: ['filename', 'depth'],
        rows: [['img001.png', '10']],
      });
    });
  });

  it('trims a BOM, headers, and cells', () => {
    expect(parseFrameMetadataTable('﻿ filename , depth \n img001.png , 10 \n')).toEqual({
      header: ['filename', 'depth'],
      rows: [['img001.png', '10']],
    });
  });

  it('skips a leading comment block and sniffs the first data line', () => {
    expect(parseFrameMetadataTable(
      '# Position (lat, lon) log\nfilename\tdepth\nimg001.png\t10\n',
    )).toEqual({
      header: ['filename', 'depth'],
      rows: [['img001.png', '10']],
    });
  });

  it('does not promote a comment to the header', () => {
    expect(parseFrameMetadataTable(
      '# filename,depth,heading\nimg001.png,10,180\n',
    )).toBeNull();
  });

  it('drops empty header cells and rows', () => {
    expect(parseFrameMetadataTable(
      ',,,\n,filename,depth,\n, img001.png ,10,\n,,,\n',
    )).toEqual({
      header: ['filename', 'depth'],
      rows: [['img001.png', '10']],
    });
  });

  it('keeps a bare double quote and Windows path text', () => {
    expect(parseFrameMetadataTable(
      'filename,depth\nimages\\img001.png,5"\n',
    )).toEqual({
      header: ['filename', 'depth'],
      rows: [['images\\img001.png', '5"']],
    });
  });

  it('keeps a repeated header name as its own column', () => {
    expect(parseFrameMetadataTable('filename,depth,depth\nimg001.png,10,20\n')).toEqual({
      header: ['filename', 'depth', 'depth'],
      rows: [['img001.png', '10', '20']],
    });
  });

  it('rejects empty, comment-only, and NUL-poisoned input', () => {
    expect(parseFrameMetadataTable('')).toBeNull();
    expect(parseFrameMetadataTable('# one\n# two\n')).toBeNull();
    expect(parseFrameMetadataTable('filename,alt\0\nimg001.png,42\0\n')).toBeNull();
  });

  it('keeps a cell of any size', () => {
    const value = 'x'.repeat(400000);
    const table = parseFrameMetadataTable(`filename,notes\nimg001.png,${value}\n`);

    expect(table?.rows[0]).toEqual(['img001.png', value]);
  });

  it('keeps a header cell that names an Object prototype member', () => {
    const table = parseFrameMetadataTable('filename,__proto__\nimg001.png,value\n');

    expect(table?.header).toEqual(['filename', '__proto__']);
    expect(table?.rows[0]).toEqual(['img001.png', 'value']);
  });
});

describe('delimiter sniffing', () => {
  it('ignores commas inside quoted header cells of a tab-delimited table', () => {
    expect(parseFrameMetadataTable(
      '"Pos (lat, lon)"\t"Vel (x, y)"\tdepth\n"1, 2"\t"3, 4"\t10\n',
    )).toEqual({
      header: ['Pos (lat, lon)', 'Vel (x, y)', 'depth'],
      rows: [['1, 2', '3, 4', '10']],
    });
  });

  it('keeps commas inside quoted cells of a comma-delimited table', () => {
    expect(parseFrameMetadataTable(
      'filename,"notes, more"\nimg001.png,"a, b"\n',
    )).toEqual({
      header: ['filename', 'notes, more'],
      rows: [['img001.png', 'a, b']],
    });
  });

  it('resolves an equal unquoted count in favour of tabs', () => {
    expect(parseFrameMetadataTable('name\tnotes,extra\nimg001.png\t10,20\n')).toEqual({
      header: ['name', 'notes,extra'],
      rows: [['img001.png', '10,20']],
    });
  });
});

describe('shared frame-metadata naming', () => {
  it('matches the shared source-name predicate truth table', () => {
    const truthTable = JSON.parse(
      fs.readFileSync(SOURCE_NAMES_TRUTH_TABLE, 'utf-8'),
    ) as Record<string, boolean>;

    expect(Object.keys(truthTable).length).toBeGreaterThan(0);
    Object.entries(truthTable).forEach(([name, expected]) => {
      expect(isFrameMetadataSourceName(name)).toBe(expected);
    });
  });
});
