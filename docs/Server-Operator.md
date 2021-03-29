# Server Operator Guide

A guide for running the DIVE Web system can be found on github.

[Read the Docker Guide ➥](https://github.com/Kitware/dive/tree/main/docker){ .md-button .md-button--primary }

---

## Metadata properties

This document explains the metadata properties used to record application state in Girder.  These properties can be modified through the Girder UI editor.

### Dataset

* `annotate` (boolean) marks a folder as a valid DIVE dataset
* `type` (`'video' | 'image-sequence'`) dataset type
* `fps` (number) annotation framerate, not to be confused with video raw framerate
* `ffprobe_info` (JSON) output of ffprobe for raw input video
* `published` (boolean) whether to include the dataset in published summary
* `media_source` (string) For "cloned" datasets, this is an objectId pointer to the source media

### Annotation Item

* `detection` (string) objectId pointer to folder that the annotations belong to

### Video Item

* `codec` (string) video codec
* `source_video` (boolean) whether the video is a raw user upload or a trancoded video
