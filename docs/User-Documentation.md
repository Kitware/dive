# User Documentation

Current capabilities of DIVE include:

* User import of frame images or video.
* Playback of existing annotation data.
* Manual creation of new annotations.
* Automatic object detection and tracking of user-imported data.
* Manual user refinement of automatically generated tracks
* Export of generated annotations.

## Controls

| control              | description                        |
| -------------------- | ---------------------------------- |
| `f` or `right arrow` | skip forward 1 frame               |
| `d` or `left arrow`  | skip backward 1 frame              |
| `h`                  | toggle annotate head position mode |
| `t`                  | toggle annotate tail position mode |
| `space`              | play/pause                         |
| mouse scroll         | zoom                               |
| mouse drag           | pan                                |
| `shift` + drag       | select area to zoom                |
| left-click           | select/de-select track             |
| right-click          | toggle track edit mode             |

## Register for an account

A user account is required to store data and run pipelines on viame.kitware.com.

1. Visit https://viame.kitware.com
2. Click **Register**

## Adding a data source

* Open the DIVE Homepage, and navigate to the "Data" tab.
* Click the blue "user home" button at the top left of the data browser.
* Choose your "public" or "private" folder.
* Click the blue "Upload" button that appears in the toolbar.
* Select either an `.mp4` video or multi-select a group of image frames.
* If you already have `annotations.csv`, select that too.
* Choose a name for the data, enter the optional video playback frame rate, and press start-upload.
* In the data browser, a new blue "Annotate" button will appear next to your data.

## General annotation controls

General Definitions

* **Track**: a series of bounding box detections of a single object over time
* **Detection** a single bounding box on an individual frame
* **Types**: a set of mutually exclusive object classifications that can be applied to a Track, such as "species" if annotating animals.
* **Meatballs menu**: a horizontal 3-dot icon that expands to show a menu.

General controls

* **Select detection**: left-click on a detection.
* **Edit existing detection**: right-click on a detection, adjust its position, then right click again to accept your changes.  You'll notice the outline of the old detection go away when you successfully save the new one.
* **Delete single detection**: Press `q` when a detection is selected.
* **Delete single track**: In the track list, a meatballs menu will appear on hover.  Click the meatballs menu and click "Delete Track".

## Creating a new track

* In the track list header, click the `+` button.
* Your cursor will turn into a cross-hair.
* **Click-and-drag** to draw a box over the object you intend to track.  This creates a detection.  If you edit it again, you must save the edits (see above).
* Use the `f` and `d` keys or the `left/right arrows` to advance forward and backward in time frame-by-frame.
* Notice that when you change the current frame, your cursor becomes a cross-hair again.
* left-click within the editable region of the final detection to complete track creation.  
* left-click the track again to select it in the Track list.
* Double-click its type to open the list of available types, and select one.

## Adding head and tail point annotations

When annotating fish, it's possible to add additional detection-level annotations for head and tail position.  It's best to first create a complete track of a fish before adding head/tail annotations.

* Select the detection you wish to add head/tail points for by left-clicking it.
* To begin with the head, tap the `h` (or `g`) key.
* Your cursor will change to a cross-hair.  Left-click to place a marker.
* If the tail does not exist, your cursor will stay a cross-hair, and you can left-click the tail immediately to place another marker.

Notes:

* You can also start with the tail: tap `t` (or `y`)
* You don't have to place both markers.  Press any of `g`, `h`, `t`, or `y` to exit head/tail annotation mode.  Your cursor will change back to a pointer.
* You can modify an existing head/tail marker by tapping the corresponding key.  If you place one marker and the other already exists, you will not be automatically prompted to place the second.
* **To Delete a head/tail pair**, select a detection with existing markers and tap `q`.
* When a track is selected, a meatball menu will appear in the top-right corner of the annotation window.  All hotkey controls are also available on that menu.

## Persisting changes

Annotations are not automatically persisted to the VIAME server.  To save your changes, click the save disk at the right side of the top toolbar.
