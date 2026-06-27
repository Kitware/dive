# VIAME Electron Desktop client

> Codename Heavy(?)

## Why make a desktop version

* The desktop client is intended for annotation of datasets on your local filesystem.
* It may not be ideal for you to copy large datasets onto a server for annotation.
* Your personal workstation might be ideal for training and pipeline execution.
* You may prefer not to rely on Docker.

## General architecture

A DIVE Desktop build is a normal Electron app with **three separate Vite targets** (main, preload, renderer):

* **Main process** — Node.js, full OS and Node APIs. Owns the window, starts the embedded HTTP server, registers `ipcMain` handlers, and runs desktop-only backend code under `backend/`.
* **Preload script** — A small bundle that runs in an isolated world before the renderer loads. It is the only place that may call Node/Electron APIs on behalf of the UI; it exposes a vetted API on `window.diveDesktop` via `contextBridge`.
* **Renderer process** — The Vue UI (`desktop.html` and the desktop frontend). It behaves like a browser tab: **no Node integration**, **context isolation enabled**. It talks to the main process only through `window.diveDesktop` and to the local backend over HTTP.

Because the renderer cannot read the filesystem directly, the app runs a small **Express server inside the main process** to stream media (range requests), expose REST-shaped dataset routes, and handle large payloads more comfortably than raw IPC.

* Shared web/client logic lives under `src/` and `dive-common/`; the **desktop-specific frontend adapter** (IPC + axios to the local server) is `frontend/api.ts`.
* **Desktop backend** (filesystem, jobs, platform helpers) lives under `backend/`.

## Configuration and build (client package root)

Tooling paths are relative to the **`client/`** directory (the npm package that owns Electron).

### `client/electron.vite.config.ts`

[electron-vite](https://electron-vite.org/) reads this file for `electron-vite dev` and `electron-vite build`. It defines three builds:

| Target | Source | Output | Role |
|--------|--------|--------|------|
| **main** | `platform/desktop/background.ts` | `client/.electron/main/background.js` | Electron entry; window, lifecycle, starts server + IPC |
| **preload** | `platform/desktop/preload.ts` | `client/.electron/main/preload.js` | `contextBridge` → `window.diveDesktop` |
| **renderer** | `desktop.html` (Vue app) | `client/dist_desktop/` | Packaged UI assets (`base: './'` for `file://` loading) |

The renderer section also configures the **dev server** (host/port from `VITE_PORT`, optional `VITE_API_PROXY_TARGET` for Girder when developing against a remote API).

### `client/electron-builder.json`

After `electron-vite build`, **`electron-builder --config electron-builder.json`** produces installers under `client/dist_electron/`. Important fields:

* **`files`** — Ships `dist_desktop/**`, `.electron/main/**`, `node_modules/**`, and `package.json` into the app bundle.
* **`extraMetadata.main`** — Sets the packaged app entry to `.electron/main/background.js` (overriding the library `main` field used for the npm package).
* **`extraFiles`** — Bundles static ffmpeg/ffprobe binaries for media tooling.
* **`directories.buildResources`** — Icons and other assets under `platform/desktop/buildResources`.

### npm scripts (in `client/package.json`)

* **`serve:electron`** / **`dev:electron`** — `electron-vite dev`: compiles main/preload, serves the renderer from Vite, opens Electron with `ELECTRON_ENTRY=.electron/main/background.js` (and related env). Use this to develop interactive segmentation and stereo features locally.
* **`build:electron`** — `electron-vite build` then `electron-builder --config electron-builder.json`.
* **`build:electron:dir`** — same as `build:electron` but produces an unpacked directory instead of an installer (faster iteration for testing).

## Interactive service (segmentation + stereo)

Desktop-only interactive annotation runs through a single persistent Python subprocess managed by `backend/native/interactive.ts`. It hosts:

* **Interactive segmentation** — point-click mask prediction (`backend/native/segmentation.ts`, IPC via `ipcService.ts`)
* **Interactive stereo** — line transfer, length measurement, dense disparity (`backend/native/stereo.ts`)

Models load lazily on first use. The renderer calls into the service through `frontend/api.ts`; shared UI types live in `dive-common/apispec.ts`. The segmentation recipe is `dive-common/recipes/segmentationpointclick.ts`; stereo wiring is in `platform/desktop/frontend/components/ViewerLoader.vue` and `dive-common/use/useModeManager.ts`.

User documentation: [Interactive Annotation](../../docs/Interactive-Annotation.md).

## Main process, preload, and renderer

```text
┌─────────────────────────────────────────────────────────────────┐
│ Main (background.ts)                                             │
│  • BrowserWindow + session                                       │
│  • backend/server.ts  → Express on localhost (dataset REST, media)│
│  • backend/ipcService.ts → ipcMain.handle / ipcMain.on           │
└───────────────┬───────────────────────────────┬───────────────────┘
                │ preload.js (contextBridge)     │ HTTP
                ▼                                ▼
┌───────────────────────────────┐    ┌─────────────────────────────┐
│ Renderer (Vue, desktop.html)   │    │ axios baseURL http://host:  │
│  window.diveDesktop.invoke…    │    │ port/api (after server-info) │
└───────────────────────────────┘    └─────────────────────────────┘
```

* **`background.ts`** creates the window with `nodeIntegration: false`, `contextIsolation: true`, and `preload` pointing at `preload.js` next to the compiled main bundle. It calls `listen()` from `backend/server.ts` and `ipcListen()` from `backend/ipcService.ts`. In development it loads `desktop.html` from the Vite dev server URL; when packaged it loads `dist_desktop/desktop.html` from disk.
* **`preload.ts`** exposes `window.diveDesktop`: thin wrappers around `ipcRenderer.invoke`, `send`, `on`, plus helpers for native dialogs, app paths, and a small `runtime` snapshot. Types for the renderer are in `client/src/@types/desktop-preload.d.ts`.
* **Renderer** uses `frontend/api.ts`: IPC for commands and structured work (pipelines, import/export, `server-info`, etc.), and **HTTP** (axios) for metadata saves and other `/api/...` routes served by Express. Some operations use IPC even when data is large (for example `load-detections` is handled in main via `common.loadDetections`); streaming media goes through the HTTP `/api/media` path.

## IPC, HTTP, and data flow

* **IPC (`ipcMain` / `window.diveDesktop`)** — Good for control messages, dialogs, job orchestration, and returning JSON that has already been read or produced in main. Handlers are registered in `backend/ipcService.ts`; the preload keeps the renderer from importing Electron directly.
* **HTTP (Express in main)** — Used for dataset-style REST endpoints and **range requests** for video/images (`backend/server.ts`). The renderer obtains `host:port` via the `server-info` IPC handler, then builds an axios client with `baseURL` `http://…/api`.
* **Main → renderer** — `background.ts` can push updates with `webContents.send` (for example job progress); the preload’s `on` API subscribes on the renderer side.

Older notes still apply: avoid blocking synchronous IPC for anything non-trivial; prefer async IPC or HTTP for heavier work.

## Desktop Dependencies

Currently, desktop-only dependencies are installed into devdependencies and linting errors are ignored inline.  This is to prevent desktop's dependencies from polluting the installation of `vue-media-annotator` from NPM.  Separating the many packaging needs of this project is an open discussion.

## Platform-specific methods

Due to tight OS coupling, some methods will have to be implemented to target a single platform. See `backend/platforms`.

## MultiCamera and Stereo Data Organization

Desktop has the capability to import and run pipelines on stereo and multicamera pipelines.  There is a Root folder as well as individual folders for each camera.  To achieve this the folder structure for storage of data is slightly different.

* Root Folder - Base folder which contains the multicamera dataset.  It is tied to a single camera folder which is known as the `defaultDisplay`.  The `defaultDisplay` is the camera that is shown by default when the dataset is loaded.  The Root Folder `meta.json` file will contain a parmeter called `multiCam` and this will point to the multicams in the dataset as well as provide the `defaultDisplay`. 
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

When a dataset loads and the metadata type is deteremined to be `multi` the system will look in the metadata to see if there is an object called `multiCam` and then will look in the sub object `cameras` for the names of the cameras in the system.  The `defaultDisplay` is also referenced from the `multiCam` metadata and used to display the default camera.  The camera names are populated into a list which is used to switch between cameras and the defaultDisplay camera is loaded.

When a user selects another camera the Viewer.vue component will change it's current datasetId to be `{datasetId}/{cameraName}` and will load the associated metadata and detections for that camera while removing the previous metadata and detections.  This will also cause `Viewer.vue` to emit a signal to the ViewerLoader.vue indicating the change in Id.

`Viewer.vue` has the responsibility of managing the current camera and changes to the camera behave like loading another dataset.

