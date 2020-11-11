# VIAME Web Frontend

This directory contains the code for both

* The specific VIAME-Web client deployed to [viame.kitware.com](https://viame.kitware.com)
* The web annotation library published to npm as [`vue-media-annotator`](https://developer.aliyun.com/mirror/npm/package/vue-media-annotator)

## Development

``` bash
# install dependencies
yarn

# run development server
yarn serve

# build for production
yarn build:web

# build vue-media-server library
yarn build:lib

# build electron
yarn build:electron

# lint
yarn lint
yarn lint:templates

# Local verification of all tests, linting, builds
./checkbuild.sh
```

See [this issue](https://github.com/vuejs/vue-cli/issues/3065) for details on why our `yarn serve` command is weird.

## Publishing

Create a new release tagged `X.X.X` through github.

## Architecture

### src/components/annotators

These components form the base of an annotator instance.  They construct the geojs instance and maintain state.  State is shared with layers through a special provide/inject mechanism.  The annotator API is documented in `src/components/annotators/README.md`

* This provide/inject mechanism uses a distinct Vue instance as a convenience to share reactive state and provide a means for injectors to signal back through `$emit`.
* The somewhat uncommon `provide()` function is used because the special instance is tied to its parent's lifecycle and cannot be hoisted.

### src/layers

These layers are provided to an annotator as slots and can inject their parent annotator state.  Generally, a layer will set up a watcher on that state and update their own GeoJS features based on that.  These watchers may run at up to 60hz so performance considerations matter.

* Layers must be vue instances to integrate with Vue's reactivity system.
* Layers must be independent instances (not mixins or composition functions) because they need their own lifecycle hooks (and otherwise, would have to maintain state about whether or not they are enabled). Layers rely on the Vue lifecycle to destroy them when their features are not needed to prevent unnecessary updates in the cricial path.

This application has many layers that interact, requiring a manager `src/components/LayerManager.vue`.

### src/components/controls

Controllers are like layers, but without geojs functionality.  They usually provide some UI wigetry to manipulate the annotator state (such as playblack position or playpause state).

### src/use

These are Vue 3 composition functions that an annotation application can use.  They mostly provide the data structures that the above layers and consumers need.  For example:

* `src/use/useTrackStore.ts` provides an efficient data structure for holding track instances.  It provides reactivity when individual tracks are updated, added, and removed, and can provide fast lookup by trackid and frame.
* `src/use/useTrackFilters.ts` takes a trackstore's return values as params and provides filtering by type and trackid.
* `src/use/useTrackSelectionControls.ts` takes trackstore return values and provides state and mutations for selection
* `src/use/useEventChart.ts` takes trackstore, filter, and selection as params and returns an object used by the `EventChart.vue` component to display a contextual timeline of all tracks in the store.

The major benefits of the `src/use` style are:

* testability.  These composition functions are easy to harness with unit tests.
* modularity.  Private behavior is hidden, and further refactors and features have less opportunity to break neighboring code
* sanity.  All this logic and state is technically contained in a single component.
* typescript adoption.  Typescript will be easier to incrementally adopt.

### src/provides

Provides a common, typed interface for components and composition functions to access singleton state like `trackMap`, `selectedTrackId`, and many others.

This pattern has similar trade-offs to Vuex; It makes component re-use with different state more difficult.  The provide/inject style using typed functions provides similar type safety and DRY advantages while allowing downstream library consumers to wrap and customize state, such as with chained computed properties.

``` typescript
/* Example consumer */
provide(...state); // downstream provides a collection of refs and other state expected by the library.

/* Example librarty component */
import { useSelectedTrackId } from 'vue-media-annotator/provides';
const selectedTrackIdRef = useSelectedTrackId();
```

This style guarantees matching types are passed through provide and inject without having to replicate the type definition through possibly many layers of `props:{}` type definitions, and automatically wraps with `readonly` to prevent short-circut updates.

## Tests

Note that `tsconfig.spec.json` is an exact copy of `tsconfig.json` but the `target` and `module` are changed such that babel is not required for jest to execute tests.

## Typescript vue-media-annotator library

Parts of the annotator in `src/` can be included from an external annotator library.  Requires `@vue/composition-api`.

``` bash
npm install vue-media-annotator
```

Now include the parts you want.

``` js
import {
  providers,
  use,
  Track,
  components,
} from 'vue-media-annotator/lib';

const {
  VideoAnnotator, LayerManager, Controls, TimelineWrapper, Timeline, LineChart,
} = components;
```

> **Note** that you must abandon `vuetify-loader` in order to use this lib.  It relies on vuetify's components to be registered with the global context, which doesn't happen with an a-la-carte installation.

> **Note** you can clone this repo, use `yarn link`, and `yarn link vue-media-annotator` in your own project to modify the source library as you go.  You'll have to `yarn build:lib` after changes, and you must `mv node_modeles/ node_modules.old/` in order to prevent your consumer app from using this project's `node_modules` libs instead of yours.  This could cause problems like multiple instances of vue or composition api.

The above problems are known and we are working to solve them.
