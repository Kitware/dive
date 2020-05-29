<script>
export default {
  name: 'MarkerLayer',
  inject: ['annotator'],
  props: {
    data: {
      type: Array,
      required: true,
    },
    markerStyle: {
      type: Object,
      default: () => 'foo',
    },
  },
  computed: {
    frameMap() {
      const map = new Map();
      this.data.forEach((record) => {
        let arr = map.get(record.frame);
        if (!map.has(record.frame)) {
          arr = [];
          map.set(record.frame, arr);
        }
        arr.push(record);
      });
      return map;
    },
  },
  watch: {
    'annotator.syncedFrame': {
      sync: true,
      handler() {
        this.frameChanged();
      },
    },
    markerStyle() {
      this.updateStyle();
    },
    frameMap() {
      this.frameChanged();
    },
  },
  mounted() {
    this.featureLayer = this.annotator.geoViewer.createLayer('feature', {
      features: ['point'],
    });
    this.pointFeature = this.featureLayer.createFeature('point');
    this.frameChanged();
    this.updateStyle();
  },
  beforeDestroy() {
    this.pointFeature.data([]).draw();
    this.annotator.geoViewer.removeChild(this.featureLayer);
  },
  methods: {
    frameChanged() {
      const frame = this.annotator.syncedFrame;
      let data = this.frameMap.get(frame);
      data = data || [];
      this.pointFeature.data(data).draw();
    },
    updateStyle() {
      this.pointFeature.style(this.markerStyle).draw();
    },
  },
};
</script>
