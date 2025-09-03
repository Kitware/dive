import { Attribute } from 'vue-media-annotator/use/AttributeTypes';

const EXPECTED_ATTRIBUTE_NAMES = [
  'stereo3d_x',
  'stereo3d_y',
  'stereo3d_z',
];

export const noOp = () => undefined;

export function isStereo3dReady(attrs: Attribute[]) {
  const attributeNamesToFind = [...EXPECTED_ATTRIBUTE_NAMES];

  // eslint-disable-next-line no-restricted-syntax
  for (const attr of attrs) {
    // eslint-disable-next-line no-plusplus
    for (let i = 0; i < attributeNamesToFind.length; i++) {
      if (attr.name === attributeNamesToFind[i]) {
        if (attr.belongs === 'detection' && attr.datatype === 'number') {
          attributeNamesToFind.splice(i, 1);
        } else {
          return false;
        }
      }
    }

    if (attributeNamesToFind.length === 0) {
      return true;
    }
  }

  return false;
}
