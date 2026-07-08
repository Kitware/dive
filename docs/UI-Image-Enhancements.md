# Image Enhancements

The **Image Enhancements** panel adjusts how imagery looks in the annotation view. Open it
from the [context sidebar](UI-Navigation-Editing-Bar.md#context-sidebar-web) (Web) or the
viewer controls (Desktop).

Settings are saved per dataset in the `imageEnhancements` metadata field and restored the
next time you open the dataset.

## Standard controls

These apply to **8-bit and tiled imagery** on both Web and Desktop:

* **Brightness** — linear intensity offset
* **Contrast** — linear intensity scale around mid-gray
* **Saturation** — color saturation (meaningful for RGB imagery)
* **Sharpness** — convolution sharpening filter

They are applied as SVG filters on top of the displayed image or tile layer.

Use **Reset** to return all sliders (including percentile stretch) to defaults.

## Percentile stretch (greater than 8-bit)

High bit-depth sources such as **16-bit TIFF** are often imported or transcoded into a
narrow 8-bit range for display. **Percentile stretch** remaps pixel values using histogram
percentiles so detail is visible without permanently rewriting the source file.

When supported, the panel shows:

* A **Percentile Stretch** toggle
* A **histogram** of the current frame (when available)
* **Low %** and **High %** sliders (defaults 1 and 99) that clip the dimmest and brightest
  portions of the histogram before stretching to display range

Low and high cutoff markers on the histogram update as you move the sliders.

### Where percentile stretch is available

| Dataset type | Platform | How stretch is applied |
|--------------|----------|------------------------|
| `large-image` (TIFF / GeoTIFF) | **Web** | Girder [large_image](Large-Image-Support.md) tile `style` parameters; histogram from `item/{id}/tiles/histogram` |
| `image-sequence` (TIFF originals) | **Desktop** | On-demand PNG from the original TIFF via the local `/api/media/display` endpoint |
| `image-sequence` (TIFF) | Web | Not available — import-time transcoding produces 8-bit PNGs |
| 8-bit PNG / JPEG / video | Web or Desktop | Percentile stretch hidden; use brightness/contrast only |

For **Web** high bit-depth TIFFs, import the file as a **tiled large-image** dataset (see
[Large Image Support](Large-Image-Support.md)) rather than as a folder of PNGs. The viewer
uses `LargeImageAnnotator` and Girder tile endpoints for display and stretch.

For **Desktop** folder-based TIFF sequences, DIVE keeps the original TIFF on disk and
serves stretched frames from that source while annotations continue to reference the
transcoded PNG timeline.

### Pre-scaling vs dynamic stretch

[Large Image Support](Large-Image-Support.md) documents optional GDAL pre-scaling to 8-bit
COG (`gdal_translate … -scale <min> <max> 0 255`). That produces a fixed display range at
import time.

Percentile stretch is an **interactive alternative** (Web large-image and Desktop
image-sequence TIFF): you can tune low/high percentiles while annotating without
re-exporting the file. Pre-scaled COGs and percentile stretch can both be valid depending
on workflow.

## Related documentation

* [Large Image Support](Large-Image-Support.md) — tiled TIFF requirements and COG conversion
* [Data formats](DataFormats.md) — `imageEnhancements` in dataset metadata
* [Annotation UI overview](Annotation-User-Interface-Overview.md) — where the panel lives in the layout
