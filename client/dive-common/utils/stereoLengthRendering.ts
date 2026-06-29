import type { Attribute, AttributeRendering } from 'vue-media-annotator/use/AttributeTypes';

export const STEREO_LENGTH_ATTRIBUTE_NAME = 'length';

export function createDefaultAttributeRendering(
  displayName: string,
  overrides: Partial<AttributeRendering> = {},
): AttributeRendering {
  return {
    typeFilter: ['all'],
    hideEmpty: true,
    displayName,
    displayColor: 'auto',
    displayTextSize: -1,
    valueColor: 'auto',
    valueTextSize: -1,
    order: 0,
    location: 'outside',
    corner: 'SE',
    layout: 'horizontal',
    box: false,
    boxColor: 'auto',
    boxThickness: 1,
    displayWidth: {
      type: '%',
      val: 10,
    },
    displayHeight: {
      type: 'auto',
      val: 10,
    },
    ...overrides,
  };
}

export function createStereoLengthRendering(displayName = STEREO_LENGTH_ATTRIBUTE_NAME): AttributeRendering {
  return createDefaultAttributeRendering(displayName);
}

export function findStereoLengthAttribute(
  attributes: Attribute[] | Record<string, Attribute>,
): Attribute | undefined {
  const list = Array.isArray(attributes) ? attributes : Object.values(attributes);
  return list.find((attribute) => (
    attribute.name === STEREO_LENGTH_ATTRIBUTE_NAME && attribute.belongs === 'detection'
  ));
}

/**
 * Enable on-canvas rendering for the detection-level length attribute when it
 * exists but has no render settings yet.
 */
export function ensureStereoLengthRendering(
  attributes: Attribute[] | Record<string, Attribute>,
): boolean {
  const lengthAttribute = findStereoLengthAttribute(attributes);
  if (!lengthAttribute || lengthAttribute.render) {
    return false;
  }
  lengthAttribute.render = createStereoLengthRendering(lengthAttribute.name);
  return true;
}
