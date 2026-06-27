![Navigation Bar Highlighted](images/UIView/NavBarHighlight.png)

## Navigation Bar

The navigation bar is the row of controls at the very top of the window.

* ==:material-database: Data== navigates to the folder that contains the current dataset.
* ==:material-pipe: Run Pipeline== will launch a pipeline dropdown menu.
    * **NOTE** Current annotations will be replaced by the pipeline output when it is complete.  You should not perform annotations while a pipeline is running.
* ==:material-application-import: Import== allows the upload of several kinds of files
    * overwrite the current annotations with a `.json` or `.csv` annotation file.
    * overwrite the style and attribute configuration with a config `.json` file.
* ==:material-download: Download== (Web) or ==:material-application-export: Export== (Desktop) allows for exporting all or part of the current dataset.
    * **Exclude Tracks** - this allows you to remove tracks below a specific confidence threshold when exporting the CSV.  It is how you can export only the higher detections/tracks after running a pipeline.
    * **Checked Types Only** - allows you to only export the annotations of types that are currently checked in the type list.
    * **Web-specific options** are documented in the [web download section](Web-Version.md#download-or-export-data)
* ==:material-content-copy: Clone== is documented in the [web clone section](Web-Version.md#dataset-clones).
* ==:material-help-circle: Help== provides mouse/keyboard shortcuts as well as a link to this documentation.
* ==:material-content-save:== is used to save outstanding annotation changes and any custom styles applied to the different types.  Changes are not immediately committed and will instead update the save icon with a number badge indicating how many changes are outstanding.  Clicking this button will commit your changes and reset the count to zero.

## Editing Bar

The editing bar is the second row below navigation.

### Context sidebar (Web)

On the right side of the editing bar, ==:material-chevron-left-box:== (or ==:material-chevron-right-box:== when open) toggles the **context sidebar** — advanced tools and settings panels on the right side of the viewer.

Use the dropdown at the top of that panel to switch tools, including [Dataset Info](UI-DatasetInfo.md), [Revision History](Web-Version.md#revision-history), Group Manager, threshold controls, and (when applicable) [Annotation Sets](Annotation-Sets.md).

### Editing Status Indicator

![Editing Status Indicator](images/EditBar/StatusIndicator.png)

On the far left, the editing mode status indicator shows you what mode you're in, what input is expected, and usually reminds you to press ++escape++ to cancel.

### Edit Mode Toggles

Editing mode toggles control the type of geometry being created or edited during annotation.  See the [Annotation Quickstart](Annotation-QuickStart.md) for an in-depth guide to annotation.

Standard geometry modes:

* ==:material-vector-square:== **Rectangle** (++1++)
* ==:material-vector-polygon:== **Polygon** (++2++)
* ==:material-vector-line:== **Head/tail line** (++3++)

#### Segment mode (Desktop)

On [DIVE Desktop](Dive-Desktop.md), an additional ==Segment== toggle (magic-wand icon, ++s++ hotkey) activates [interactive point-click segmentation](Interactive-Annotation.md#interactive-segmentation).

![Segmentation editing bar](images/CreationMode/SegmentationMode.png)

While segmentation is active:

* The status indicator shows **Creating Segment** or **Editing Segment** with click instructions.
* A **Reset Points** button appears to clear prompt points without leaving segmentation mode.
* Green and red dots show foreground and background prompt points on the image.
* A loading spinner appears while the model loads or a prediction is in progress.

Segment mode is not available in the web annotator.

### Visibility Toggles

The **:material-eye: visibility** section contains toggle buttons that control the different types of annotation data can be hidden or shown.

* ==:material-vector-rectangle:== toggles **rectangle** visibility
* ==:material-vector-polygon:== toggles **polygon** visibility
* ==:material-vector-line:== toggles **head/tail line** visibility
* ==:material-format-text:== toggles annotation type & confidence **text** visibility
* ==:material-comment-text-outline:== toggles a **cursor hover tooltip**, helpful for reviewing very dense scenes with lots of overlap.
* ==:material-navigation:== toggles **track trail** visibility.  The track trail is configurable to show up to 100 frames both ahead and behind each bounding box.  The trail line is made of bounding box midpoints.
