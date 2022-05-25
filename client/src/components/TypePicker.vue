<script lang="ts">
import {
  defineComponent, PropType, reactive, ref, toRef, watch,
} from '@vue/composition-api';

export default defineComponent({
  name: 'TypePicker',

  props: {
    value: {
      type: String,
      required: true,
    },
    allTypes: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    readOnlyMode: {
      type: Boolean,
      default: false,
    },
    lockTypes: {
      type: Boolean,
      default: false,
    },
    selected: {
      type: Boolean,
      default: false,
    },
    dataListSource: {
      type: String,
      default: 'allTypesOptions',
    },
  },

  setup(props, { emit }) {
    const data = reactive({
      trackTypeValue: props.value,
      skipOnFocus: false,
    });
    const typeInputBoxRef = ref(undefined as undefined | HTMLInputElement);

    function input(event: InputEvent) {
      const element = event.currentTarget as HTMLInputElement;
      emit('input', element.value);
    }

    /* Update internal model if external prop changes */
    watch(toRef(props, 'value'), (val) => { data.trackTypeValue = val; });

    function focusType() {
      if (props.selected && typeInputBoxRef.value !== undefined) {
        data.skipOnFocus = true;
        typeInputBoxRef.value.focus();
        if (!props.lockTypes) {
          typeInputBoxRef.value.select();
        }
      }
    }

    function blurType(e: KeyboardEvent) {
      (e.target as HTMLInputElement).blur();
    }

    function onBlur(e: KeyboardEvent) {
      if (data.trackTypeValue.trim() === '') {
        data.trackTypeValue = props.value;
      } else if (data.trackTypeValue !== props.value) {
        /* horrendous hack to prevent race. https://github.com/Kitware/dive/issues/475 */
        window.setTimeout(() => {
          emit('input', data.trackTypeValue);
        }, 100);
      }
      if (props.lockTypes) {
        blurType(e);
      }
    }

    function onFocus() {
      if (!data.skipOnFocus) {
        data.trackTypeValue = '';
      }
      data.skipOnFocus = false;
    }

    function onInputKeyEvent(e: KeyboardEvent) {
      switch (e.code) {
        case 'Escape':
        case 'Enter':
          blurType(e);
          break;
        case 'ArrowDown':
          data.trackTypeValue = '';
          break;
        default:
          break;
      }
    }

    return {
      data,
      typeInputBoxRef,
      input,
      focusType,
      onFocus,
      onBlur,
      onInputKeyEvent,
    };
  },
});
</script>

<template>
  <span>
    <select
      v-if="lockTypes"
      ref="typeInputBoxRef"
      v-model="data.trackTypeValue"
      class="input-box select-input"
      :disabled="readOnlyMode"
      @focus="onFocus"
      @change="onBlur"
      @keydown="onInputKeyEvent"
    >
      <option
        v-for="item in allTypes"
        :key="item"
        :value="item"
      >
        {{ item }}
      </option>
    </select>
    <input
      v-else
      ref="typeInputBoxRef"
      v-model="data.trackTypeValue"
      type="text"
      :list="dataListSource"
      class="input-box freeform-input"
      :disabled="readOnlyMode"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onInputKeyEvent"
    >
    <v-icon
      v-if="lockTypes"
      small
    >
      mdi-lock
    </v-icon>
    <span
      v-if="selected"
      v-mousetrap="[
        { bind: 'shift+enter', handler: focusType },
      ]"
    />
  </span>
</template>

<style lang="scss" scoped>
@import 'src/components/styles/common.scss';

.freeform-input {
  width: 135px;
}

.select-input {
  width: 120px;
  background-color: #1e1e1e;
  appearance: menulist;
}
</style>
