<script lang="ts">
import Vue, { PropType } from 'vue';

export default Vue.extend({
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
      type: String,
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
  },
  data() {
    return {
      htmlElements: true,
      tempVal: null,
      skipOnFocus: false,
      boolOpts: [{ text: '', value: undefined },
        { text: 'true', value: true },
        { text: 'false', value: false },
      ],

    };
  },
  computed: {
    foo() { return this.value; },
  },
  mounted() {
    this.tempVal = this.value;
    if (this.focus && this.$refs.inputBoxRef) {
      this.$refs.inputBoxRef.focus();
      if (this.$refs.inputBoxRef.select) {
        console.log('SELECTING');
        this.$nextTick(() => this.$refs.inputBoxRef.focus());
      }
    }
  },

  methods: {
    change(newval: string | boolean | number | undefined | InputEvent): void {
      console.log(typeof (newval));
      if (typeof (newval) !== 'object') {
        this.changeVuetify(newval);
      } else if (newval.target) {
        this.changeVuetify(newval.target.value);
      }
    },
    blurType(e: KeyboardEvent) {
      (e.target as HTMLInputElement).blur();
    },
    onFocus() {
      if (!this.skipOnFocus) {
        this.tempVal = null;
      }
    },
    onInputKeyEvent(e: KeyboardEvent) {
      switch (e.code) {
        case 'Escape':
        case 'Enter':
          this.blurType(e);
          break;
        default:
          break;
      }
    },
    changeVuetify(newval: string | boolean | number | undefined): void {
      const { name } = this;
      let value;
      switch (newval) {
        case '':
        case ' ':
        case undefined:
          value = undefined;
          break;
        default:
          value = newval;
      }
      this.$emit('change', { name, value });
    },
  },
});
</script>

<template>
  <div>
    <div v-if="!htmlElements">
      <v-combobox
        v-if="datatype === 'text'"
        :label="datatype"
        :value="value"
        :items="['', ...values]"
        autocomplete="off"
        dense
        @change="change"
      />
      <v-text-field
        v-else-if="datatype === 'number'"
        :label="datatype"
        :value="value"
        type="number"
        autocomplete="off"
        dense
        @change="change"
      />
      <v-select
        v-else-if="datatype === 'boolean'"
        :label="datatype"
        :value="value"
        :items="[
          { text: '', value: undefined },
          { text: 'true', value: true },
          { text: 'false', value: false }
        ]"
        dense
        @change="change"
      />
    </div>
    <div v-else>
      <datalist
        v-if="datatype === 'text'"
        :id="`optionsList_${_uid}`"
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
        :list="`optionsList_${_uid}`"
        class="input-box"
        @change="change"
        @focus="onFocus"
        @keydown="onInputKeyEvent"
      >
      <input
        v-else-if="datatype === 'number'"
        ref="inputBoxRef"
        :label="datatype"
        :value="value"
        class="input-box"
        type="number"
        @change="change"
        @keydown="onInputKeyEvent"
      >
      <select
        v-else-if="datatype === 'boolean'"
        ref="inputBoxRef"
        :label="datatype"
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

</style>
