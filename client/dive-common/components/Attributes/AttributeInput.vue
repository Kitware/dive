<script lang="ts">
import {
  defineComponent,
  ref,
  PropType,
  onMounted,
  watch,
  useId,
  computed,
} from 'vue';
import { NumericAttributeEditorOptions, StringAttributeEditorOptions } from 'vue-media-annotator/use/AttributeTypes';

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
    const optionsListId = `optionsList_${useId()}`;
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

    const localSliderValue = ref(0);

    watch(
      () => [props.value, props.typeSettings] as const,
      () => {
        if (props.value !== undefined && props.value !== null && props.value !== '') {
          localSliderValue.value = Number(props.value);
        } else if (props.typeSettings?.type === 'slider') {
          localSliderValue.value = props.typeSettings.range[0];
        }
      },
      { immediate: true },
    );

    const sliderStep = computed(() => {
      if (props.typeSettings && props.typeSettings.type === 'slider') {
        if (props.typeSettings.steps) {
          return props.typeSettings.steps;
        }
        return (props.typeSettings.range[1] - props.typeSettings.range[0]) / 2.0;
      }
      return 1;
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
      localSliderValue.value = num;
      const { name } = props;
      emit('change', { name, value: num });
    }

    return {
      optionsListId,
      localSliderValue,
      sliderStep,
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
      :id="optionsListId"
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
      :list="optionsListId"
      class="input-box"
      @change="change"
      @focus="onFocus"
      @keydown="onInputKeyEvent"
    >
    <input
      v-else-if="datatype === 'number' && (!typeSettings || typeSettings.type === 'combo')"
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
      v-else-if="datatype === 'number' && (typeSettings && typeSettings.type === 'slider')"
      class="attribute-slider-wrap"
    >
      <div class="slider-label">
        {{ localSliderValue }}
      </div>
      <v-slider
        :model-value="localSliderValue"
        :step="sliderStep"
        :min="typeSettings.range[0]"
        :max="typeSettings.range[1]"
        density="compact"
        hide-details
        thumb-size="12"
        track-size="4"
        class="attribute-slider"
        @update:model-value="sliderChange"
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
        v-for="(item, index) in boolOpts"
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
  .attribute-slider-wrap {
    max-width: 110px;
    width: 100%;
  }
  .attribute-slider {
    margin: 0;
    padding: 0;
    min-height: 20px;

    :deep(.v-input__control) {
      min-height: 20px;
    }
    :deep(.v-slider__container) {
      min-height: 20px;
    }
  }
  .slider-label {
    font-size: 0.75em;
    line-height: 1.2;
    margin-bottom: 2px;
    text-align: center;
    width: 100%;
  }
</style>
