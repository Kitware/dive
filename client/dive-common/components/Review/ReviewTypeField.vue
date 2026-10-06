<script lang="ts">
import {
  computed, defineComponent, onBeforeUnmount, PropType, ref, watch,
} from 'vue';

/**
 * The type field under a review entry: a text input with a dropdown of the
 * known types. The dropdown is our own rather than a native datalist so its
 * button opens and closes it, it filters as you type, and it can float out
 * of the clipped cell. Commits on Enter, blur or picking an entry; Escape
 * reverts.
 */
export default defineComponent({
  name: 'ReviewTypeField',
  props: {
    value: {
      type: String,
      default: '',
    },
    options: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  setup(props, { emit }) {
    const text = ref(props.value);
    const open = ref(false);
    const input = ref<HTMLInputElement | null>(null);
    const root = ref<HTMLElement | null>(null);
    const menuStyle = ref<Record<string, string>>({});
    /** Index of the highlighted entry while the list is open. */
    const highlighted = ref(-1);

    watch(() => props.value, (next) => { text.value = next; });

    /** Typing filters the list; an untouched field shows every type. */
    const listed = computed(() => {
      const needle = text.value.trim().toLowerCase();
      if (!needle || text.value === props.value) return props.options;
      return props.options.filter((option) => option.toLowerCase().includes(needle));
    });

    function commit() {
      const next = text.value.trim();
      if (!next) {
        text.value = props.value;
      } else if (next !== props.value) {
        emit('commit', next);
      }
    }

    function place() {
      const el = input.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const height = Math.min(200, Math.max(below, rect.top) - 8);
      const above = below < 120 && rect.top > below;
      menuStyle.value = {
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        maxHeight: `${height}px`,
        ...(above ? { bottom: `${window.innerHeight - rect.top}px` } : { top: `${rect.bottom}px` }),
      };
    }

    function onDocumentPointerDown(event: PointerEvent) {
      if (root.value && !root.value.contains(event.target as Node)) close();
    }

    function openMenu() {
      if (props.disabled || open.value) return;
      place();
      highlighted.value = listed.value.indexOf(props.value);
      open.value = true;
      document.addEventListener('pointerdown', onDocumentPointerDown, true);
    }

    function close() {
      if (!open.value) return;
      open.value = false;
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    }

    function toggle() {
      if (open.value) close();
      else {
        openMenu();
        input.value?.focus();
      }
    }

    function pick(option: string) {
      text.value = option;
      close();
      commit();
    }

    function onInput() {
      if (!open.value) openMenu();
      highlighted.value = -1;
    }

    function onKeydown(event: KeyboardEvent) {
      if (event.key === 'Enter') {
        if (open.value && highlighted.value >= 0 && listed.value[highlighted.value] !== undefined) {
          pick(listed.value[highlighted.value]);
        } else {
          close();
          commit();
          input.value?.blur();
        }
      } else if (event.key === 'Escape') {
        text.value = props.value;
        close();
        input.value?.blur();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!open.value) openMenu();
        const count = listed.value.length;
        if (count) {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          highlighted.value = (highlighted.value + step + count) % count;
        }
        event.preventDefault();
      }
      // Arrow keys page the grid; keep them inside the field while typing.
      event.stopPropagation();
    }

    function onBlur() {
      // A click on the list blurs the input first; let the pick land.
      window.setTimeout(() => {
        if (!open.value) commit();
      }, 0);
    }

    onBeforeUnmount(close);

    return {
      text,
      open,
      input,
      root,
      menuStyle,
      highlighted,
      listed,
      toggle,
      pick,
      onInput,
      onKeydown,
      onBlur,
      close,
      commit,
    };
  },
});
</script>

<template>
  <div
    ref="root"
    class="type-field"
    :class="{ 'type-field-open': open }"
  >
    <input
      ref="input"
      v-model="text"
      type="text"
      class="cell-type-input"
      :disabled="disabled"
      :title="value"
      spellcheck="false"
      autocomplete="off"
      @input="onInput"
      @keydown="onKeydown"
      @blur="onBlur"
    >
    <button
      type="button"
      class="type-toggle"
      :disabled="disabled"
      :title="open ? 'Close the type list' : 'Choose a type'"
      tabindex="-1"
      @mousedown.prevent
      @click="toggle"
    >
      <v-icon small>
        {{ open ? 'mdi-menu-up' : 'mdi-menu-down' }}
      </v-icon>
    </button>
    <div
      v-if="open"
      class="type-menu"
      :style="menuStyle"
      @mousedown.prevent
    >
      <div
        v-if="listed.length === 0"
        class="type-option type-option-empty"
      >
        No matching type
      </div>
      <div
        v-for="(option, index) in listed"
        :key="option"
        class="type-option"
        :class="{ 'type-option-current': option === value, 'type-option-highlighted': index === highlighted }"
        @mouseenter="highlighted = index"
        @click="pick(option)"
      >
        {{ option }}
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.type-field {
  position: relative;
  display: flex;
  align-items: stretch;
  min-width: 0;
}

.cell-type-input {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: calc(2px * var(--cell-scale, 1)) calc(5px * var(--cell-scale, 1));
  padding-right: calc(22px * var(--cell-scale, 1));
  font-size: calc(13px * var(--cell-scale, 1));
  line-height: calc(19px * var(--cell-scale, 1));
  color: #eee;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 3px;
  outline: none;

  &:focus {
    border-color: #90caf9;
  }

  &:disabled {
    color: #888;
  }
}

.type-toggle {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: calc(22px * var(--cell-scale, 1));
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: #bbb;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: #fff;
  }

  &:disabled {
    color: #555;
    cursor: default;
  }
}

.type-menu {
  position: fixed;
  z-index: 20;
  overflow-y: auto;
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 3px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  font-size: calc(13px * var(--cell-scale, 1));
}

.type-option {
  padding: 3px 8px;
  color: #ddd;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &.type-option-highlighted {
    background: #3a3a3a;
  }

  &.type-option-current {
    color: #90caf9;
  }

  &.type-option-empty {
    color: #888;
    cursor: default;
  }
}
</style>
