# Large Image Support

DIVE supports large image datasets (GeoTIFF/TIFF) through tiled pyramid access.

## Requirement: Internal Overviews

Large images must include internal overview levels (reduced-resolution pyramid levels) for tile rendering. Files without internal overviews can fail to load in the large-image viewer.

If a file is missing overviews, convert it before import.

## Check a File

Run:

```bash
gdalinfo --stats "input-file.tif"
```

Confirm that the output includes overview entries and record the min/max stats for each band. You will use those values for scaling during conversion.

## Convert to a Pyramidal COG

Use `gdal_translate` with COG output, internal overviews, and explicit scaling:

```bash
gdal_translate "input-file.tif" "input-file_cog_scaled.tif" \
  -of COG \
  -ot Byte \
  -scale <min> <max> 0 255 \
  -co BLOCKSIZE=256 \
  -co COMPRESS=DEFLATE \
  -co PREDICTOR=2 \
  -co BIGTIFF=IF_SAFER \
  -co NUM_THREADS=ALL_CPUS \
  -co OVERVIEWS=IGNORE_EXISTING \
  -co RESAMPLING=LANCZOS \
  -co OVERVIEW_RESAMPLING=AVERAGE
```

Replace `<min>` and `<max>` with the values from `gdalinfo --stats` (per band as needed).

## Notes

- If your data is RGB, use per-band scaling options (`-scale_1`, `-scale_2`, `-scale_3`) when channels need different ranges.
- Re-import the converted `*_cog_scaled.tif` file into DIVE.
