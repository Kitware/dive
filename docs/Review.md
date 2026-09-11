# Review

Review shows many annotations at once as a grid of cropped image chips, so you can audit a whole class (or everything carrying an attribute) across one or more datasets and fix wrong types in place, without stepping through each sequence in the annotation viewer. It is available on both DIVE Web and DIVE Desktop as the **Review** tab in the navigation bar.

## Opening the Review page

### Web

* Click the **Review** tab in the top navigation.
* Or select one or more datasets on the **Data** home page and click **Review**.
* Direct URL: `/review?datasetIds=<id1>,<id2>`.

### Desktop

* Click the **Review** tab in the navigation bar.
* Or on the **Library** page, select projects and click **Review**.

## Choosing datasets

The page has two views, toggled with the **Datasets** / **Grid** buttons at the top left; only one is shown at a time to keep the grid uncluttered.

The **Datasets** view has the same dataset picker as the Training and Pipelines pages: search the library, add datasets one at a time or with **Select all**, and drop them again with **Remove all** (on the web, **Browse** opens the folder picker instead). The selected datasets are listed underneath with their type, how many tracks they hold and their load state; reload a dataset's annotations or remove it from there. Datasets picked here are only queued: their annotations are read when you switch to **Results**, so picking many costs nothing until you look at them.

Notes:

* Multicamera datasets are added one camera at a time; adding the parent expands it into its cameras automatically.
* Tiled large-image datasets load, but their media cannot be cropped into chips yet; their entries show a placeholder.
* On web, the dataset's default annotation set is used.

## The grid

The **Datasets** panel opens on a first visit with nothing loaded; coming back with loaded datasets opens **Results**. The Results grid shows the annotations that match the current query. Until a dataset has been added and loaded it only says so. Each entry shows:

* the annotation's box, outlined, cropped out of the image or video frame with some extra context around it;
* the confidence of the shown type (top left);
* an editable **type** field underneath, with every type seen across the loaded datasets offered as suggestions;
* the dataset name (when more than one is loaded), track id, and frame or frame count;
* any polygon outline and head/tail points the detection carries, drawn over the chip.

Hover an entry for its actions (they grow under the mouse): **mark correct** (sets the shown type's confidence to 1 and drops other candidate types), **delete** (a red X; the annotation is removed on the next save), **edit geometry**, and **open in viewer**. Double clicking the image also opens the annotation viewer on that dataset, seeks to the frame the entry is showing, and selects the track. While a review session is open, the viewer's top bar shows a **Review** tab so you can jump back to the same grid and page.

Tracks cycle through their sampled frames at the dataset's real-time rate (sparser samples wait proportionally longer, so a loop lasts about as long as the track does). The arrows in the filmstrip badge step through them by hand, which pauses the cycling on that frame until the play button resumes it; starting an edit pauses it too.

The type field and caption grow a little as the grid shows fewer entries, so a 3 by 3 grid is comfortably readable while a dense grid stays compact.

### Stereo and multi-camera datasets

Each camera of a multi-camera (or stereo) dataset is loaded as its own sequence, but a track that appears in several cameras is one entry, showing a chip per camera side by side with the camera named on it. The chips show the same frames on every side, and zooming or panning one side moves the others with it. Where one camera has no detection on a frame the track has elsewhere, that side is still cropped at a position interpolated from its own neighbouring boxes and shows **no box**; its **add box** action creates a detection there, at the interpolated position, ready to be adjusted. The type field applies to the track in every camera, and opening the viewer opens the whole rig.

### Editing boxes, polygons and points in place

Right click an entry (or use its edit action) to adjust the frame it is showing without opening the viewer. The cycling pauses on that frame, the box gains the same handles the annotator uses (in the type's colour, red while dragged), and any polygon vertices and head/tail points can be dragged too. The mouse wheel zooms into the chip about the cursor and dragging empty space or middle-dragging anywhere pans it, as in the annotator; the zoom stays until you wheel back out. Right click again, or press **Enter** or **Apply**, to keep the change; **Esc** or **Cancel** drops it. The chip keeps its crop after an edit, with the box drawn over it at its new position. Edits are held with the type edits until you **Save**; when auto-save is enabled in the settings, review edits are saved after the same delay the annotator uses.

**Tracks** spanning several frames first show their first box, then, once the extra frames have loaded, cycle through up to eight boxes evenly sampled along the track. The object stays centred in the entry as it cycles. A filmstrip badge shows which sampled frame is on screen.

### Querying

Two query modes are available in the toolbar:

* **Type**: pick a type (or *Any type*) and a minimum confidence. The list offers only the types found on the selected datasets at that confidence or above, so every choice has results. Every track whose matching type meets the threshold is listed once.
* **Attribute**: pick an attribute key, optionally a value, and whether to look at track attributes, detection (per-frame) attributes, or both. Matches on detection attributes show the frames that carry the attribute.

Changes to the query take effect as soon as they settle. The grid otherwise keeps its entries, so editing a type never reshuffles the page you are working on.

The gear next to **Save** opens the same settings as the annotator, including the auto-save switch and delay.

Entries are sorted by confidence, highest first, by default; the sort field also offers lowest first, dataset and track id, or frame.

### Grid size and zoom

The mouse wheel over any entry zooms into it about the cursor, editing or not, and dragging the zoomed image (with the left or the middle button) pans it; wheel back out to return to the full chip.

The default grid is 5 columns by 4 rows. Set the columns and rows directly, or use the zoom buttons: zoom in shows fewer, larger entries and zoom out shows more, smaller ones, keeping the grid's shape. The **Context** slider controls how much image is shown around each box, as a fraction of the box size (30% by default). These settings are remembered per browser.

Use the arrow keys, Page Up / Page Down, Home and End to page through the results. Paging quickly only loads the page you stop on; pages passed over are skipped.

Chips are rendered at the resolution of the cell they fill. A box a few pixels across still has only a few pixels of image behind it, but it is resampled once at full cell size rather than being stretched by the browser, so small objects come out as sharp as the source allows.

### Editing types

Type into an entry's type field and press Enter (or click away), or open its dropdown with the arrow button (which also closes it) and pick one of the known types, to reassign the annotation's type; the new type becomes the top confidence pair with confidence 1, the same as changing the type in the viewer's track list. Edited entries get an amber border and a pencil badge until saved.

**Page actions** applies to every entry on the current page: set them all to one type, or mark them all correct.

Nothing is written until you press **Save**; the Save button stays disabled until there is something to write, and a badge on it shows how many annotations are queued. **Discard** reloads the affected datasets. Leaving the page (or opening the viewer) with unsaved changes asks whether to **Save and Leave**, **Discard and Leave**, or **Stay**. After a clean leave, coming back to Review resumes the same datasets and page, opening Results when any are loaded. Starting Review from the library with a different selection begins a fresh session. Closing the browser tab or the application with unsaved changes asks for confirmation.
