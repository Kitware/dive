# Server architecture

## Soure media data Storage

Image chips that compose a video are stored as girder items in a folder.  Videos are stored as a single item in its own folder.  The parent folder must have the following metadata.

``` json
{
  "annotate": true,
  "fps": <number>,
  "type": "image-sequence" | "video",
  "viame": true,
}
```

## Annotation data storage

Annotations are stored as CSV girder items.  The "current" detection is the most recently edited csv file with the following special metadata.

``` json
{
  "detection": <parent_folder_id>,
}
```

Each time the detection list changes, the old item is moved to a subfolder "auxiliary" and the new copy takes its place.  Pipeline runs completely replace existing annotation data (no merge).
