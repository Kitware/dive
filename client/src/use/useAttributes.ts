
import {
  ref, Ref, computed, set as VueSet, del as VueDel,
} from '@vue/composition-api';

export interface Attribute {
  belongs: 'track' | 'detection';
  datatype: 'text' | 'number' | 'boolean';
  values?: string[];
  name: string;
  _id: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isAttribute(obj: any): obj is Attribute {
  return (
    (typeof obj === 'object')
    && (typeof obj.belongs === 'string')
    && (typeof obj.datatype === 'string')
    && (typeof obj._id === 'string')
    && (typeof obj.name === 'string')
  );
}

export type Attributes = Record<string, Attribute>;

/**
 * Modified markChangesPending for attributes specifically
 */
interface UseAttributesParams {
  markChangesPending: (
    {
      type,
      action,
      data,
    }: {
      type: 'attribute';
      action: 'upsert' | 'delete';
      data: Attribute;
    }
  ) => void;
}

export default function UseAttributes({ markChangesPending }: UseAttributesParams) {
  const attributes: Ref<Record<string, Attribute>> = ref({});


  function loadAttributes(metadataAttributes: Record<string, Attribute>) {
    attributes.value = metadataAttributes;
  }

  const getAttributes = computed(() => Object.values(attributes.value));

  function setAttribute({ data }: {data: Attribute }, updateAllTracks = false) {
    let oldAttribute;
    if (data._id === '') {
      // eslint-disable-next-line no-param-reassign
      data._id = `${data.belongs}_${data.name}`;
    } else if (attributes.value[data._id]) {
      // Existing attribute
      if (attributes.value[data._id].name !== data.name) {
        oldAttribute = attributes.value[data._id];
        // Name change should delete the old attribute and create a new one with the updated id
        VueDel(attributes.value, data._id);
        markChangesPending({ type: 'attribute', action: 'delete', data: { ...attributes.value[data._id] } });
        // Create a new attribute to replace it
        // eslint-disable-next-line no-param-reassign
        data._id = `${data.belongs}_${data.name}`;
      }
    }
    if (updateAllTracks && oldAttribute) {
      // TODO: Lengthy track/detection attribute updating function
    }
    VueSet(attributes.value, data._id, data);
    markChangesPending({ type: 'attribute', action: 'upsert', data: attributes.value[data._id] });
  }


  function deleteAttribute(attributeId: string, removeFromTracks = false) {
    if (attributes.value[attributeId] !== undefined) {
      markChangesPending({ type: 'attribute', action: 'delete', data: { ...attributes.value[attributeId] } });
      VueDel(attributes.value, attributeId);
    }
    if (removeFromTracks) {
      // TODO: Lengthty track/detection attribute deletion function
    }
  }

  return {
    loadAttributes,
    getAttributes,
    setAttribute,
    deleteAttribute,
  };
}
