<script lang="ts">
import {
  computed, defineComponent, PropType, reactive, Ref, ref, watch,
} from '@vue/composition-api';
import { Attribute } from 'vue-media-annotator/use/AttributeTypes';
import { usePrompt } from 'dive-common/vue-utilities/prompt-service';
import { useTrackStyleManager } from 'vue-media-annotator/provides';
import AttributeRendering from './AttributeRendering.vue';
import AttributeValueColors from './AttributeValueColors.vue';
import AttributeNumberValueColors from './AttributeNumberValueColors.vue';

export default defineComponent({
  name: 'AttributeSettings',
  components: {
    AttributeRendering,
    AttributeValueColors,
    AttributeNumberValueColors,
  },
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
    const trackStyleManager = useTrackStyleManager();
    const currentTab = ref('Main');

    const baseSettings = reactive({
      name: props.selectedAttribute.name,
      belongs: props.selectedAttribute.belongs,
      datatype: props.selectedAttribute.datatype,
      areSettingsValid: false,
      editor: props.selectedAttribute.editor,
      values: props.selectedAttribute.values ? props.selectedAttribute.values : [],
    });

    const colorSettings = reactive({
      attributeColors: props.selectedAttribute.valueColors,
      color: props.selectedAttribute.color,
      tempColor: trackStyleManager.typeStyling.value.color(baseSettings.name),
    });
    let values: string[] = props.selectedAttribute.values ? props.selectedAttribute.values : [];
    let addNew = !props.selectedAttribute.key.length;

    const form: Ref<HTMLFormElement | null> = ref(null);
    const colorEditor = ref(false);
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
    const attributeRendering = ref(!!props.selectedAttribute.render);
    const renderingVals = ref(props.selectedAttribute.render);

    function setDefaultValue() {
      baseSettings.name = '';
      baseSettings.belongs = 'track';
      baseSettings.datatype = 'number';
      values = [];
    }
    function add() {
      setDefaultValue();
      addNew = true;
      if (form.value) {
        form.value.resetValidation();
      }
    }

    async function submit(close = true) {
      if (form.value && !form.value.validate()) {
        return;
      }

      const data = {
        name: baseSettings.name,
        belongs: baseSettings.belongs,
        datatype: baseSettings.datatype,
        values: baseSettings.datatype === 'text' && values ? values : [],
        valueColors: colorSettings.attributeColors,
        key: `${baseSettings.belongs}_${baseSettings.name}`,
        editor: baseSettings.editor,
        color: colorSettings.color,
        render: renderingVals.value,
      };

      if (addNew) {
        emit('save', { data, close });
        addNew = false;
      } else {
        emit('save', { data, oldAttribute: props.selectedAttribute, close });
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
        baseSettings.editor = {
          type: 'combo',
        };
      } else if (type === 'text') {
        baseSettings.editor = {
          type: 'freeform',
        };
      }
      baseSettings.datatype = type;
    };
    const numericChange = (type: 'combo' | 'slider') => {
      if (type === 'combo') {
        baseSettings.editor = {
          type: 'combo',
        };
      } else if (type === 'slider') {
        baseSettings.editor = {
          type: 'slider',
          range: [0, 1],
          steps: 0.1,
        };
      }
    };
    watch(() => baseSettings.name, () => {
      if (!colorSettings.color) {
        colorSettings.tempColor = trackStyleManager.typeStyling.value.color(baseSettings.name);
      }
    });

    const launchColorEditor = () => {
      if (!colorSettings.color) {
        colorSettings.color = colorSettings.tempColor;
      }
      colorEditor.value = true;
    };

    watch(renderingVals, () => {
      submit(false);
    });

    watch(attributeRendering, () => {
      if (renderingVals.value === undefined) {
        renderingVals.value = {
          typeFilter: ['all'],
          displayName: props.selectedAttribute.name,
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
        };
      }
      if (!attributeRendering.value) {
        renderingVals.value = undefined;
      }
    });
    return {
      baseSettings,
      colorEditor,
      values,
      addNew,
      colorSettings,
      attributeRendering,
      renderingVals,
      currentTab,
      //computed
      textValues,
      //functions
      add,
      submit,
      deleteAttribute,
      typeChange,
      numericChange,
      launchColorEditor,
    };
  },
});
</script>

<template>
  <v-card class="attribute-settings">
    <v-card-title class="pb-0">
      Attributes
      <v-card-text>
        <v-card-title class="text-h6">
          <v-tabs v-model="currentTab">
            <v-tab> Main </v-tab>
            <v-tab> Rendering </v-tab>
            <v-tab v-if="['text', 'number'].includes(baseSettings.datatype)">
              Value Colors
            </v-tab>
          </v-tabs>
        </v-card-title>
        <v-tabs-items v-model="currentTab">
          <v-tab-item>
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
              v-model="baseSettings.areSettingsValid"
            >
              <v-text-field
                v-model="baseSettings.name"
                label="Name"
                :rules="[v => !!v || 'Name is required', v => !v.includes(' ') ||
                  'No spaces', v => v !== 'userAttributes' || 'Reserved Name']"
                required
              />
              <v-select
                :value="baseSettings.datatype"
                :items="[
                  { text: 'Boolean', value: 'boolean' },
                  { text: 'Number', value: 'number' },
                  { text: 'Text', value: 'text' }
                ]"
                label="Datatype"
                @change="typeChange"
              />
              <div v-if="baseSettings.datatype=== 'number'">
                <v-radio-group
                  :value="(baseSettings.editor && baseSettings.editor.type) || 'combo'"
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
              <!-- Hide this functionality for now -->
              <div v-if="false">
                <v-checkbox
                  v-model="user"
                  label="User Attribute"
                  hint="Attribute data is saved per user instead of globally."
                  persistent-hint
                />
              </div>
              <div
                v-if="baseSettings.datatype === 'number'
                  && baseSettings.editor && baseSettings.editor.type === 'slider'"
              >
                <v-row
                  v-if="baseSettings.editor.range"
                  class="pt-2"
                >
                  <v-text-field
                    v-model.number="baseSettings.editor.range[0]"
                    dense
                    outlined
                    :step="baseSettings.editor.range[0]> 1 ? 1 : 0.01"
                    type="number"
                    label="Min"
                    :rules="[
                      v => !isNaN(parseFloat(v))|| 'Number is required',
                      v => baseSettings.editor
                        && baseSettings.editor.type === 'slider'
                        && baseSettings.editor.range
                        && v < baseSettings.editor.range[1]
                        || 'Min needs to be smaller than the Max']"
                    :max="baseSettings.editor.range[1]"
                    hint="Min limit for slider"
                    persistent-hint
                  />
                  <v-text-field
                    v-model.number="baseSettings.editor.range[1]"
                    dense
                    outlined
                    :step="baseSettings.editor.range[1]> 1 ? 1 : 0.01"
                    type="number"
                    label="Max"
                    :rules="[
                      v => !isNaN(parseFloat(v)) || 'Number is required',
                      v => baseSettings.editor
                        && baseSettings.editor.type === 'slider'
                        && baseSettings.editor.range
                        && v > baseSettings.editor.range[0]
                        || 'Max needs to be larger than the Min']"
                    :min="baseSettings.editor.range[0]"
                    hint="Max limit for slider"
                    persistent-hint
                  />
                </v-row>
                <v-row class="pt-2">
                  <v-text-field
                    v-model.number="baseSettings.editor.steps"
                    dense
                    outlined
                    :step="baseSettings.editor
                      && baseSettings.editor.steps && baseSettings.editor.steps > 1 ? 1 : 0.01"
                    type="number"
                    :rules="[
                      v => !isNaN(parseFloat(v)) || 'Number is required',
                      v => baseSettings.editor
                        && baseSettings.editor.type === 'slider'
                        && baseSettings.editor.range
                        && v < (baseSettings.editor.range[1] - baseSettings.editor.range[0])
                        || 'Steps should be smaller than the range']"
                    label="Slider Step Interval"
                    min="0"
                    hint="Each movement will move X amount"
                    persistent-hint
                  />
                </v-row>
              </div>
              <v-textarea
                v-if="baseSettings.datatype === 'text'"
                v-model="textValues"
                label="Predefined values"
                hint="Line separated values"
                outlined
                auto-grow
                row-height="30"
              />
            </v-form>
            <v-row
              v-if="!colorEditor"
              align="center"
              justify="start"
            >
              <v-col
                align-self="center"
                cols="2"
              >
                <h2>
                  Color:
                </h2>
              </v-col>
              <v-col align-self="center">
                <div
                  v-if="!colorSettings.color"
                  class="edit-color-box"
                  :style="{
                    backgroundColor: colorSettings.tempColor,
                  }"
                  @click="launchColorEditor"
                /><div
                  v-else
                  class="edit-color-box"
                  :style="{
                    backgroundColor: colorSettings.color,
                  }"
                  @click="launchColorEditor"
                />
              </v-col>
              <v-spacer />
            </v-row>
            <v-row v-if="colorEditor">
              <v-spacer />
              <v-col>
                <v-color-picker
                  v-model="colorSettings.color"
                  hide-inputs
                />
              </v-col>
              <v-spacer />
            </v-row>
          </v-tab-item>
          <v-tab-item>
            <v-switch
              v-model="attributeRendering"
              label="Rendering"
            />
            <attribute-rendering
              v-if="attributeRendering && renderingVals !== undefined"
              v-model="renderingVals"
              :attribute="selectedAttribute"
            />
          </v-tab-item>
          <v-tab-item v-if="baseSettings.datatype === 'text'">
            <attribute-value-colors
              :attribute="selectedAttribute"
              @save="colorSettings.attributeColors = $event"
            />
          </v-tab-item>
          <v-tab-item v-else-if="baseSettings.datatype === 'number'">
            <attribute-number-value-colors
              :attribute="selectedAttribute"
              @save="colorSettings.attributeColors = $event"
            />
          </v-tab-item>
        </v-tabs-items>
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
              :disabled="!baseSettings.areSettingsValid
                || (!baseSettings.name || baseSettings.name.includes(' '))"
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
.edit-color-box {
  display: inline-block;
  margin-left: 20px;
  min-width: 50px;
  max-width: 50px;
  min-height: 50px;
  max-height: 50px;
  &:hover {
    cursor: pointer;
    border: 2px solid white
  }
}
</style>
