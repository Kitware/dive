<script lang="ts">
import {
  computed, defineComponent, PropType, Ref, ref,
} from '@vue/composition-api';
import { Attribute, NumericAttributeEditorOptions, StringAttributeEditorOptions } from 'vue-media-annotator/use/useAttributes';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';


export default defineComponent({
  name: 'AttributeSettings',
  props: {
    selectedAttribute: {
      type: Object as PropType<Attribute>,
      required: true,
    },
    error: {
      type: String,
      default: '',
    },
  },
  setup(props, { emit }) {
    const { prompt } = usePrompt();
    const name: Ref<string> = ref(props.selectedAttribute.name);
    const belongs: Ref<string> = ref(props.selectedAttribute.belongs);
    const datatype: Ref<string> = ref(props.selectedAttribute.datatype);
    const color: Ref<string | undefined> = ref(props.selectedAttribute.color);
    const areSettingsValid = ref(false);
    const editor: Ref<
      undefined | StringAttributeEditorOptions | NumericAttributeEditorOptions
    > = ref(props.selectedAttribute.editor);
    let values: string[] = props.selectedAttribute.values ? props.selectedAttribute.values : [];
    let addNew = !props.selectedAttribute.key.length;

    const form: Ref<HTMLFormElement | null> = ref(null);

    const textValues = computed({
      get: () => {
        if (values) {
          return values.join('\n');
        }
        return '';
      },
      set: (newval) => {
        values = newval.split('\n');
      },

    });

    function setDefaultValue() {
      name.value = '';
      belongs.value = 'track';
      datatype.value = 'number';
      values = [];
    }
    function add() {
      setDefaultValue();
      addNew = true;
      if (form.value) {
        form.value.resetValidation();
      }
    }

    async function submit() {
      if (form.value && !form.value.validate()) {
        return;
      }

      const data = {
        name: name.value,
        belongs: belongs.value,
        datatype: datatype.value,
        values: datatype.value === 'text' && values ? values : [],
        key: `${belongs.value}_${name.value}`,
        editor: editor.value,
        color: color.value,
      };

      if (addNew) {
        emit('save', { data });
      } else {
        emit('save', { data, oldAttribute: props.selectedAttribute });
      }
    }

    async function deleteAttribute() {
      const result = await prompt({
        title: 'Confirm',
        text: 'Do you want to delete this attribute?',
        confirm: true,
      });
      if (!result) {
        return;
      }
      emit('delete', props.selectedAttribute);
    }
    const typeChange = (type: 'number' | 'text' | 'boolean') => {
      if (type === 'number') {
        editor.value = {
          type: 'combo',
        };
      } else if (type === 'text') {
        editor.value = {
          type: 'freeform',
        };
      }
      datatype.value = type;
    };
    const numericChange = (type: 'combo' | 'slider') => {
      if (type === 'combo') {
        editor.value = {
          type: 'combo',
        };
      } else if (type === 'slider') {
        editor.value = {
          type: 'slider',
          range: [0, 1],
          steps: 0.1,
        };
      }
    };
    return {
      name,
      belongs,
      datatype,
      values,
      addNew,
      editor,
      areSettingsValid,
      //computed
      textValues,
      //functions
      add,
      submit,
      deleteAttribute,
      typeChange,
      numericChange,
    };
  },
});
</script>

<template>
  <v-card class="attribute-settings">
    <v-card-title class="pb-0">
      Attributes
      <v-card-text>
        <v-alert
          v-if="error || !addNew"
          :type="error ? 'error' : 'info'"
        >
          <div style="word-break: break-word;">
            {{
              error ? error :
              'Changes to Attribute Datatypes or Names do not effect \
               currently set attributes on tracks.'
            }}
          </div>
        </v-alert>
        <v-form
          ref="form"
          v-model="areSettingsValid"
        >
          <v-text-field
            v-model="name"
            label="Name"
            :rules="[v => !!v || 'Name is required', v => !v.includes(' ') || 'No spaces']"
            required
          />
          <v-select
            :value="datatype"
            :items="[
              { text: 'Boolean', value: 'boolean' },
              { text: 'Number', value: 'number' },
              { text: 'Text', value: 'text' }
            ]"
            label="Datatype"
            @change="typeChange"
          />
          <div v-if="datatype=== 'number'">
            <v-radio-group
              :value="(editor && editor.type) || 'combo'"
              row
              label="Display Type:"
              @change="numericChange"
            >
              <v-radio
                label="Input Box"
                value="combo"
              />
              <v-radio
                label="Slider"
                value="slider"
              />
            </v-radio-group>
          </div>
          <div v-if="datatype === 'number' && editor && editor.type === 'slider'">
            <v-row class="pt-2">
              <v-text-field
                v-model.number="editor.range[0]"
                dense
                outlined
                :step="editor.range[0]> 1 ? 1 : 0.01"
                type="number"
                label="Min"
                :rules="[
                  v => !isNaN(parseFloat(v))|| 'Number is required',
                  v => v < editor.range[1] || 'Min needs to be smaller than the Max']"
                :max="editor.range[1]"
                hint="Min limit for slider"
                persistent-hint
              />
              <v-text-field
                v-model.number="editor.range[1]"
                dense
                outlined
                :step="editor.range[1]> 1 ? 1 : 0.01"
                type="number"
                label="Max"
                :rules="[
                  v => !isNaN(parseFloat(v)) || 'Number is required',
                  v => v > editor.range[0] || 'Max needs to be larger than the Min']"
                :min="editor.range[0]"
                hint="Max limit for slider"
                persistent-hint
              />
            </v-row>
            <v-row class="pt-2">
              <v-text-field
                v-model.number="editor.steps"
                dense
                outlined
                :step="editor.steps> 1 ? 1 : 0.01"
                type="number"
                :rules="[
                  v => !isNaN(parseFloat(v)) || 'Number is required',
                  v => v < (editor.range[1] - editor.range[0])
                    || 'Steps should be smaller than the range']"
                label="Slider Step Interval"
                min="0"
                hint="Each movement will move X amount"
                persistent-hint
              />
            </v-row>
          </div>
          <v-textarea
            v-if="datatype === 'text'"
            v-model="textValues"
            label="Predefined values"
            hint="Line separated values"
            outlined
            auto-grow
            row-height="30"
          />
        </v-form>
        <v-card-actions>
          <v-row>
            <v-tooltip
              open-delay="100"
              bottom
            >
              <template #activator="{ on }">
                <div v-on="on">
                  <v-btn
                    class="hover-show-child"
                    color="error"
                    :disabled="!selectedAttribute.key.length"
                    @click.prevent="deleteAttribute"
                  >
                    Delete
                  </v-btn>
                </div>
              </template>
              <span
                class="ma-0 pa-1"
              >
                Deletion of Attribute
              </span>
            </v-tooltip>
            <v-spacer />
            <v-btn
              text
              class="mr-2"
              @click="$emit('close')"
            >
              Cancel
            </v-btn>
            <v-btn
              color="primary"
              :disabled="!areSettingsValid || (!name || name.includes(' '))"
              @click.prevent="submit"
            >
              Save
            </v-btn>
          </v-row>
        </v-card-actions>
      </v-card-text>
    </v-card-title>
  </v-card>
</template>

<style lang="scss">
.attribute-settings {
  .v-textarea textarea {
    line-height: 24px;
  }
}
</style>
