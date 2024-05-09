import { getCurrentInstance } from 'vue';

const useVuetify = () => {
  const vm = getCurrentInstance();
  return vm?.proxy?.$vuetify || undefined;
};

export default useVuetify;
