**Documentation in progress**

VIAME and VIAME Web are capable of running pre-trained detection and tracking pipelines on your imagery and videos.  This document is to help you decide which pipeline to run.

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


## Training

Run model training on ground truth annotations you've created in order to generate a reusable pipe.

| Configuration | Use Case |
| ------------- | -------- |