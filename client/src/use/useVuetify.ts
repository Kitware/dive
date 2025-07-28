import { getCurrentInstance } from 'vue';

const useVuetify = () => {
  const vm = getCurrentInstance();
  if (vm?.proxy.$vuetify === undefined) {
    throw new Error('Vuetify is undefined');
  }
  return vm.proxy.$vuetify;
};

export default useVuetify;
