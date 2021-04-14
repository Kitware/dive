# Server architecture

## Metadata properties

This document explains the metadata properties used to record application state in Girder.  These properties can be modified through the Girder UI editor.

### Dataset

Image chips that compose a video are stored as girder items in a folder.  Videos are stored as a single item in its own folder.  The parent folder must have the following metadata.

* `annotate` (boolean) marks a folder as a valid DIVE dataset
* `type` (`'video' | 'image-sequence'`) dataset type
* `fps` (number) annotation framerate, not to be confused with video raw framerate
* `ffprobe_info` (JSON) output of ffprobe for raw input video
* `confidenceFilters` (JSON) map of filter name to float in [0, 1]
* `customTypeStyline` (JSON) map of class name to GeoJS display attributes.
* `published` (boolean) whether to include the dataset in published summary
* `foreign_media_id` (string) For "cloned" datasets, this is an objectId pointer to the source media

### Annotation Item

* `detection` (string) objectId pointer to folder that the annotations belong to

Each time the detection list changes, the old item is moved to a subfolder "auxiliary" and the new copy takes its place.  Pipeline runs completely replace existing annotation data (no merge).

### Video Item

* `codec` (string) video codec
* `source_video` (boolean) whether the video is a raw user upload or a trancoded video
