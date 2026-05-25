// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import { describe, expect, it } from 'vitest';

import { parentDatasetId, parseCompositeDatasetId } from './compositeDatasetId';

describe('compositeDatasetId', () => {
  it('parseCompositeDatasetId splits parent and camera', () => {
    expect(parseCompositeDatasetId('parent-id')).toEqual({
      parentId: 'parent-id',
      cameraName: null,
    });
    expect(parseCompositeDatasetId('parent-id/left')).toEqual({
      parentId: 'parent-id',
      cameraName: 'left',
    });
  });

  it('parentDatasetId returns parent for composite and plain ids', () => {
    expect(parentDatasetId('parent-id')).toBe('parent-id');
    expect(parentDatasetId('parent-id/left')).toBe('parent-id');
  });

  it('parentDatasetId does not truncate ids without a camera suffix', () => {
    expect(parentDatasetId('507f1f77bcf86cd799439011')).toBe('507f1f77bcf86cd799439011');
  });
});
