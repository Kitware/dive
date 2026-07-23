# Suppression

Suppression helps review dense scenes by marking detections that should not count toward type totals — for example, animals under ice sheets or other occlusions. Configure it from the [Type List](UI-Type-List.md) settings menu, then optionally tune how attribute-flagged detections look in the [visibility](UI-Navigation-Editing-Bar.md#visibility-toggles) controls.

There are two related mechanisms. Both require a **Suppression Region Type** to be set; leave that field empty to disable suppression entirely. The default type name is `Suppressed`.

## Region suppression

Draw or import annotations whose type matches the configured **Suppression Region Type**. On each frame, any other detection whose geometry lies at least the **Suppression Overlap (%)** under one or more of those regions is treated as region-suppressed:

* It is **hidden** from the annotation canvas.
* It is **excluded** from type counts and from the track list for that frame.
* Tracks whose every keyframe detection is region-suppressed (or attribute-flagged) are dropped from type counts entirely.

Overlap uses whichever geometry each side actually has: the region's polygon if present, otherwise its bounding box; likewise for the detection. The covered fraction is estimated by point sampling so concave or warped region polygons work without special handling.

### Configuring region suppression

1. Open the [Type List](UI-Type-List.md) and click ==:material-cog:==.
1. Set **Suppression Region Type** to the type used for occlusion / ignore regions (or clear it to disable).
1. Set **Suppression Overlap (%)** to the minimum covered percent required to hide a detection (default **99**). Lower values suppress more aggressively.

The suppression type shows an ==:material-eye-off:== icon in the type list. Hover it for a short reminder of the overlap threshold and attribute behavior.

## Attribute suppression

Separately, a detection (or its track) may carry an [attribute](UI-Attributes.md) **named after the suppression type** (for example `Suppressed`) set to a truthy value (`true`, `1`, `yes`, `on`, or a nonzero number). That flag is **display-only**:

* The detection **stays visible** and keeps its real type (it is not reclassified as the suppression type).
* It is **excluded from its own type's counts** (and is not credited to the suppression type either).
* Optional canvas styling and an eye-off tag can mark it as suppressed (see below).

Attribute values can be set manually in the Attributes panel or come from pipeline / CSV import. Create a track- or detection-level attribute definition whose name matches the suppression type if you want to edit the flag in the UI.

!!! tip

    Region suppression **hides** detections under regions. Attribute suppression **keeps them visible** with a visual cue. Use regions when geometry should decide; use the attribute when a pipeline or reviewer has already labeled a detection as suppressed without covering it with a region.

## Visibility and styling

Open the **:material-eye: Visibility** menu on the [editing bar](UI-Navigation-Editing-Bar.md#visibility-toggles).

### Show suppressed tags

Under the text visibility option, **Show suppressed tags** adds an ==:material-eye-off:== glyph next to attribute-suppressed detections in canvas labels and hover tooltips.

### Suppression styling

Enable **Suppression** (==:material-eye-off:==) to apply outline/fill styling to attribute-suppressed detections. When enabled you can adjust:

* **Dashed outline** — draw a dashed border instead of a solid one (on by default).
* **Outline opacity** — fade the border.
* **Fill color** — optional fill hex; leave at the default picker value when you want the detection's type color.
* **Fill opacity** — fill strength (default 30%). Set to 0 for outline-only.

These controls affect attribute-suppressed detections only. Region-suppressed detections remain hidden regardless of this menu.
