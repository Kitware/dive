**Documentation in progress**

VIAME and DIVE are capable of running pre-trained detection and tracking pipelines on your imagery and videos.  This document is to help you decide which pipeline to run.

## Detection

Best for a series of images that have no temporal relationship, such as arial photography of multiple scenes.  Also preferred if you only care about aggregate date for the dataset, such as max occurrences of an object per scene.

| Pipeline | Use case                                                                    |
| -------- | --------------------------------------------------------------------------- |
| Default  | Use the default detector if you aren't sure which best applies to your data |

## Tracking

Run full tracking pipelines on your data.  Appropriate for videos and image sequences that derive from a video.  Tracking involves first running a detection pipeline then performing detection linking to form connected object tracks.

| Pipeline | Use case                                                                   |
| -------- | -------------------------------------------------------------------------- |
| Default  | Use the default tracker if you aren't sure which best applies to your data |

## Utility

An assortment of other types of utility pipelines.  Utility piplines are named `utility_<name>.pipe` and are unique in that they take detections as inputs.

| Pipeline | Use case                                                                   |
| -------- | -------------------------------------------------------------------------- |
| <pre>add segmentations watershed</pre>  | Transform existing bounding boxes into polygons |
| <pre>empty frame lbls {N}fr</pre> | Add an empty bounding box covering the whole media element for the purpose of adding full-frame classifier attributes. Unique tracks are created every N frames. |
| <pre>track user selections</pre> | Create tracks from user-initialized detection bounding boxes.  Draw a box on the first frame of a track, and the pipeline will continue tracking the selected object(s) |

## Training

Run model training on ground truth annotations you've created in order to generate a reusable pipe.

| Configuration | Use Case |
| ------------- | -------- |
