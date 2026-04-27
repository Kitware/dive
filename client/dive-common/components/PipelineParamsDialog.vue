<script lang="ts">
import { Pipe, PipelineParamType } from 'dive-common/apispec';
import {
  defineComponent,
  PropType,
  ref,
  watch,
} from 'vue';

type ValidationRule = (value: string | number) => boolean | string;

export default defineComponent({
  name: 'PipelineParamsDialog',
  props: {
    value: { type: Boolean, required: true },
    pipeline: { type: Object as PropType<Pipe | null>, default: null },
    params: {
      type: Object as PropType<Record<string, string>>,
      default: () => ({}),
    },
  },
  setup(props, { emit }) {
    const localParams = ref<Record<string, string>>({ ...props.params });
    const getIcon = (type: PipelineParamType): string => {
      switch (type) {
        case 'bool': return 'mdi-toggle-switch-outline';
        case 'int':
        case 'positive_int':
        case 'strictly_positive_int':
        case 'range_int': return 'mdi-numeric';
        case 'float':
        case 'positive_float':
        case 'strictly_positive_float':
        case 'range_float': return 'mdi-decimal';
        case 'folder':
        case 'path': return 'mdi-folder-outline';
        case 'file': return 'mdi-file-outline';
        default: return 'mdi-help-box-outline';
      }
    };

    watch(() => props.params, (newParams) => {
      localParams.value = { ...newParams };
    }, { deep: true });

    const close = () => emit('input', false);

    const confirm = () => {
      emit('confirm', { ...localParams.value });
    };

    const rules: Record<string, ValidationRule> = {
      integer: (value: string | number) => Number.isInteger(Number(value)) || 'Please enter a whole number',
      positive: (value: string | number) => Number(value) >= 0 || 'Please enter a number ≥ 0',
      strictlyPositive: (value: string | number) => Number(value) > 0 || 'Please enter a number > 0',
    };

    function getRules(type: PipelineParamType): ValidationRule[] {
      const res = [];
      if (type.includes('int')) {
        res.push(rules.integer);
      }

      if (type.includes('strictly_positive')) {
        res.push(rules.strictlyPositive);
      } else if (type.includes('positive')) {
        res.push(rules.positive);
      }

      return res;
    }

    const isFormValid = ref(false);

    return {
      localParams,
      getIcon,
      close,
      confirm,
      isFormValid,
      getRules,
    };
  },
});
</script>

<template>
  <v-dialog
    :value="value"
    max-width="600px"
    scrollable
    @input="$emit('input', $event)"
  >
    <v-card v-if="pipeline" class="rounded-lg">
      <v-toolbar flat color="primary" dark dense>
        <v-icon left>
          mdi-cog
        </v-icon>
        <v-toolbar-title class="text-h6">
          Pipeline Configuration
        </v-toolbar-title>
        <v-spacer />
        <v-btn icon small @click="close">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>

      <v-card-text class="pa-4">
        <div class="mb-6">
          <div class="text-h5 font-weight-bold mb-1">
            {{ pipeline.name }}
          </div>
          <div v-if="pipeline.metadata?.description" class="text-body-2 text--secondary">
            {{ pipeline.metadata.description }}
          </div>
        </div>

        <v-divider class="mb-4" />

        <v-form v-model="isFormValid">
          <div
            v-for="param in pipeline.metadata?.diveParams"
            :key="param.key"
            class="mb-3"
          >
            <div class="d-flex align-center">
              <v-icon small class="mr-2 text--secondary">
                {{ getIcon(param.type) }}
              </v-icon>
              <label
                :for="`input-${param.key}`"
                class="text-caption font-weight-bold text-uppercase text--secondary"
              >
                {{ param.label }}
              </label>
            </div>

            <template v-if="param.type === 'bool'">
              <div class="d-flex align-center mt-2 ml-1">
                <v-switch
                  :id="`input-${param.key}`"
                  v-model="localParams[param.key]"
                  color="primary"
                  hide-details
                  class="mt-0 pt-0"
                />
              </div>
            </template>

            <template v-else-if="['int', 'positive_int', 'strictly_positive_int'].includes(param.type)">
              <v-text-field
                :id="`input-${param.key}`"
                v-model.number="localParams[param.key]"
                type="number"
                outlined
                dense
                hide-details="auto"
                class="mt-1"
                :min="param.type === 'int' ? 'none' : 0"
                :rules="getRules(param.type)"
              />
            </template>

            <template v-else-if="['float', 'positive_float', 'strictly_positive_float'].includes(param.type)">
              <v-text-field
                :id="`input-${param.key}`"
                v-model.number="localParams[param.key]"
                type="number"
                outlined
                dense
                hide-details="auto"
                class="mt-1"
                :min="param.type === 'float' ? 'none' : 0"
                :rules="getRules(param.type)"
              />
            </template>

            <template v-else-if="['range_int', 'range_float'].includes(param.type)">
              <div class="d-flex align-center mt-2 px-2">
                <v-slider
                  v-model="localParams[param.key]"
                  :min="param.type_props?.at(0) || 0"
                  :max="param.type_props?.at(1) || 100"
                  :step="param.type_props?.at(2) || 1"
                  hide-details
                >
                  <template #append>
                    <v-text-field
                      v-model="localParams[param.key]"
                      dense
                      style="width: 100px; margin-top: -6px"
                      type="number"
                      :min="param.type_props?.at(0) || 0"
                      :max="param.type_props?.at(1) || 100"
                      :step="param.type_props?.at(2) || 1"
                      :rules="getRules(param.type)"
                      outlined
                      hide-details
                    />
                  </template>
                </v-slider>
              </div>
            </template>

            <v-text-field
              v-else
              :id="`input-${param.key}`"
              v-model="localParams[param.key]"
              type="text"
              outlined
              dense
              hide-details="auto"
              class="mt-1"
            />
          </div>
        </v-form>
      </v-card-text>

      <v-divider />

      <v-card-actions class="pa-4 lighten-3">
        <v-btn text color="grey darken-1" @click="close">
          Cancel
        </v-btn>
        <v-spacer />
        <v-btn color="primary" :disabled="!isFormValid" @click="confirm">
          <v-icon left>
            mdi-play
          </v-icon>
          Run Pipeline
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
