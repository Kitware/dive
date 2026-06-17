# Dataset Info

The **Dataset Info** panel shows properties of the whole dataset and lets you attach
custom metadata to it. It is one pane of the
[context sidebar](UI-Navigation-Editing-Bar.md#context-sidebar-web).

Metadata you add travels with the dataset: it is shown while annotating and written into
the [VIAME CSV export](DataFormats.md#viame-csv), so downstream tooling can re-link
annotations to their source records.

## What it shows

![Dataset Info panel](images/General/DatasetInfo.png){ width=220px align=right }

**Standard information** (read-only): Name, Type, FPS, Original FPS and Subtype (when
set), Created date, and ID (the Girder folder id).

**Custom Metadata** — a free-form list of key/value pairs stored on the dataset, for
example a station id, cruise number, or dive number.

<div style="clear: both;"/>

## Where the data is stored

Custom metadata lives on the dataset's folder metadata under the `datasetInfo` key — the
same key the exporter reads. Because it is ordinary Girder metadata, you can populate it
three ways:

1. **By hand** in the panel — good for one-offs and corrections.
2. **At upload, from a pipeline** — stamp it when the dataset is created:
   ```python
   gc.addMetadataToFolder(folder_id, {
       "datasetInfo": {"gfishsite_id": "2024TXN012", "cruise": "2403", "year": "2024"},
   })
   ```
   (equivalently `PUT /folder/{folder_id}/metadata`). This is the intended end state for
   batch ingest: stamp identifiers once and they flow through to export. See
   `samples/scripts/uploadScript.py`.
3. **After the fact, with a script** — the same call works on existing datasets.

## How it is exported

On **VIAME CSV** export, a non-empty `datasetInfo` is written into the `# metadata`
header line as one nested JSON entry keyed `dataset_info`:

```
# metadata,fps: 23.976,"dataset_info: {""gfishsite_id"": ""2024TXN012"", ""year"": ""2024""}", ...
```

On import, the `dataset_info` block is read back into the dataset's metadata — replaced with
the **Overwrite** import option (the default), or merged per-key on an additive import. A CSV
with no `dataset_info` entry leaves existing metadata untouched. See
[Data Formats → VIAME CSV](DataFormats.md#viame-csv).

### Value types

The panel stores values as text. A script may write typed values (numbers, objects);
they serialize into the export as-is. Keep `datasetInfo` a flat key/value object.
