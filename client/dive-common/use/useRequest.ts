import { reactive, shallowRef, toRefs } from '@vue/composition-api';
import { AxiosResponse } from 'axios';
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
      state.error = getResponseError(err);
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

export function usePaginatedRequest<T>() {
  const main = useRequest();
  const paginationParams = reactive({
    totalCount: 0,
    offset: 0,
    limit: 20,
  });
  const allPages = shallowRef([] as T[]);

  function reset() {
    paginationParams.totalCount = 0;
    paginationParams.offset = 0;
    paginationParams.limit = 20;
    allPages.value = [];
    main.reset();
  }

  async function loadNextPage(
    func: (limit: number, offset: number) => Promise<AxiosResponse<T[]>>,
  ) {
    const wrapped = () => main.request(() => func(paginationParams.limit, paginationParams.offset));
    const nextOffset = paginationParams.offset + paginationParams.limit;
    const maxOffset = (paginationParams.totalCount + paginationParams.limit);
    if (nextOffset < maxOffset || main.count.value === 0) {
      const resp = await wrapped();
      paginationParams.offset = nextOffset;
      paginationParams.totalCount = Number.parseInt(resp.headers['girder-total-count'], 10);
      allPages.value = allPages.value.concat(resp.data);
    }
  }

  return {
    ...main,
    ...toRefs(paginationParams),
    allPages,
    reset,
    loadNextPage,
  };
}
