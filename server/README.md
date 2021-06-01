# Server architecture

## Development

Install https://github.com/Kitware/ldc

```bash
# copy .env.example and make any changes
cp .env.example .env

# bring the server up
ldc up -d

# replace a pre-built image with the development version
# for example, here's how to work on the girder server code
# girder has hot reload, so code changes will be detected.
ldc dev up girder

# girder worker does not, so code changes require re-launch
ldc dev up girder_worker_default
# or
ldc dev up girder_worker_pipelines
# or
ldc dev up girder_worker_training

# launch a mongo client to query the database
ldc dev run mc
```

To run local verification of all tests, linting, and formatting

```bash
# install tox
pip install tox

# run tox
tox -e format, type, test
```

To work on the Vue client, see development instructions in `../client`.

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
