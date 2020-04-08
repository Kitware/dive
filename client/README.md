# VIAMEWeb

## Development

``` bash
# install dependencies
npm install

# run development server
npm run serve

# build for production
npm run build

# lint
npm run lint
```

## Architecture

This application is built with GeoJS, and is rather unique in its structure.

### src/components/annotators

These components form the base of an annotator instance.  They construct the geojs instance and maintain state.  State is shared with layers through a special provide/inject mechanism.  The annotator API is documented in `src/components/annotators/README.md`

* This provide/inject mechanism uses a distinct Vue instance as a convenience to share reactive state and provide a means for injectors to signal back through `$emit`.
* The somewhat uncommon `provide()` function is used because the special instance is tied to its parent's lifecycle and cannot be hoisted.

### src/components/layers

These layers are provided to an annotator through slots and can inject annotator state.  Generally, a layer will set up a watcher on that state and update their own GeoJS layer features based on that.  These watchers may run at up to 60hz so performance considerations matter.

* Layers must be vue instances to integrate with Vue's reactivity system.
* Layers must be independent instances (not mixins or composition functions) because they need their own lifecycle hooks (and otherwise, would have to maintain state about whether or not they are enabled). Layers rely on the Vue lifecycle to destroy them when their features are not needed to prevent unnecessary updates in the cricial path.

#### example

Like layers, controls are provided to an annotatior via slots and inject state.

```vue
<script>
export default {
  inject: ['annotator'],
  watch: {
    'annotator.state': (newval) => {
      // react to changes in annotator state
    },
  },
  mounted() {
    // setup geojs layer
    this.$geojsLayer = this.annotator.geoViewer.createLayer(/*... */);
  },
  beforeDestroy() {
    this.annotator.geoViewer.deleteLayer(this.$geojsLayer);
    delete this.$geojsLayer;
  },
  methods: {
    onEvent(e) {
      this.annotator.$emit('method-name', e);
    },
  },
};
```

### src/components/controls

Controllers are like layers, but without geojs functionality.  They usually provide some UI wigetry to manipulate the annotator state (such as playblack position or playpause state).
