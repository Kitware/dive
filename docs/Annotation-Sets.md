# Annotation Sets

Annotation sets let you keep **multiple independent versions of annotations** on the same dataset (the same images or video). Each set has its own tracks, groups, save history, and revision log. You can switch between sets in the viewer, import into a specific set, and visually compare one set against another.

!!! info "Web only"
    Annotation sets are available in **DIVE Web** (Girder deployment). DIVE Desktop stores a single annotation stream per dataset and does not expose named sets.

## Concepts

| Term | Meaning |
|------|---------|
| **Default set** | The primary annotation collection for a dataset. In the API and database this is stored with no set name (`null`). The UI labels it `default`. |
| **Named set** | Any user-defined string (for example `reviewer_a`, `model_v2`). Names must be unique per dataset. The name `default` is reserved and cannot be assigned to a new set. |
| **Active set** | The set you are currently viewing and editing. Shown in the viewer title bar as a colored chip. |
| **Comparison set** | A second set loaded in **read-only overlay** mode so you can see two annotations at once. Comparison tracks use dashed outlines and distinct colors. |

All sets share the same **media** (frames, video, configuration, attributes schema). Only track and group geometry, types, and per-annotation data are isolated per set.

## Opening the Annotation Sets panel

1. Open a dataset in the viewer.
2. If the dataset uses custom sets, or you are in comparison mode, a chip next to the dataset name shows the active set (for example `default` or `reviewer_a`). Click the chip to open **Annotation Sets** in the right context sidebar.
3. Or open the [context sidebar](UI-Navigation-Editing-Bar.md#context-sidebar-web) and choose **Annotation Sets** from the panel dropdown.

## Switching sets

In the **Available Sets** list, click a set chip to make it active. The chip marked with `*` is the current set.

- Switching sets updates the browser URL (`/viewer/:id/set/:set` for named sets, `/viewer/:id` for default).
- If you have unsaved edits, DIVE prompts you to save or discard before switching.
- The viewer reloads tracks and groups for the selected set.

## Creating a new set

Use **Add New Set** at the bottom of the Annotation Sets panel:

1. Enter a unique name (not `default`, and not already in use).
2. Click **Add Set**.

DIVE **copies the annotations you currently have loaded** into the new set and switches you to that set. From there, edits apply only to the new set; the original set is unchanged.

!!! tip
    Create a named set before running a pipeline or importing a file when you want to preserve the existing annotations as a baseline.

## Comparing sets

Comparison mode overlays a second set on top of the active set:

1. In **Available Sets**, use the **Compare** switch next to a set (you cannot compare the set you are actively editing).
2. Click **Compare** to reload the viewer with comparison enabled.
3. The title bar shows **Comparing:** with the comparison set name.

Behavior in comparison mode:

- Only **one** comparison set is loaded at a time (the first selected in the UI).
- Comparison tracks are drawn with **dashed** bounding boxes and set-specific colors.
- Track IDs from the comparison set are remapped so they do not collide with the active set.
- Comparison annotations are not editable; edit the active set as usual.

The comparison set is passed in the URL query string, for example:

`/viewer/{datasetId}/set/{activeSet}?comparisonSets={otherSet}`

## Revision history

Each set maintains its own revision history. Open the [context sidebar](UI-Navigation-Editing-Bar.md#context-sidebar-web), then choose **Revision History** from the panel dropdown.

When you check out an older revision, it applies to the **currently active set**. Past revisions are read-only; clone or return to latest to edit again. See [Revision History](Web-Version.md#revision-history) and [Review save history](index.md#feature-comparison) for full behavior.

## Importing annotations into a set

When importing annotations from the navigation bar (**Import**), choose the target set from the dropdown:

- **default** — imports into the primary annotation collection.
- A named set — imports into that set only (via postprocess on the server).

Additive import options still apply; the set only controls which annotation partition receives the data.

## Pipelines and postprocess

Server-side **postprocess** and annotation import during upload accept an optional `set` parameter. Pipeline output and imported files can be directed to a named set instead of default. This is useful for keeping human labels and model outputs separate on one dataset folder.

## Storage and API (for administrators and scripting)

On the server, tracks and groups are stored in MongoDB with an optional `set` field. Queries for a given set filter on that field; the default set uses `set: null`.

| Endpoint | Set parameter |
|----------|----------------|
| `GET dive_annotation/track` | Query `set` — load tracks for a set (omit for default). |
| `GET dive_annotation/group` | Query `set` — load groups for a set. |
| `GET dive_annotation/revision` | Query `set` — revision log for that set. |
| `GET dive_annotation/sets` | Lists distinct set names for the dataset. |
| `PATCH dive_annotation` | JSON body field `set` — apply upserts/deletes to that set. |
| `POST dive_rpc/postprocess/{id}` | Optional `set` — import uploaded annotation files into the given set. |

Example save body shape:

```json
{
  "set": "reviewer_a",
  "tracks": { "upsert": [], "delete": [] },
  "groups": { "upsert": [], "delete": [] }
}
```

Omit `set` or use an empty string for the default collection.

## Related documentation

* [User Interface Guide](Annotation-User-Interface-Overview.md) — overview of viewer regions.
* [Data Formats](DataFormats.md) — track and group JSON schema (unchanged per set; sets are a storage partition, not a different file format).
* [Scripting endpoints](scripting/Endpoints.md) — REST reference including annotation routes.
