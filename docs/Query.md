# Query

The **Query** page (DIVE Desktop) searches many datasets at once. Pick the datasets, build a search index over them, then search from an image, a frame of a video, or a text description. Hits come back as the same chip grid the Review page uses, and a similarity search can be refined by marking hits correct or incorrect.

Open it from the **Query** tab, or select datasets in the **Library** and click **Index** to open the Indexes panel with those sequences selected.

## Indexes panel

Add datasets with the same picker as the Training and Pipelines pages: search the library, add rows one at a time or with **Select all**, and drop them with **Remove all**. Each selected dataset shows whether it is in the search index. **Build index** indexes every selected dataset that is not indexed yet (each row also has its own build button), choosing how the index is made:

* *Around generic detections*: run the generic object detector and describe its boxes.
* *Detection and tracking*: detect and track, then describe the tracks.
* *Around existing annotations*: describe the dataset's current annotations.

Indexing runs as jobs on the Jobs page; the rows update as they finish. **Build all not indexed** queues every unindexed dataset. All indexed datasets share one index, so a dataset indexed here is also searchable from the viewer's Video Search panel, and the reverse.

## Query panel

The panel is on the left, results on the right.

**Image.** Choose an image file. Drag a box on it to search for one object, or leave the whole image as the exemplar. Press **Search**.

**Video.** Choose one of the listed datasets or a video file, enter a frame number and press **Show frame**, then optionally drag a box on the frame. Press **Search**.

Both run a similarity search over every indexed dataset (limited to the listed datasets unless the switch is turned off). Mark results correct or incorrect and press **Refine** to re-rank; **Save model** keeps the refined classifier as a trained pipeline. A saved `.svm` model can also start a search (*Start from a saved model*).

**Text.** Type what to find. Sampled frames of every listed dataset (every N frames, up to a per-dataset cap) are searched with the SAM3 text model, which must be installed as a VIAME add-on. Hits show in the grid with their label and score. Each hit offers **Search the index for objects like this one**, which turns it into an image query, and **Open in the annotation viewer**.

Double clicking any result opens its dataset in the viewer at that frame.

Index builds appear in **Jobs** while preparing and running, with their dataset, indexing method, live stdout/stderr, and final result. Expand the job's output to diagnose failures; the process log is also saved as `runlog.txt` in its working directory. Builds waiting for the GPU appear under **Queued Jobs** as indexing jobs. Startup failures remain in job history.

Selecting a stereo or multicamera sequence uses its first camera in the configured display order. Query shows that camera by name and indexes its media and, for the existing-detections method, its annotations. The other cameras are not indexed automatically. Results refer to the indexed camera, keeping thumbnails and frame numbers aligned with its media.

Inside an annotation sequence, **Video Search** lists the available indexed
sequences, with an option to search all of them. Selecting an indexed sequence
limits the ranked results and result grid to that sequence; the underlying
similarity search still uses the shared database. Changing this selection clears
the previous results and feedback so the next query starts fresh.

Use **Create index** when no index exists, or **Build a new index** below the
selector, to open Query's **Indexes** panel with the current sequence selected.
Index type, building, and removal are managed on that page.

The Indexes list survives navigation and restores saved index membership and
indexing jobs on return. Rows show in-progress builds, successful indexes, or
failed builds with their job error, even when the job finished on another page.

The top of **Indexes** lists successfully generated entries in the shared search
index, independently of the selection used to queue new builds below. There is
one entry per video or sequence; rebuilding replaces that entry. **Remove from
index** deletes one sequence's search data, while **Delete entire index** removes
the whole shared index. Both ask for confirmation and keep source media and
annotations. Index deletion is disabled while index builds are queued or running.
