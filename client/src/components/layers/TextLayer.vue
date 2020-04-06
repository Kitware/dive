<script>
export default {
  name: 'TextLayer',
  inject: ['annotator'],
  props: {
    data: {
      type: Array,
    },
    textStyle: {
      type: Object,
      required: false,
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
    textStyle() {
      this.updateStyle();
    },
    frameMap() {
      this.frameChanged();
    },
  },
  mounted() {
    this.featureLayer = this.annotator.geoViewer.createLayer('feature', {
      features: ['text'],
    });
    this.textFeature = this.featureLayer
      .createFeature('text')
      .text((data) => data.text)
      .position((data) => ({ x: data.x, y: data.y }));
    this.frameChanged();
    this.updateStyle();
  },
  methods: {
    frameChanged() {
      const frame = this.annotator.syncedFrame;
      let data = this.frameMap.get(frame);
      data = data || [];
      this.textFeature.data(data).draw();
    },
    updateStyle() {
      let offset = {
        x: 3,
        y: 0,
      };
      if (this.textStyle.offsetX || this.textStyle.offsetY) {
        offset = (a, b, c) => ({
          x: this.textStyle.offsetX ? this.textStyle.offsetX(a, b, c) : 3,
          y: this.textStyle.offsetY ? this.textStyle.offsetY(a, b, c) : 0,
        });
      }
      const style = {
        ...{
          fontSize: '14px',
          textAlign: 'left',
          color: 'lime',
          textBaseline: 'top',
          offset,
        },
        ...this.textStyle,
      };
      this.textFeature.style(style).draw();
    },
  },
  render() {
    return null;
  },
};
</script>
