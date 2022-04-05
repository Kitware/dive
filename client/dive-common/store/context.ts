import Install, { reactive } from '@vue/composition-api';
import Vue, { VueConstructor } from 'vue';
/* Components */
import TypeThreshold from 'dive-common/components/TypeThreshold.vue';
import MultiCamTools from 'dive-common/components/MultiCamTools.vue';

Vue.use(Install);

interface ContextState {
  active: string | null;
}

interface ComponentMapItem {
  description: string;
  component: VueConstructor<Vue>;
}

const state: ContextState = reactive({
  active: null,
});

const componentMap: Record<string, ComponentMapItem> = {
  TypeThreshold: {
    description: 'Threshold Controls',
    component: TypeThreshold,
  },
  MultiCamTools: {
    description: 'Multicam Tools',
    component: MultiCamTools,
  },
};

function register(item: ComponentMapItem) {
  componentMap[item.component.name] = item;
}

function getComponents() {
  const components: Record<string, VueConstructor<Vue>> = {};
  Object.values(componentMap).forEach((v) => {
    components[v.component.name] = v.component;
  });
  return components;
}

function toggle(active: string | null) {
  if (active && state.active === active) {
    state.active = null;
  } else if (active === null || active in componentMap) {
    state.active = active;
  } else {
    throw new Error(`${active} is not a valid context component`);
  }
  window.dispatchEvent(new Event('resize'));
}

export default {
  toggle,
  register,
  getComponents,
  componentMap,
  state,
};
