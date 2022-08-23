# DIVE Frontend

This directory contains the code for:

* The DIVE web client deployed to [viame.kitware.com](https://viame.kitware.com)
* The DIVE desktop electron app.
* The annotation js library published to npm as [`vue-media-annotator`](https://www.npmjs.com/package/vue-media-annotator)

## Development

Requires Node 16 due to [this webpack issue](https://github.com/webpack/webpack/issues/14532) and the fact that we are on vue cli service v4.  Should be resolved by upgrading to v5, which is not yet released.

``` bash
# install dependencies
yarn

# run development server
yarn serve

# build for production
yarn build:web

# build vue-media-server library
yarn build:lib

# Electron
yarn serve:electron
yarn build:electron

# lint and test
yarn lint
yarn lint:templates
yarn test

# Local verification of all tests, linting, builds
./checkbuild.sh
```

### CLI Tools

``` bash
# Build
yarn build:cli

# Watch (requires above build at least once)
yarn dev:cli

# Run in development mode
yarn divecli --help

# Parse VIAME CSV
yarn divecli viame2json /path/to/viame.csv

# Parse DIVE JSON
yarn divecli json2viame /path/to/results.json /path/to/meta.json

# output to file, suppress yarn's stdout
yarn --silent divecli viame2json /path/to/viame.csv > tracks.json
```

Configuration abnormalities:

> **Note** tsconfig.cli.json is used to build the cli.  It's necessary to specify the exact files along the import path of the cli.js entrypoint, and if new files are added, they will need to be added manually.  Build errors should alert you to this.

* `tsconfig.json`: `{ target: 'es2018' }` used because renderer/web uses babel but background does not, and [webpack doesn't support esnext](https://stackoverflow.com/questions/58813176/webpack-cant-compile-ts-3-7-optional-chaining-nullish-coalescing)
* [acorn unexpected token webpack issue (unused, just useful)](https://github.com/webpack/webpack/issues/10227)
* [Why our yarn serve is weird](https://github.com/vuejs/vue-cli/issues/3065)
* [Typescript Absolute -> Relative Paths](https://github.com/microsoft/TypeScript/issues/15479)
* [electron-builder on MacOS arm64](https://github.com/electron-userland/electron-builder/issues/6726)

## Publishing

Create a new release tagged `X.X.X` through github.

## Architecture

## Division

The client is broken into 4 main folders which separate different parts of the system.
* **Vue Media Annotator**
  * Location: ./src
  * Description: The basic annotator which uses a JSON data structure in conjunction with media URLs (image or video) to draw and edit annotations within a web component.
  * Items specific to the Web or Desktop Instance aren't included in this directory.
* **DIVE Interface**
  * Location: `/dive-common`
  * Description: Interface surrounding the media annotator and Vue utility plugins for keyboard commands and prompting users.  Organization of the lists of tracks/groups.  Provides UI to import/export data and run pipelines/training on the data.
* **Web Application**
  * Location: `/platform/web-girder`
  * Description: Web/Girder client specific code such as API interfaces and girder-web-components for viewing folders and data from a Girder backend.  All backend code for the Girder Application is written in Python and is in the ../server directory (outside of the ./client directory).
* **Desktop Application**
  * Location: `/platform/desktop`
  * Description:  The desktop application uses Electron and interfaces directly with files on the user's desktop.  To replicate the functionality of the Girder application, an ExpressJS server is used with similar endpoints as Girder.  There are additional NodeJS functions to manage serving files and running pipelines/training on datasets.
  * Backend
    * Location: `/platform/desktop/backend/server.ts`
    * Description:  Contains the ExpressJS server to replicate the functionality of the girder server for electron.  
      * **Native**
        * Location: `/platform/desktop/backend/native/`
        * Description:  Replicates functionality for managing data import/export and for running pipelines/training and other tasks.
      * **Serializers**
        * Location: `/platform/desktop/backend/serializers`
        * Description: Handles conversion between different annotation formats for the electron version.

## Unified API Specification

To resuse as much code as possible between the Desktop and Web versions there is a unified API which provides the capability to export/import/save/delete annotations and metadata as well as run training and configuration pipelines.  This API allows both versions to share the `/dive-common` and `/src` folders while handling these calls differently.

## Annotation Viewer Organization

### ViewerLoader.vue
* Location: `./platform/desktop/frontend/components/ViewerLoader.vue` or `./platform/web-girder/views/ViewerLoader.vue
* This file will instantiate the main Viewer.vue component for the annotation viewer.  It provides the basic properties to the Viewer.
  * Props:
    * **id:** Dataset ID to be loaded.  This is used to make requests to girder/electron express server  to load the annotations from the datasetId.
    * **revision:** Web only, provides the current revision of the data so the user can access previous revisions
    * **read-only-mode:** sets read only mode when it is set in the settings for Desktop or if a pipeline is currently running on the dataset.
## Viewer.vue
* Location: `./dive-common/components/Viewer.vue`
* The main unified root of the annotation viewer.  This is the entry point for the app where all data is collated and passed down to the different components for rendering and displaying.
* **use{X} Initializations**
  * There are several functions called use{X} where X is the name of the category of functionality that is provided.
  * These functions provide reactivity and editing capabilities to the data that is loaded in the system
  * Many of these functions and reactive properties are passed into `provideAnnotator` for use in other components
  * Example: `useSave`
    * `useSave` has arguments which include the current datasetId and the readonlyState.
    * Returned Values:
      * save - function to save data to the server/electron
      * markChangesPending - function to indicate that there are new changes that needs to be saved
      * pendingSaveCount - a reactive number providing the number of changes from the last save
      * addCamera/removeCamera - a function to add/remove cameras for multicam data.
* **loadData** function
  * This is where the annotations and metadata are loaded into the system
  * MultiCamera
    * In the case of multi-camera data (only available on desktop) the cameraStore will create a camera for each.  Each cameraStore will have a trackStore and groupStore where the annotations will be stored.
  * Media Data is also loaded in this function.  Either that is a single video URL or a list of images.
* **provideAnnotator** Function
  * The provideAnnotator function will take the resulting reactive data and functions to interact with the reactive data and give a way in which lower components can inject this information to interact with it.
  * I.E. The annotator can `import { useselectedTrackId } from ‘vue-media-annotator/provides’` to use a reactive property of the selected trackId.
  * For performance reasons all reactive properties are read-only and rely on functions to modify.


## Anotations and Media Viewer (/src/*)
### src/*.ts

Use ES6 classes to implement stateful modules that form the core of the application.  We previously used composition functions, but these became unweildy as more state needed to be pushed through the `src/provides.ts` interface.  Classes like `TrackStore.ts` can encapsulate related states and functions, and we can make use of traditional inheritance design patterns like base classes.

### src/components/annotators

These components form the base of an annotator instance.  The root display for Media (Images or Video) are located in this folder.  They construct the geojs instance and maintain state.  State is shared with layers through a special provide/inject mechanism.  The annotator API is documented in `src/components/annotators/README.md`

* This provide/inject mechanism uses a distinct Vue instance as a convenience to share reactive state and provide a means for injectors to signal back through `$emit`.
* The somewhat uncommon `provide()` function is used because the special instance is tied to its parent's lifecycle and cannot be hoisted.

**useMediaController:** allows for synchronizing the state among multiple cameras in multi-cam mode as well as allowing the other components to view/set the current frame or playback.

### src/layers

These layers are provided to an annotator as slots and can inject their parent annotator state.  Generally, a layer will set up a watcher on that state and update their own GeoJS features based on that.  These watchers may run at up to 60hz so performance considerations matter.

* Layers must be vue instances to integrate with Vue's reactivity system.
* Layers must be independent instances (not mixins or composition functions) because they need their own lifecycle hooks (and otherwise, would have to maintain state about whether or not they are enabled). Layers rely on the Vue lifecycle to destroy them when their features are not needed to prevent unnecessary updates in the cricial path.

This application has many layers that interact, requiring a manager `src/components/LayerManager.vue`.

**EditAnnotationLayer.ts**

Editing and Creation of all annotation types is handled in `EditAnnotationLayer.ts`.  The EditAnnotationLayer bubbles up edits to the LayerManager which through `provides` will pass the editing to `useModeManager`.  `useModeManager` will make decisions about how to update the state of DIVE as well as updating the annotation data in the `trackStore`

Annotation Editing Flow:
* EditAnnotationLayer
* LayerManager
* provides (handler)
* useModeManager

### LayerManager.vue

Layer manager uses the `/src/provides.ts` to view the current frame and tracks that should be visible for the frame and draw them on the screen.  The function `updateLayers` is connected to a watcher which watches for changes in frame, selectedTrack, the visiblity of tracks provided, and Annotator preferences (visibility of certain annotation types or track tail length).

### src/components/controls

Controllers are like layers, but without geojs functionality.  They usually provide some UI wigetry to manipulate the annotator state (such as playblack position or playpause state).
The timeline representation of tracks for graphing is located in the constrols as well.

### src/provides

Provides a common, typed interface for components and composition functions to access singleton state like `trackStore`, `selectedTrackId`, and many others.

This pattern has similar trade-offs to Vuex; It makes component re-use with different state more difficult.  The provide/inject style using typed functions provides similar type safety and DRY advantages while allowing downstream library consumers to wrap and customize state, such as with chained computed properties.

``` typescript
/* Example consumer */
provide(...state); // downstream provides a collection of refs and other state expected by the library.

/* Example librarty component */
import { useSelectedTrackId } from 'vue-media-annotator/provides';
const selectedTrackIdRef = useSelectedTrackId();
```

This style guarantees matching types are passed through provide and inject without having to replicate the type definition through possibly many layers of `props:{}` type definitions, and automatically wraps with `readonly` to prevent short-circut updates.

### /src/use

The use{x} files in this folder pertain directly to media or annotation information.  These objects will be used in `provides.ts` so that other components can access and manipulate the data.

`useEventChart` and `useLineChart` take the visible tracks and format the data for drawing in swimlane or line graph formats

`useAttributes` provide a reactive list of templates to show the attributes to the user.  Attribute Filters and generation of Attribute Graphs are also configured and retrieved through `useAttributes`.  Attributes that don't have a template defined in the metadata will not be shown to the user.  On import the backend (both web and desktop) will attempt to auto generate these attribute templates based on the values provided.

## DIVE Interface (/dive-common)

The DIVE interfaces handles the loading of data in Viewer.vue and manages the layout of components provided in `/src` and the state managment of the system through `useModeManager`

### useModeManager (/dive-common/use/useModeManager.ts)

useModeManager.ts is used to manage the current state and state transitions within the DIVE application (e.g.,
transitioning between selected, editing, deletion, modification, etc.).  Most interactions that operate on the annotation data are coordinated through useModeManager.
Many of the functions and reactive properties are sent to `./src/provides.ts` to allow components to view and manipulate the current state.
Recipes (`./dive-common/recipes/`) allow for custom workflows when creating annotations.


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
  VideoAnnotator, LayerManager, Controls, Timeline, LineChart,
} = components;
```

> **Note** that you must abandon `vuetify-loader` in order to use this lib.  It relies on vuetify's components to be registered with the global context, which doesn't happen with an a-la-carte installation.

> **Note** you can clone this repo, use `yarn link`, and `yarn link vue-media-annotator` in your own project to modify the source library as you go.  You'll have to `yarn build:lib` after changes, and you must `mv node_modeles/ node_modules.old/` in order to prevent your consumer app from using this project's `node_modules` libs instead of yours.  This could cause problems like multiple instances of vue or composition api.

The above problems are known and we are working to solve them.
