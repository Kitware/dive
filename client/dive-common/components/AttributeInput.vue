<script lang="ts">
import {
  defineComponent,
  ref,
  PropType,
  onMounted,
  watch,
} from '@vue/composition-api';
import { NumericAttributeEditorOptions, StringAttributeEditorOptions } from 'vue-media-annotator/use/useAttributes';

export default defineComponent({
  props: {
    name: {
      type: String,
      required: true,
    },
    value: {
      type: [String, Boolean, Number] as PropType<string|boolean|number|null>,
      default: null,
    },
    datatype: {
      type: String as PropType<'boolean'|'number'|'text'>,
      required: true,
    },
    values: {
      type: Array,
      default: () => [],
    },
    focus: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    typeSettings: {
      type: Object as PropType<null | NumericAttributeEditorOptions | StringAttributeEditorOptions>,
      default: null,
    },
  },
  setup(props, { emit }) {
    const tempVal = ref(props.value as null | boolean | number | string);
    const inputBoxRef = ref(undefined as undefined | HTMLInputElement);
    const boolOpts = [
      { text: '', value: undefined },
      { text: 'true', value: true },
      { text: 'false', value: false },
    ];
    if (props.datatype === 'text') {
      watch(() => props.value, (newVal) => {
        tempVal.value = newVal;
      });
    }
    onMounted(() => {
      if (props.focus && inputBoxRef.value) {
        inputBoxRef.value.focus();
      }
    });

    function blurType(e: KeyboardEvent) {
      const target = (e.target as HTMLInputElement);
      // Datalist needs to reset if we blur on no input
      if (props.values && props.values.length && target.value === '') {
        tempVal.value = props.value;
      }
      target.blur();
    }
    function onFocus() {
      if (props.values && props.values.length) {
        tempVal.value = null;
      } else if (props.values && !props.values.length && inputBoxRef.value) {
        inputBoxRef.value.select();
      }
    }
    function onInputKeyEvent(e: KeyboardEvent) {
      switch (e.code) {
        case 'Escape':
        case 'Enter':
          blurType(e);
          break;
        default:
          break;
      }
    }

    function change(event: InputEvent): void {
      const target = event.target as HTMLInputElement;
      const { name } = props;
      const value = target.value.trim();
      if (value) {
        emit('change', { name, value });
      } else {
        emit('change', { name, value: undefined });
      }
      target.blur();
    }
    function sliderChange(num: number) {
      const { name } = props;
      emit('change', { name, value: num });
    }

    return {
      inputBoxRef,
      tempVal,
      boolOpts,
      blurType,
      onFocus,
      onInputKeyEvent,
      change,
      sliderChange,
    };
  },
});
</script>

<template>
  <div>
    <datalist
      v-if="datatype === 'text' && values && values.length"
      :id="`optionsList_${_uid}`"
      :disabled="disabled"
    >
      <option
        v-for="type in [' ', ...values]"
        :key="type"
        :value="type"
      >
        {{ type }}
      </option>
    </datalist>

    <input
      v-if="datatype === 'text'"
      ref="inputBoxRef"
      v-model="tempVal"
      type="text"
      :disabled="disabled"
      :list="`optionsList_${_uid}`"
      class="input-box"
      @change="change"
      @focus="onFocus"
      @keydown="onInputKeyEvent"
    >
    <input
      v-else-if="datatype === 'number' && (!typeSettings || typeSettings.type ==='combo')"
      ref="inputBoxRef"
      :label="datatype"
      :value="value"
      :disabled="disabled"
      :step="value <= 1 ? .01 : 1"
      class="input-box"
      type="number"
      @change="change"
      @keydown="onInputKeyEvent"
    >
    <div
      v-else-if="datatype === 'number' && (typeSettings && typeSettings.type ==='slider')"
    >
      <div class="slider-label">
        {{ value }}
      </div>
      <v-slider
        :value="value"
        :step="typeSettings.steps ? typeSettings.steps
          : (typeSettings.range[1] - typeSettings.range[0])/2.0"
        :min="typeSettings.range[0]"
        :max="typeSettings.range[1]"
        dense
        class="attribute-slider"
        @input="sliderChange"
      />
    </div>
    <select
      v-else-if="datatype === 'boolean'"
      ref="inputBoxRef"
      :label="datatype"
      :disabled="disabled"
      :value="value"
      class="input-box select-input"
      @change="change"
      @keydown="onInputKeyEvent"
    >
      <option
        v-for="(item,index) in boolOpts"
        :key="index"
        :value="item.value"
      >
        {{ item.text }}
      </option>
    </select>
  </div>
</template>

<style scoped lang="scss">
  .input-box {
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 4px;
    padding: 0 6px;
    width: 110px;
    color: white;
  }
  .select-input {
    width: 110px;
    background-color: #1e1e1e;
    appearance: menulist;
  }
    .attribute-slider {
    font-size: 12px !important;
    padding: 0;
    margin: 0;
    max-height:35px;
    overflow:hidden;
  }
  .slider-label {
    margin: auto;
    text-align: center;
    width: 100%;
  }
</style>
