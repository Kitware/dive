# ImportMultiCamDialog

Vue UI for importing stereo or multi-camera datasets on **desktop** and **web**. Callers mount a single entry component and handle the `begin-multicam-import` event with platform-specific upload logic.

## Entry point

Import from the stable re-export (do not import internal files from platform code unless necessary):

```ts
import ImportMultiCamDialog from 'dive-common/components/ImportMultiCamDialog.vue';
```

Used by:

- `client/platform/desktop/frontend/components/Recent.vue`
- `client/platform/web-girder/views/Upload.vue`

## Import modes

| Mode (`importType`) | UI component | Description |
|---------------------|--------------|-------------|
| `multi` | `ImportMultiCamMultiFolder.vue` | Pick a folder or image list per camera. Default for video imports. |
| `subfolders` | `ImportMultiCamSubfolders.vue` | Pick one parent folder; each immediate child subfolder becomes a camera (2–3 cameras). Enabled when `enableSubfolderImport` is true. |
| `keyword` | `ImportMultiCamKeyword.vue` | One shared folder; glob patterns split images per camera (image sequences only). |

## Architecture

```
ImportMultiCamDialog.vue          Shell: platform props, ctx wiring, errors, actions
├── useImportMultiCamDialog.ts    Builds ctx (state + handlers); emits import payload
├── importMultiCamContext.ts      ImportMultiCamContext type + `ctx` prop definition
├── validateMulticamImageSets.ts  Pure validation (unit tested)
│
├── ImportMultiCamTypeSelector.vue
├── ImportMultiCamMultiFolder.vue
├── ImportMultiCamSubfolders.vue
├── ImportMultiCamKeyword.vue
├── ImportMultiCamFinalizeStep.vue
├── ImportMultiCamCameraOrderControls.vue
│
└── Primitives (presentational)
    ├── ImportMultiCamCameraGroup.vue
    ├── ImportMultiCamChooseSource.vue
    ├── ImportMultiCamChooseAnnotation.vue
    └── ImportMultiCamAddType.vue
```

Subfolder layout rules live in `dive-common/multicamSubfolderLayout.ts`.

## Shared context (`ctx`)

`ctx` is **not** a bag of unrelated Vue props from the parent page. It is the **single return value** of `useImportMultiCamDialog()` — shared reactive state, derived values, and handlers for the whole import flow. Type: `ImportMultiCamContext` (alias of that return type in `importMultiCamContext.ts`).

### How it is created and passed

1. The **shell** (`ImportMultiCamDialog.vue`) calls `useImportMultiCamDialog(props, emit)` once in `setup`.
2. The result is stored as `ctx` and also spread onto the shell instance (`return { ctx, ...ctx }`) so the shell template can use `importType`, `errorMessage`, etc. directly.
3. Each **mode panel** receives the same object: `<ImportMultiCamMultiFolder :ctx="ctx" … />`.
4. Panels declare the prop via `importMultiCamContextProp` and read fields from `props.ctx` in `setup` (often re-exporting only what their template needs).
5. **Nested** dialog components that also need shared state (e.g. `ImportMultiCamCameraOrderControls`, `ImportMultiCamFinalizeStep` inside subfolders) get `:ctx="ctx"` from the panel that already holds it.

Primitives (`ImportMultiCamChooseSource`, `ImportMultiCamCameraGroup`, …) do **not** take `ctx`; they stay presentational and use normal props/events.

### Example

```vue
<!-- Shell -->
<ImportMultiCamMultiFolder :ctx="ctx" :data-type="dataType" :stereo="stereo" />
```

```ts
// Panel
props: {
  ...importMultiCamContextProp,
  dataType: { type: String, required: true },
},
setup(props) {
  const { folderList, open, deleteSet } = props.ctx;
  return { folderList, open, deleteSet };
}
```

```vue
<!-- Panel passes ctx onward when a child needs shared handlers -->
<ImportMultiCamCameraOrderControls :ctx="ctx" :camera-key="key" />
```

### What `ctx` contains

| Category | Members | Role |
|----------|---------|------|
| **Mode** | `importType`, `clearCameraSet` | Active import mode; reset state when mode changes |
| **Per-camera data** | `folderList`, `globList`, `keywordFolder`, `pendingImportPayloads`, `subfolderOriginalNames`, `cameraOrder` | Paths, globs, loaded media metadata, subfolder labels |
| **Subfolder discovery** | `parentFolderName`, `subfolderLayoutLabel`, `openParentFolder` | Parent-folder mode UI and discovery |
| **Ordering / naming** | `orderedCameraKeys`, `canMoveCamera`, `moveCamera`, `onRenameCamera`, `deleteSet`, `addNewSet` | Camera list order and rename/delete/add |
| **Validation / flow** | `filteredImages`, `errorMessage`, `nextSteps`, `camerasReady` | Image-set checks and whether “Begin Import” is enabled |
| **Finalize** | `datasetName`, `datasetNameRules`, `defaultDisplay`, `displayKeys`, `displayKeysKey`, `calibrationFile` | Dataset name, default camera, stereo calibration |
| **Annotations** | `importAnnotationFilesCheck`, `openAnnotationFile` | Optional per-camera track files |
| **Disk / import** | `open`, `prepForImport` | File picker actions and building the emit payload |

Panels typically use a **subset** of `ctx`; the shell uses the full object for errors, footer actions, and mode switching.

## Props (shell)

| Prop | Purpose |
|------|---------|
| `importMedia` | **Required.** Loads media metadata for a path (`MediaImportResponse`). |
| `dataType` | `'image-sequence'` or `'video'`. Video forces `multi` mode. |
| `stereo` | Pre-seeds left/right cameras and calibration UI. |
| `enableSubfolderImport` | Shows the parent-folder import radio. |
| `registerSubfolderCameras` / `unregisterSubfolderCamera` / `renameSubfolderCamera` | Web registry hooks for subfolder discovery (optional on desktop). |

## Events

| Event | Payload |
|-------|---------|
| `begin-multicam-import` | `MultiCamImportFolderArgs` or `MultiCamImportKeywordArgs` (`dive-common/apispec`) |
| `abort` | User cancelled |

## Platform dependencies

The composable uses `useApi()` for `openFromDisk`, optional calibration persistence, and desktop-only subfolder discovery (`listImmediateSubfolders`, `resolveMulticamCameraSourcePath`). Web shims supply no-op or storage-backed calibration helpers.

## Tests

- `validateMulticamImageSets.spec.ts` — image count, glob overlap, keyword pattern rules
- `multicamSubfolderLayout.spec.ts` — parent-folder camera naming and layout (sibling module)

## Re-exports

These files at `dive-common/components/` re-export implementations in this folder for backward-compatible import paths:

- `ImportMultiCamDialog.vue`
- `ImportMultiCamCameraGroup.vue`
- `ImportMultiCamChooseSource.vue`
- `ImportMultiCamChooseAnnotation.vue`
- `ImportMultiCamAddType.vue`
