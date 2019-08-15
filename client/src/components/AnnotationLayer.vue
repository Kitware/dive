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
    }
    // featureStyle: {
    //   type: Object,
    //   required: false
    // }
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
        // clearTimeout(this._viewerClickHandle);
        if (e.mouse.buttonsDown.left) {
          // this.trigger("detectionLeftClick", e.data);
        } else if (e.mouse.buttonsDown.right) {
          // this.trigger("detectionRightClick", e.data);
        }
      });
    this.detectionFeature.geoOn(
      geo.event.feature.mouseclick_order,
      this.detectionFeature.mouseOverOrderClosestBorder
    );

    this.detectionFeature
      .data(this.data)
      .polygon(item => {
        var coords = item.polygon.coordinates[0];
        return {
          outer: [
            { x: coords[0][0], y: coords[0][1] },
            { x: coords[1][0], y: coords[1][1] },
            { x: coords[2][0], y: coords[2][1] },
            { x: coords[3][0], y: coords[3][1] }
          ]
        };
      })
      .style({
        uniformPolygon: true,
        // stroke: true,
        strokeColor: "lime",
        strokeWidth: 1,
        fill: false
      });
    this.updateStyle();
  },
  beforeDestroy() {
    this.annotator.viewer.removeChild(this.featureLayer);
  },
  methods: {
    updateStyle(frame) {
      // console.log("updateStyle", frame);
      this.detectionFeature
        .style({
          stroke: d => {
            return d.frame === this.annotator.frame;
          }
        })
        .draw();
    }
  },
  render() {
    return null;
  }
};
</script>
