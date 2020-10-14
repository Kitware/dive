
import { ref, onBeforeMount } from '@vue/composition-api';
import { useApi, Pipelines } from 'viame-web-common/apispec';

export default function usePipelines() {
  const { getPipelineList } = useApi();
  const pipelines = ref(null as null | Pipelines);

  onBeforeMount(async () => {
    const pls = await getPipelineList();
    Object.values(pls).forEach((category) => {
      category.pipes.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        if (aName > bName) {
          return 1;
        }
        if (aName < bName) {
          return -1;
        }
        return 0;
      });
    });
    pipelines.value = pls;
  });

  return pipelines;
}
