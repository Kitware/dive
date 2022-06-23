import Install, { reactive } from '@vue/composition-api';
import Vue, { VueConstructor } from 'vue';
/* Components */
import TypeThreshold from 'dive-common/components/TypeThreshold.vue';
import ImageEnhancements from 'vue-media-annotator/components/ImageEnhancements.vue';
import GroupSidebar from 'dive-common/components/GroupSidebar.vue';
import MultiCamTools from 'dive-common/components/MultiCamTools.vue';

Vue.use(Install);

interface ContextState {
  last: string;
  active: string | null;
}

interface ComponentMapItem {
  description: string;
  component: VueConstructor<Vue>;
}

const state: ContextState = reactive({
  last: 'TypeThreshold',
  active: null,
});

const componentMap: Record<string, ComponentMapItem> = {
  [TypeThreshold.name]: {
    description: 'Threshold Controls',
    component: TypeThreshold,
  },
  [ImageEnhancements.name]: {
    description: 'Image Enhancements',
    component: ImageEnhancements,
  },
  [GroupSidebar.name]: {
    description: 'Group Manager',
    component: GroupSidebar,
  },
  [MultiCamTools.name]: {
    description: 'Multi Camera Tools',
    component: MultiCamTools,
  },
};

function register(item: ComponentMapItem) {
  componentMap[item.component.name] = item;
}

function unregister(item: ComponentMapItem) {
  if (componentMap[item.component.name]) {
    delete componentMap[item.component.name];
  }
}

function resetActive() {
  state.last = 'TypeThreshold';
  state.active = null;
}

function getComponents() {
  const components: Record<string, VueConstructor<Vue>> = {};
  Object.values(componentMap).forEach((v) => {
    components[v.component.name] = v.component;
  });
  return components;
}

function toggle(active: string | null | undefined) {
  if (active === undefined) {
    if (state.active) {
      state.active = null;
    } else {
      state.active = state.last;
    }
  } else if (active && state.active === active) {
    state.active = null;
  } else if (active === null || active in componentMap) {
    state.active = active;
    if (active) {
      state.last = active;
    }
  } else {
    throw new Error(`${active} is not a valid context component`);
  }
  window.dispatchEvent(new Event('resize'));
}

export default {
  toggle,
  register,
  unregister,
  getComponents,
  resetActive,
  componentMap,
  state,
};
