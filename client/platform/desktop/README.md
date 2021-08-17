# VIAME Electron Desktop client

> Codename Heavy(?)

## Why make a desktop version

* The desktop client is intended for annotation of datasets on your local filesystem.
* It may not be ideal for you to copy large datasets onto a server for annotation.
* Your personal workstation might be ideal for training and pipeline execution.
* You may prefer not to rely on Docker.

## General architecture

Electron applications are comprised of two main threads

* a node.js main thread with full access to the node environment
* a renderer thread which is like a browser tab that runs under a stricter security policy

Due to security concerns in the renderer thread, this app uses a small embedded node.js webserver to serve media content (images and videos) from disk.  This is actually the most reasonable way to stream bytes with range requests into a browser environment.

* The common frontend api is implemented in `api/`
* The backend services are implemented in `backend/`

## Desktop Dependencies

Currently, desktop-only dependencies are installed into devdependencies and linting errors are ignored inline.  This is to prevent desktop's dependencies from polluting the installation of `vue-media-annotator` from NPM.  Separating the many packaging needs of this project is an open discussion.

## IPC and data flow

Several kinds of inter-process communication are used between renderer and main.

* Synchronous IPC for short messages that resolve quickly.  Blocking IPC should generally be avoided.
* Asynchronous IPC for short messages that take longer.  This will be the majority of cases.
* HTTP Service running in main for very long messages.  IPC isn't good for passing large blobs.
  * Mostly used to read images and video from disk.
* Direct use of node.js native libraries from renderer, for loading large blobs to and from disk where streaming isn't useful.  HTTP is used for range queries, but for annotation files, there is no benefit to using the HTTP interface over direct filesystem access since JSON files must be loaded into memory 100% to be useful.

## Platform-specific methods

Due to tight OS coupling, some methods will have to be implemented to target a single platform. See `backend/platforms`.

## MultiCamera and Stereo Data Organization

Desktop has the capability to import and run pipelines on stereo and multicamera pipelines.  There is a Root folder as well as individual folders for each camera.  To achieve this the folder structure for storage of data is slightly different.

* Root Folder - Base folder which contains the multicamera dataset.  It is tied to a single camera folder which is known as the `defaultDisplay`.  The `defaultDisplay` is the camera that is shown by default when the dataset is loaded.  The Root Folder `meta.json` file will contain a parmeter called `multiCam` and this will point to the multicams in the dataset as well as provide the `defaultDisplay`.  When viewing cameras the cameraName for the `defaultDisplay` is 'Base MultiCam'.
* Camera Folders - Individual folders for each camera which behave like their own dataset with their own meta.json and annotations file.  This is achieved by giving them a dataset id of `RootFolder/CameraName`.

``` text
DIVE_Projects
├── stereodataset_jp7hq88vfv
│  ├── meta.json
│  ├── result_06-01-2021_10-55-38.627.json
│  ├── left
|  |  ├── auxiliary
|  │  │  └── result_06-01-2021_10-52-28.347.json
│  │  ├── meta.json
│  │  └── result_06-01-2021_10-55-38.627.json
│  └── right
|     ├── auxiliary
|     │  └── result_06-01-2021_10-52-28.347.json
│     ├── meta.json
│     └── result_06-01-2021_10-55-38.627.json
└── multicamera_jrgdq760gu
   ├── meta.json
   ├── result_06-18-2021_22-50-38.435.json
   ├── camera1
   |  ├── auxiliary
   │  ├── meta.json
   │  └── result_06-18-2021_22-50-38.435.json
   ├── camera2
   |  ├── auxiliary
   │  ├── meta.json
   │  └── result_06-18-2021_22-50-38.234.json
   └──── camera3
      ├── auxiliary
      ├── meta.json
      └── result_06-18-2021_22-50-38.126.json
```

### Using MultiCamera Pipelines

When multicamera pipelines are run they will create individual annotation files for each camera folder.  The `defaultDisplay` annotations will be copied to the root folder as well.  Viewing the dataset in the annotation folder will bring up the camera assocaited with the `defaultDisplay` as well as the annotations that were copied from the pipeline run.

### MultiCamera Ids and Requests

Internally to reference difference cameras the system creates a datasetId which combines the base datasetId with the cameraName.  So in the example above `stereodataset_jp7hq88vfv` and the `left` camera would be referenced by `stereodataset_jp7hq88vfv/left`.  That is the Id that would be used to loadMetadata, saveMetadata, loadDetections and saveDetections.

### MultiCamera Display/Loading Process

When a dataset loads and the  metadata type is deteremined to be `multi` the system will look in the metadata to see if there is an object called `multiCam` and then will look in the sub object `cameras` for the names of the cameras in the system.  The `defaultDisplay` is also referenced from the `multiCam` metadata and used to display the default camera.  The camera names are populated into a list which is used to switch between cameras.

When a user selects another camera the Viewer.vue component will change it's current datasetId to be `{datasetId}/{cameraName}` and will load the associated metadata and detections for that camera while removing the previous metadata and detections.  This will also cause `Viewer.vue` to emit a signal to the ViewerLoader.vue indicating the change in Id.  This is necessary for the `ViewerLoader.vue` to change the export/import/pipeline options based on the updatedID.

Viewer.vue has the responsibility of managing the current camera and changes to the camera behave like loading another dataset.

* Benefits with this structure:
  * Nearly all existing endpoints (loading/saving/pipelines/importing/exporting) don't need to be modified.  They still call an ID the id is now compounded and specific implementations are updated to point to the proper location.
  * There is an advantage to using the `{datasetId}/{cameraName}` on desktop because the folder structure is already structured in that format.  Instead of opening folder `{datasetId} the same call is used to open a dataset within that folder.
  * isolation between cameras for interactions that are directly linked between cameras.  Adjusting a box in one camera doesn't affect another camera (currently, but in the future there may be toggles to connect them)
* Disadvantages with this structure:
  * When a datasetId is sent to the server there is no explicit argument indicating that it is attempting to work upon a camera instead of a base dataset.
  * There can be some confusion on the desktop loading of metaData because the datasetId may be reconstructed into a single string to take advantage of the folder structure.  I.E.  The request to `loadMetadata` on the desktop has the structure of `/dataset/:id/:camera?/meta` with the optional `:camera?` parameter.  The Id is reconstructed from the `:id` and `:camera?` into a single string (`{:id}/{:camera]`) because the desktop expects a path while opening a folder.

