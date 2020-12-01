<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeMount,
  Ref,
  ref,
} from '@vue/composition-api';

import {
  useSelectedTrackId,
  useFrame,
  useEditingMode,
  useTypeStyling,
  useAllTypes,
  useHandler,
  useTrackMap,
} from 'vue-media-annotator/provides';
import { getTrack } from 'vue-media-annotator/use/useTrackStore';
import TrackItem from 'vue-media-annotator/components/TrackItem.vue';

import { useApi, Attribute } from 'viame-web-common/apispec';
import AttributeInput from 'viame-web-common/components/AttributeInput.vue';
import AttributeEditor from 'viame-web-common/components/AttributeEditor.vue';
import AttributeSubsection from 'viame-web-common/components/AttributesSubsection.vue';
import ConfidenceSubsection from 'viame-web-common/components/ConfidenceSubsection.vue';


export default defineComponent({
  components: {
    AttributeInput,
    TrackItem,
    AttributeEditor,
    AttributeSubsection,
    ConfidenceSubsection,
  },
  props: {
    lockTypes: {
      type: Boolean,
      default: false,
    },
    width: {
      type: Number,
      default: 300,
    },
    hotkeysDisabled: {
      type: Boolean,
      required: true,
    },

  },
  setup(props) {
    const attributes = ref([] as Attribute[]);
    const editingAttribute: Ref<Attribute | null> = ref(null);
    const editingError: Ref<string | null> = ref(null);
    const editingModeRef = useEditingMode();
    const typeStylingRef = useTypeStyling();
    const allTypesRef = useAllTypes();
    const trackMap = useTrackMap();
    const { trackSelectNext, trackSplit, removeTrack } = useHandler();

    //Edit/Set single value by clicking
    const editIndividual: Ref<Attribute | null> = ref(null);


    const frameRef = useFrame();
    const selectedTrackIdRef = useSelectedTrackId();
    const { getAttributes, setAttribute, deleteAttribute } = useApi();
    const selectedTrack = computed(() => {
      if (selectedTrackIdRef.value !== null) {
        return getTrack(trackMap, selectedTrackIdRef.value);
      }
      return null;
    });

    function setEditIndividual(attribute: Attribute | null) {
      editIndividual.value = attribute;
    }
    function resetEditIndividual(event: MouseEvent) {
      // Only reset if not clicking on a v-input object
      if (editIndividual.value) {
        const path = event.composedPath() as HTMLElement[];
        const inputs = ['INPUT', 'SELECT'];
        if (
          path.find(
            (item: HTMLElement) => (item.classList && item.classList.contains('v-input'))
              || inputs.includes(item.nodeName),
          )
        ) {
          return;
        }
        editIndividual.value = null;
      }
    }

    async function closeEditor() {
      editingAttribute.value = null;
      editingError.value = null;
      attributes.value = await getAttributes();
    }

    function addAttribute(type: 'Track' | 'Detection') {
      //TS doesn't understand
      const belongs = type.toLowerCase() as 'track' | 'detection';
      editingAttribute.value = {
        belongs,
        datatype: 'text',
        name: `New${type}Attribute`,
        _id: '',
      };
    }
    function editAttribute(attribute: Attribute) {
      editingAttribute.value = attribute;
    }
    async function saveAttribtueHandler(saveData: {
      addNew: boolean | undefined;
      data: Attribute;
    }) {
      editingError.value = null;
      if (attributes.value.some((attribute) => (
        attribute.name === saveData.data.name && attribute.belongs === saveData.data.belongs))) {
        editingError.value = 'Attribute with that name exists';
        return;
      }

      try {
        await setAttribute(saveData);
      } catch (err) {
        editingError.value = err.message;
      }
      if (!editingError.value) {
        closeEditor();
      }
    }
    async function deleteAttributeHandler(data: Attribute) {
      editingError.value = null;
      try {
        await deleteAttribute(data);
      } catch (err) {
        editingError.value = err.message;
      }
      if (!editingError.value) {
        closeEditor();
      }
    }

    const mouseTrap = computed(() => {
      const disabled = props.hotkeysDisabled;
      return [
        {
          bind: 'up',
          handler: () => {
            trackSelectNext(-1);
          },
          disabled,
        },
        {
          bind: 'down',
          handler: () => {
            trackSelectNext(1);
          },
          disabled,
        },
        {
          bind: 'del',
          handler: () => {
            if (selectedTrackIdRef.value !== null) {
              removeTrack([selectedTrackIdRef.value]);
            }
          },
          disabled,
        },
        {
          bind: 'x',
          handler: () => trackSplit(selectedTrackIdRef.value, frameRef.value),
          disabled,
        },
      ];
    });

    onBeforeMount(async () => {
      attributes.value = await getAttributes();
    });

    return {
      selectedTrackIdRef,
      /* Attributes */
      attributes,
      /* Editing */
      editingAttribute,
      saveAttribtueHandler,
      deleteAttributeHandler,
      editingError,
      editIndividual,
      /* Selected */
      selectedTrack,
      /* Update functions */
      closeEditor,
      editAttribute,
      addAttribute,
      editingModeRef,
      typeStylingRef,
      allTypesRef,
      setEditIndividual,
      resetEditIndividual,
      mouseTrap,
    };
  },
});
</script>

<template>
  <v-card
    ref="card"
    v-mousetrap="mouseTrap"
    :width="width"
    class="d-flex flex-column overflow-hidden"
    @click.native="resetEditIndividual"
  >
    <v-subheader>Track Editor</v-subheader>
    <div
      v-if="!selectedTrack"
      class="ml-4 body-2"
    >
      No track attributes set
    </div>
    <template v-else>
      <datalist id="allTypesOptions">
        <option
          v-for="type in allTypesRef"
          :key="type"
          :value="type"
        >
          {{ type }}
        </option>
      </datalist>
      <track-item
        :solo="true"
        :track="selectedTrack"
        :track-type="selectedTrack.confidencePairs[0][0]"
        :selected="true"
        :editing="!!editingModeRef"
        :input-value="true"
        :color="typeStylingRef.color(selectedTrack.confidencePairs[0][0])"
        :lock-types="lockTypes"
        @seek="$emit('track-seek', $event)"
      />

      <confidence-subsection
        :confidence-pairs="selectedTrack.confidencePairs"
      />
      <attribute-subsection
        mode="Track"
        :attributes="attributes"
        :edit-individual="editIndividual"
        @edit-attribute="editAttribute($event)"
        @set-edit-individual="setEditIndividual($event)"
        @add-attribute="addAttribute"
      />
      <attribute-subsection
        mode="Detection"
        :attributes="attributes"
        :edit-individual="editIndividual"
        @edit-attribute="editAttribute($event)"
        @set-edit-individual="setEditIndividual($event)"
        @add-attribute="addAttribute"
      />
    </template>
    <v-dialog
      :value="editingAttribute != null"
      max-width="350"
    >
      <attribute-editor
        v-if="editingAttribute != null"
        :selected-attribute="editingAttribute"
        :error="editingError"
        @close="closeEditor"
        @save="saveAttribtueHandler"
        @delete="deleteAttributeHandler"
      />
    </v-dialog>
  </v-card>
</template>
