<script>
import geo from 'geojs';

export default {
  name: 'AnnotationLayer',
  inject: ['annotator'],
  props: {
    data: {
      // Array<{{ frame: number, polygon: Object }}>
      type: Array,
      required: true,
    },
    annotationStyle: {
      type: Object,
      default: () => {},
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
        const coords = record.polygon.coordinates[0];
        arr.push({
          record,
          geometry: {
            outer: [
              { x: coords[0][0], y: coords[0][1] },
              { x: coords[1][0], y: coords[1][1] },
              { x: coords[2][0], y: coords[2][1] },
              { x: coords[3][0], y: coords[3][1] },
            ],
          },
        });
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
    annotationStyle() {
      this.updateStyle();
    },
    frameMap() {
      this.frameChanged();
    },
  },
  mounted() {
    this.featureLayer = this.annotator.geoViewer.createLayer('feature', {
      features: ['point', 'line', 'polygon'],
    });
    this.polygonFeature = this.featureLayer
      .createFeature('polygon', { selectionAPI: true })
      .geoOn(geo.event.feature.mouseclick, (e) => {
        if (e.mouse.buttonsDown.left) {
          this.$emit('annotation-click', e.data.record, e);
        } else if (e.mouse.buttonsDown.right) {
          this.$emit('annotation-right-click', e.data.record, e);
        }
      });
    this.polygonFeature.geoOn(geo.event.feature.mousemove, (e) => {
      const calcVel = Math.abs(e.mouse.velocity.x) + Math.abs(e.mouse.velocity.y);
      const interactorOpts = this.annotator.geoViewer.interactor().options();
      const { cancelOnMove } = interactorOpts.click;
      if (cancelOnMove && calcVel < 1) {
        interactorOpts.click.cancelOnMove = false;
      } else if (!cancelOnMove) {
        interactorOpts.click.cancelOnMove = true;
      }
      if (cancelOnMove !== interactorOpts.click.cancelOnMove) {
        this.annotator.geoViewer.interactor().options(interactorOpts);
      }
    });
    this.polygonFeature.geoOn(geo.event.feature.mouseoff, () => {
      const interactorOpts = this.annotator.geoViewer.interactor().options();
      const { cancelOnMove } = interactorOpts.click;
      interactorOpts.click.cancelOnMove = true;
      if (cancelOnMove !== interactorOpts.click.cancelOnMove) {
        this.annotator.geoViewer.interactor().options(interactorOpts);
      }
    });
    this.polygonFeature.geoOn(
      geo.event.feature.mouseclick_order,
      this.polygonFeature.mouseOverOrderClosestBorder,
    );
    this.frameChanged();
    this.updateStyle();
  },
  beforeDestroy() {
    this.annotator.geoViewer.removeChild(this.featureLayer);
  },
  methods: {
    updateStyle() {
      const style = {
        ...{
          stroke: true,
          uniformPolygon: true,
          strokeColor: this.$vuetify.theme.themes.dark.accent,
          strokeWidth: 1,
          fill: false,
        },
        ...this.annotationStyle,
      };
      this.polygonFeature.style(style).draw();
    },
    frameChanged() {
      const frame = this.annotator.syncedFrame;
      let data = this.frameMap.get(frame);
      data = data || [];
      this.polygonFeature
        .data(data)
        .polygon((d) => d.geometry)
        .draw();
    },
  },
  render() {
    return null;
  },
};
</script>
