# linked viewers

Multicam datasets show one GeoJS pane per camera. When the user pans or zooms one pane, linked-viewer navigation keeps the other panes showing the same region of the scene.

This folder holds the shared plumbing and the two links that reuse it with different coordinate mappings: the aligned-view link and the registration-pair link.

## Modules

| Module | Role |
| --- | --- |
| `useLinkedViewers.ts` | Shared GeoJS listener wiring, re-entrancy guard, and zoom-baseline conversion. |
| `useAlignedNavigation.ts` | Pan/zoom link for the **aligned view** (SEAL-TK feature 3). |
| `useRegistrationNavigation.ts` | Pan/zoom link for the **active registration pair** while picking points in the Camera Registration panel. |

## How linking works

Both links follow the same pattern:

1. Attach pan and zoom listeners to each camera pane.
2. When one pane moves, read its view (center + extent).
3. Map that view onto every other pane and apply it.
4. Use a re-entrancy guard so programmatic updates do not echo back into the handler.

The links differ only in step 3 — how a source pane's view maps onto a target pane.

### Zoom baselines

GeoJS zoom is log₂-based, and each pane has its own zoom-0 baseline because images can differ in resolution. To match **extent** (reference units per screen pixel), the shared helper converts through the **target** pane's baseline rather than copying the source zoom level:

```
targetZoom = log₂(target.unitsPerPixel(0) / desiredUnitsPerPixel)
```

### Aligned view (`useAlignedNavigation`)

While the aligned view is active, every pane **renders** in a shared reference coordinate space (see `alignedView/AlignedViewStore` and aligned image layers). Navigation therefore uses the **identity** mapping:

- Same center coordinates on every pane.
- Same reference-units-per-screen-pixel on every pane.

Do **not** map centers through camera-to-camera homographies here — rendering has already applied those transforms.

**Activation:** listeners attach when the aligned view turns on (or transforms / camera list / resize trigger change). Turning Align on unlocks GeoJS pan/zoom clamp on every pane (large-image maps keep clamp on by default), fits the reference camera's native frame, and copies that reference-space viewport onto every other pane. Resize / transform updates only re-link from the reference's current view.

**Deactivation:** each pane is reset to its native full-image view (`resetZoom`) so imagery is on-screen again after content reverts to native coordinates.

**Guards:** the link stands down when:

- the aligned view is inactive or suspended;
- raw camera sync is enabled (`cameraSync`, the un-warped screen-delta sync in Controls.vue);
- `aggregateController.resizing` is true (programmatic `onResize` resets emit pan/zoom in native space — ignore them; `resizeTrigger` re-snaps from the reference once resize settles).

### Registration pair link (`useRegistrationNavigation`)

`useRegistrationNavigation` maps through the active pair's fitted homography (`CameraRegistrationStore.linkedPoint`) so the two panes track each other while picking points — panes render UNWARPED here, so the link must apply the transform itself. It calls the same `useLinkedViewers` helpers with a different `LinkedView` mapping, and stands down while the aligned view is active (which links all panes through the identity instead), while `linkedNav` is toggled off, or while no transform is fitted.

## Wiring

`Viewer.vue` installs both links at the multicam root:

```typescript
import { useAlignedNavigation, useRegistrationNavigation } from 'vue-media-annotator/components';

useAlignedNavigation(aggregateController, alignedView, multiCamList);
useRegistrationNavigation(aggregateController, cameraRegistration, alignedView);
```

`AggregateMediaController.resizing` and `resizeTrigger` exist specifically so linked navigation can distinguish user moves from programmatic resize resets — see `mediaControllerType.ts`.

## Tests

`useAlignedNavigation.spec.ts` exercises identity linking, immediate snap on activation, deactivation reset, resize guards, and stand-down while inactive / suspended / camera-sync on. `useRegistrationNavigation.spec.ts` exercises the immediate snap when the pair link turns on, re-snap when the fitted homography changes, and stand-down while no fit exists.
