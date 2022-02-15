import { reactive, toRefs } from '@vue/composition-api';
import { AxiosError } from 'axios';
import { getResponseError } from 'vue-media-annotator/utils';

export default function useRequest() {
  const state = reactive({
    loading: false, // indicates request in progress
    error: null as string | null, // indicates request failure
    count: 0, // indicates number of successful calls
  });

  async function request<T>(func: () => Promise<T>) {
    try {
      state.loading = true;
      state.error = null;
      state.count += 1;
      const val = await func();
      state.loading = false;
      return val;
    } catch (err) {
      state.loading = false;
      state.error = getResponseError(err as AxiosError);
      throw err;
    }
  }

  async function reset() {
    state.loading = false;
    state.error = null;
    state.count = 0;
  }

  return {
    ...toRefs(state),
    state,
    request,
    reset,
  };
}
