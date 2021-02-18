
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

  function setAttribute({ data }: {data: Attribute }) {
    if (data._id === '') {
      // eslint-disable-next-line no-param-reassign
      data._id = `${data.belongs}_${data.name}`;
    }
    VueSet(attributes.value, data._id, data);
    markChangesPending({ type: 'attribute', action: 'upsert', data: attributes.value[data._id] });
  }

  function deleteAttribute(attributeId: string, removeFromTracks = false) {
    if (attributes.value[attributeId] !== undefined) {
      // Maybe use different data structure
      markChangesPending({ type: 'attribute', action: 'delete', data: { ...attributes.value[attributeId] } });

      // DONT LIKE THIS
      VueDel(attributes.value, attributeId);
    }
    if (removeFromTracks) {
      // Here we would go through the existing tracks and remove all references to the attribute
      // this could take a long time on larger datasets so we may need a spinner or something in
      // the UI we can disregard for testing now
    }
  }

  return {
    loadAttributes,
    getAttributes,
    setAttribute,
    deleteAttribute,
  };
}
