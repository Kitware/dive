import { getCurrentInstance, inject } from 'vue';

const useVuetify = () => {
  const injected = inject('vuetify');
  if (injected) {
    return injected;
  }

  const vm = getCurrentInstance();
  if (vm?.proxy?.$vuetify !== undefined) {
    return vm.proxy.$vuetify;
  }

  throw new Error('Vuetify is undefined');
};

export default useVuetify;
