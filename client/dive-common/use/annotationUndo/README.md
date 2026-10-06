# Annotation undo

Session-local undo for annotation edits in the shared web and desktop viewer.
Press **Ctrl+Z** / **⌘Z**, or use the Undo button beside Save.

Redo is not included.

## Modules

| File | Role |
| --- | --- |
| `AnnotationHistory.ts` | Bounded undo stack. Snapshots only the tracks/groups that changed. |
| `annotationUndoShortcut.ts` | Keyboard handler that runs annotation undo unless focus is in a text field or dialog. |

Viewer wiring lives in `dive-common/components/Viewer.vue`. Stereo async work is
grouped into the initiating edit via `runAnnotationOperation` (desktop
`ViewerLoader`, web `useStereoOnnxWeb`). Before restore, `useModeManager`'s
`prepareAnnotationUndo` clears tool previews so they cannot overwrite restored data.

## History limit

The default cap is `DEFAULT_ANNOTATION_UNDO_LIMIT` (20) at the top of
`AnnotationHistory.ts`. Change that constant to raise or lower the default for
all callers, or pass a second argument when constructing:

```ts
new AnnotationHistory(cameraStore); // uses DEFAULT_ANNOTATION_UNDO_LIMIT
new AnnotationHistory(cameraStore, 50); // override for this instance
```

## How it works

1. After annotations load, `start()` copies the current tracks/groups as a baseline.
2. Each store change flows through `markChangesPending` → `record()`. Synchronous
   updates from one gesture are batched into a single undo step on the next microtask.
3. A step stores the **before** snapshot for each changed annotation. Empty tool
   activation (no geometry yet) is ignored until the first real shape appears.
4. `undo()` pops a step, removes the affected entries, and re-inserts the before
   snapshots (preserving list order). Restore mutations are not recorded.
5. `run()` wraps async stereo transfer so its results stay in the same step; undo
   is blocked while that work is busy.
6. `reset()` / reload clears history. Saving does not: undoing a saved edit creates
   a new pending save through the normal pipeline.

## Behavior

- Restores creation, deletion, geometry, types, attributes, measurements, and groups
  across cameras.
- Disabled while read-only, saving, segmentation prediction, stereo work, or camera
  registration is active.
- Text inputs keep native undo. Viewer settings and registration are outside history.
