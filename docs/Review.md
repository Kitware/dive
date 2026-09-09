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

The **Datasets** view lists the datasets under review. Add more with **Add dataset** (web opens a folder picker; desktop offers a list of your projects), reload a dataset's annotations, or remove it. Each row shows the dataset's type, how many tracks it holds, and its load state.

Notes:

* Multicamera datasets are added one camera at a time; adding the parent expands it into its cameras automatically.
* Tiled large-image datasets load, but their media cannot be cropped into chips yet; their entries show a placeholder.
* On web, the dataset's default annotation set is used.

## The grid

Switch to the **Grid** view to see the annotations that match the current query. Each entry shows:

* the annotation's box, outlined, cropped out of the image or video frame with some extra context around it;
* the confidence of the shown type (top left);
* an editable **type** field underneath, with every type seen across the loaded datasets offered as suggestions;
* the dataset name (when more than one is loaded), track id, and frame or frame count.

Hover an entry for two actions: **mark correct** (sets the shown type's confidence to 1 and drops other candidate types) and **open in viewer**. Clicking the image also opens the annotation viewer on that dataset, seeks to the frame, and selects the track.

**Tracks** spanning several frames first show their first box, then, once the extra frames have loaded, cycle through up to eight boxes evenly sampled along the track. The object stays centred in the entry as it cycles. A filmstrip badge shows which sampled frame is on screen.

### Querying

Two query modes are available in the toolbar:

* **Type**: pick a type (or *Any type*) and a minimum confidence. Every track whose matching type meets the threshold is listed once.
* **Attribute**: pick an attribute key, optionally a value, and whether to look at track attributes, detection (per-frame) attributes, or both. Matches on detection attributes show the frames that carry the attribute.

Press **Show** (or switch to the Grid view) to run the query. The grid keeps its entries until you run the query again, so editing a type never reshuffles the page you are working on. The toolbar notes when the query has changed since the last run.

Entries can be sorted by dataset and track id, confidence (either direction), or frame.

### Grid size and zoom

The default grid is 5 columns by 4 rows. Set the columns and rows directly, or use the zoom buttons: zoom in shows fewer, larger entries and zoom out shows more, smaller ones, keeping the grid's shape. The **Context** slider controls how much image is shown around each box, as a fraction of the box size (30% by default). These settings are remembered per browser.

Use the arrow keys, Page Up / Page Down, Home and End to page through the results.

### Editing types

Type into an entry's type field and press Enter (or click away) to reassign the annotation's type; the new type becomes the top confidence pair with confidence 1, the same as changing the type in the viewer's track list. Edited entries get an amber border and a pencil badge until saved.

**Page actions** applies to every entry on the current page: set them all to one type, or mark them all correct.

Nothing is written until you press **Save**; the toolbar counts unsaved changes, and **Discard** reloads the affected datasets. Leaving the page with unsaved changes asks for confirmation.

## Search results

On DIVE Desktop, the Video Search panel's results grid is the same chip grid: ranked similarity results from every indexed dataset are cropped and paged with the controls described above, each entry is accepted or rejected with the buttons in its corner, and clicking an entry from the open dataset seeks the viewer to it. Grid shape, zoom and context settings are shared with the Review page.
