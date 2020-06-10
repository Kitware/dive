# VIAMEWeb

## Development

``` bash
# install dependencies
yarn

# run development server
yarn serve

# build for production
yarn build

# lint
yarn lint
```

See [this issue](https://github.com/vuejs/vue-cli/issues/3065) for details on why our `yarn serve` command is weird.

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

### src/use

The modules in this directory are mostly used in `views/Viewer`, and follow Vue 3's composition API reusabiliity patterns.  These modules, or composition functions, seek to encapsulate state and functionality as a half-step before further refactoring some parts into vuex.

You can think of some parts of this application as being generically useful, like components on a switchboard.  Everything under `components/layers`, for example, is flexible enough that it could conceivably be used in any application dealing with time series annotations over imagery.  The code in `src/use`, on the other hand, is highly specialized to this application.  It is the business logic that unites all the disparate layers, controls, and events.  In MVC, `src/use` contains the models and controllers.

The major benefits of the `src/use` style are:

* testability.  These composition functions are easy to harness with unit tests.
* modularity.  Private behavior is hidden, and further refactors and features have less opportunity to break neighboring code
* sanity.  All this logic and state is technically contained in a single component.  For the sake of developer quality of life, it was necessary to break the 1000-line `Viewer.vue` file down into more digestable chunks.
* typescript adoption.  Typescript will be easier to incrementally adopt.

## Tests

Note that `tsconfig.spec.json` is an exact copy of `tsconfig.json` but the `target` and `module` are changed such that babel is not required for jest to execute tests.
