
import {
  ref, Ref, computed, set as VueSet, del as VueDel,
} from '@vue/composition-api';

export interface Attribute {
  belongs: 'track' | 'detection';
  datatype: 'text' | 'number' | 'boolean';
  values?: string[];
  name: string;
  key: string;
}

export type Attributes = Record<string, Attribute>;

/**
 * Modified markChangesPending for attributes specifically
 */
interface UseAttributesParams {
  markChangesPending: (
    {
      action,
      attribute,
    }: {
      action: 'upsert' | 'delete';
      attribute: Attribute;
    }
  ) => void;
}

export default function UseAttributes({ markChangesPending }: UseAttributesParams) {
  const attributes: Ref<Record<string, Attribute>> = ref({});


  function loadAttributes(metadataAttributes: Record<string, Attribute>) {
    attributes.value = metadataAttributes;
  }

  const attributesList = computed(() => Object.values(attributes.value));

  function setAttribute({ data, oldAttribute }:
     {data: Attribute; oldAttribute?: Attribute }, updateAllTracks = false) {
    if (oldAttribute && data.key !== oldAttribute.key) {
      // Name change should delete the old attribute and create a new one with the updated id
      VueDel(attributes.value, oldAttribute.key);
      markChangesPending({ action: 'delete', attribute: oldAttribute });
      // Create a new attribute to replace it
    }
    if (updateAllTracks && oldAttribute) {
      // TODO: Lengthy track/detection attribute updating function
    }
    VueSet(attributes.value, data.key, data);
    markChangesPending({ action: 'upsert', attribute: attributes.value[data.key] });
  }


  function deleteAttribute({ data }: {data: Attribute}, removeFromTracks = false) {
    if (attributes.value[data.key] !== undefined) {
      markChangesPending({ action: 'delete', attribute: attributes.value[data.key] });
      VueDel(attributes.value, data.key);
    }
    if (removeFromTracks) {
      // TODO: Lengthty track/detection attribute deletion function
    }
  }

  return {
    loadAttributes,
    attributesList,
    setAttribute,
    deleteAttribute,
  };
}
