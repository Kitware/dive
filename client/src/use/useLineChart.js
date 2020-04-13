import { computed } from '@vue/composition-api';

export default function useLineChart({ filteredDetections, typeColorMap }) {
  const lineChartData = computed(() => {
    const _filteredDetections = filteredDetections.value;
    if (_filteredDetections.length === 0) {
      return null;
    }
    const types = new Map();
    const total = new Map();
    _filteredDetections.forEach((detection) => {
      const { frame } = detection;
      total.set(frame, total.get(frame) + 1 || 1);
      if (!detection.confidencePairs.length) {
        return;
      }
      const type = detection.confidencePairs[0][0];
      let typeCounter = types.get(type);
      if (!typeCounter) {
        typeCounter = new Map();
        types.set(type, typeCounter);
      }
      typeCounter.set(frame, typeCounter.get(frame) + 1 || 1);
    });
    return [
      {
        values: Array.from(total.entries()).sort((a, b) => a[0] - b[0]),
        color: 'lime',
        name: 'Total',
      },
      ...Array.from(types.entries()).map(([type, counter]) => ({
        values: Array.from(counter.entries()).sort((a, b) => a[0] - b[0]),
        name: type,
        color: typeColorMap(type),
      })),
    ];
  });

  return { lineChartData };
}
