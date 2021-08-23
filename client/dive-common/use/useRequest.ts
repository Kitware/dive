import { ref } from '@vue/composition-api';
import { getResponseError } from 'vue-media-annotator/utils';

export default function useRequest() {
  const loading = ref(false); // indicates request in progres
  const error = ref(null as string | null); // indicates request failure
  const count = ref(0); // indicates number of successful calls

  async function request<T>(func: () => Promise<T>) {
    try {
      loading.value = true;
      error.value = null;
      const val = await func();
      loading.value = false;
      count.value += 1;
      return val;
    } catch (err) {
      loading.value = false;
      error.value = getResponseError(err);
      throw err;
    }
  }

  return {
    count,
    loading,
    error,
    request,
  };
}
