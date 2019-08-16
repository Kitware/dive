<script>
import geo from "geojs";

export default {
  name: "AnnotationLayer",
  inject: ["annotator"],
  props: {
    data: {
      type: Array,
      validator(data) {
        if (!Array.isArray(data)) {
          return false;
        }
        if (data.find(item => !Number.isInteger(item.frame) || !item.polygon)) {
          return false;
        }
        return true;
      }
    },
    featureStyle: {
      type: Object,
      required: false
    }
  },
  // computed:{
  //   opacity(){
  //     var frame = this.annotator.frame;
  //     return function(){

  //     }
  //   }
  // },
  watch: {
    "annotator.frame": {
      sync: true,
      handler() {
        this.detectionFeature.modified();
        this.detectionFeature.draw();
      }
    },
    featureStyle() {
      this.updateStyle();
    }
  },
  mounted() {
    // console.log('mounted');
    // console.log(this.annotator.viewer);
    var viewer = this.annotator.viewer;
    this.featureLayer = viewer.createLayer("feature", {
      features: ["point", "line", "polygon"]
    });
    this.detectionFeature = this.featureLayer
      .createFeature("polygon", { selectionAPI: true })
      .geoOn(geo.event.feature.mouseclick, e => {
        if (this.annotator.frame === e.data.frame) {
          if (e.mouse.buttonsDown.left) {
            this.$emit("annotation-click", e.data, e);
          } else if (e.mouse.buttonsDown.right) {
            this.$emit("annotation-left-click", e.data, e);
          }
        }
      });
    this.detectionFeature.geoOn(
      geo.event.feature.mouseclick_order,
      this.detectionFeature.mouseOverOrderClosestBorder
    );

    this.detectionFeature.data(this.data).polygon(item => {
      var coords = item.polygon.coordinates[0];
      return {
        outer: [
          { x: coords[0][0], y: coords[0][1] },
          { x: coords[1][0], y: coords[1][1] },
          { x: coords[2][0], y: coords[2][1] },
          { x: coords[3][0], y: coords[3][1] }
        ]
      };
    });
    this.updateStyle();
  },
  beforeDestroy() {
    this.annotator.viewer.removeChild(this.featureLayer);
  },
  methods: {
    updateStyle() {
      var annotator = this.annotator;
      var stroke = d => {
        return d.frame === annotator.frame;
      };
      if (this.featureStyle.stroke) {
        var externalStroke = this.featureStyle.stroke;
        var internalStroke = stroke;
        stroke = function(d) {
          return internalStroke(d) && externalStroke.apply(this, arguments);
        };
      }
      var style = {
        ...{ stroke },
        ...{
          uniformPolygon: true,
          strokeColor: "lime",
          strokeWidth: 1,
          fill: false
        },
        ...this.featureStyle
      };
      this.detectionFeature.style(style).draw();
    }
  },
  render() {
    return null;
  }
};
</script>
