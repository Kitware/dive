# Interactive Annotation (Desktop)

DIVE Desktop can run **interactive point-click segmentation** and **interactive stereo** tools backed by a local VIAME Python service. Both features are **desktop-only** and require a working [VIAME installation](Dive-Desktop.md#desktop-settings).

| Feature | Description |
|---------|-------------|
| **Interactive segmentation** | Click foreground/background points to generate polygon masks (SAM-style models when available). |
| **Interactive stereo** | Warp annotations between stereo camera views and recompute length measurements from head/tail lines. |

See also: [Multicamera and Stereo Data](Multicamera-data.md#interactive-stereo-desktop), [Annotation Quickstart](Annotation-QuickStart.md#interactive-segmentation-desktop), [Keyboard shortcuts](Mouse-Keyboard-Shortcuts.md).

## Requirements

* [DIVE Desktop](Dive-Desktop.md) with a valid **VIAME Install Path**
* For stereo features: a **stereo dataset** imported with a calibration `.npz` file
* GPU recommended for model load times; CPU fallback may be available depending on VIAME build

On first use, DIVE spawns a single persistent `viame.core.interactive_service` subprocess that loads segmentation and stereo models lazily.

## Interactive Segmentation

![Segmentation mode](images/CreationMode/SegmentationMode.png)

Point-click segmentation helps you draw precise polygon regions faster than placing vertices by hand. It is available on single-camera and multicamera datasets.

### Activating segmentation

1. Create or select a track/detection and enter edit mode (**right-click** the annotation).
2. Click the ==Segment== button (magic-wand icon) in the [editing bar](UI-Navigation-Editing-Bar.md), or press ++s++.
3. On first activation, DIVE loads the segmentation model. A loading indicator appears in the status area.

The status indicator shows instructions while segmentation is active:

* **Left click** — add a foreground (include) point
* **Shift+click** or **middle click** — add a background (exclude) point
* **Right click** or ++enter++ — confirm and commit the polygon
* ++escape++ — cancel and clear points (restores the previous polygon if you were editing)

Green dots are foreground points; red dots are background points.

### Resetting points

While in Point (segmentation) mode, click ==Reset Points :material-undo:== in the editing bar to clear prompt points and revert to the pre-segmentation polygon without leaving segmentation mode.

### Multi-frame and video

* Points are tracked **per frame**. Switching frames saves the current frame's points and shows only the active frame's prompt dots.
* Confirming commits all frames that have valid polygons.
* On video datasets, the service receives the frame timestamp so models can seek the correct frame.

### Continuous detection mode

In **Detection** mode with **Continuous** enabled, each foreground click can start a new detection. Background clicks do not spawn new detections.

### Stereo datasets

On stereo datasets, confirming a segmentation on one camera can warp the resulting polygon to the paired camera when [interactive stereo](#interactive-stereo) auto-compute is enabled.

!!! note

    If the primary segmentation model fails to load, DIVE may fall back to a GrabCut-based method with reduced accuracy. Check the desktop debug console (++ctrl+shift+i++) for details.

## Interactive Stereo

Interactive stereo assists annotation on **two-camera stereo datasets** with a calibration file. It is controlled from the **Stereo Settings** section of the [creation settings menu](UI-Track-List.md) (gear icon in the track list or bottom panel).

![Stereo settings](images/CreationMode/StereoSettings.png)

| Setting | Behavior |
|---------|----------|
| **Update lengths when modified** | When you edit a head/tail line on a detection linked across both cameras, DIVE recomputes stereo measurements (length, midpoint, range, RMS). |
| **Auto-compute location on other camera** | When you draw an annotation on one camera and the other camera has no detection yet, DIVE warps it to the other view using dense stereo disparity. |

Enabling either toggle loads the interactive stereo service. A loading dialog appears while models initialize.

### Warped annotations

Stereo-warped head/tail lines become **normal editable line annotations**. If you manually edit a warped line, DIVE locks it from automatic re-warping so your corrections are preserved.

Auto-created head/tail connector lines use the standard head/tail line key and behave like manually drawn lines.

### Multicamera workflow improvements

* **One-click cross-camera edit** — selecting a linked track on one camera selects it on all camera views and enables editing.

![Cross-camera edit](images/MultiCam/CrossCameraEdit.png)

* **Create on any camera** — start a new linked detection from any camera view without breaking the multicam workflow.
* **Line aspect ratio** — auto-warped line bounding boxes are capped at a 6:1 aspect ratio for readability.

### Measurements and export

Computed lengths are stored as detection attributes (for example `length`) and round-trip through [VIAME CSV export](DataFormats.md#viame-csv-polygons-and-length). The legacy VIAME length column is also populated when a length value is present.

## Troubleshooting

> **Unable to load the interactive service**

Verify your **VIAME Install Path** in Desktop Settings. Ensure VIAME is installed with interactive segmentation/stereo support (see [VIAME installation docs](https://github.com/viame/VIAME#installations)). Open the debug console (++ctrl+shift+i++) and look for stderr from the interactive subprocess.

> **Segmentation button missing or disabled**

Interactive segmentation is only available in DIVE Desktop, not the web annotator.

> **Stereo settings not visible**

Stereo settings appear only on stereo datasets (two cameras + calibration) in DIVE Desktop.

> **Stereo warp did not appear on the other camera**

Confirm **Auto-compute location on other camera** is enabled, the track is linked across cameras, and the other camera has no existing detection at that frame. Human-edited lines are not overwritten.
