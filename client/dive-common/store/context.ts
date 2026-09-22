import { reactive, Component } from 'vue';
/* Components */
import TypeThreshold from 'dive-common/components/TypeThreshold.vue';
import ImageEnhancements from 'vue-media-annotator/components/ImageEnhancements.vue';
import GroupSidebar from 'dive-common/components/GroupSidebar.vue';
import AttributesSideBar from 'dive-common/components/Attributes/AttributesSideBar.vue';
import MultiCamTools from 'dive-common/components/MultiCamTools.vue';
import RegistrationTools from 'dive-common/components/CameraRegistration/RegistrationTools.vue';
import AttributeTrackFilters from 'vue-media-annotator/components/AttributeTrackFilters.vue';
import DatasetInfo from 'dive-common/components/DatasetInfo/DatasetInfo.vue';

interface ContextState {
  last: string;
  active: string | null;
  subCategory: string | null;
}

interface ComponentMapItem {
  description: string;
  component: Component;
}

// The pane the context sidebar opens on, here and after every dataset load via resetActive.
const DEFAULT_CONTEXT = 'DatasetInfo';

const state: ContextState = reactive({
  last: DEFAULT_CONTEXT,
  active: null,
  subCategory: null,
});

const componentMapEntries: ComponentMapItem[] = [
  {
    description: 'Dataset Info',
    component: DatasetInfo,
  },
  {
    description: 'Threshold Controls',
    component: TypeThreshold,
  },
  {
    description: 'Image Enhancements',
    component: ImageEnhancements,
  },
  {
    description: 'Group Manager',
    component: GroupSidebar,
  },
  {
    description: 'Multi Camera Tools',
    component: MultiCamTools,
  },
  {
    description: 'Camera Registration',
    component: RegistrationTools,
  },
  {
    description: 'Attribute Details',
    component: AttributesSideBar,
  },
  {
    description: 'Attribute Track Filters',
    component: AttributeTrackFilters,
  },
];

const componentMap: Record<string, ComponentMapItem> = Object.fromEntries(
  componentMapEntries.map((item) => [item.component.name || 'default', item]),
);

function register(item: ComponentMapItem) {
  componentMap[item.component.name || 'default'] = item;
}

function unregister(item: ComponentMapItem) {
  if (componentMap[item.component.name || 'default']) {
    delete componentMap[item.component.name || 'default'];
  }
}

function resetActive() {
  state.last = DEFAULT_CONTEXT;
  state.active = null;
}

function getComponents() {
  const components: Record<string, Component> = {};
  Object.values(componentMap).forEach((v) => {
    components[v.component.name || 'default'] = v.component;
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

function openClose(active: string, action: boolean, subCategory?: string) {
  if (action) {
    if (state.active) {
      state.last = state.active;
    }
    state.active = active;
  } else {
    if (state.active) {
      state.last = state.active;
      state.subCategory = null;
    }
    state.active = null;
  }
  if (subCategory) {
    state.subCategory = subCategory;
  }
}

export default {
  toggle,
  openClose,
  register,
  unregister,
  getComponents,
  resetActive,
  componentMap,
  state,
};
