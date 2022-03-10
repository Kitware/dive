import Install, { reactive } from '@vue/composition-api';
import Vue from 'vue';
/* Components */
import TypeThreshold from 'dive-common/components/TypeThreshold.vue';
import ImageEnhancements from 'dive-common/components/ImageEnhancements.vue';

Vue.use(Install);


const componentMap = {
  TypeThreshold,
  ImageEnhancements,
};

type ContextType = keyof typeof componentMap;

interface ContextState {
  active: ContextType | null;
}

const state: ContextState = reactive({
  active: null,
});

function toggle(active: ContextType | null) {
  if (active && state.active === active) {
    state.active = null;
  } else {
    state.active = active;
  }
  window.dispatchEvent(new Event('resize'));
}

export default {
  toggle,
  componentMap,
  state,
};
