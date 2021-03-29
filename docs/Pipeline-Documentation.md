# Pipeline Docs

**Documentation in progress**

VIAME and DIVE are capable of running pre-trained detection and tracking pipelines on your imagery and videos.  This document is to help you decide which pipeline to run.

## Detection

Best for a series of images that have no temporal relationship, such as arial photography of multiple scenes.  Also preferred if you only care about aggregate date for the dataset, such as max occurrences of an object per scene.

| Pipeline | Use case |
| -------- | -------- |
| <pre>arctic seal eo yolo</pre> | Detector for color imagery |
| <pre>arctic seal ir yolo</pre>  | Detector for infrared |
| <pre>em tuna</pre>  | detector |
| <pre>fish without motion</pre>  | simple single-class fish detector |
| <pre>generic proposals</pre>  | generic object detector |
| <pre>motion</pre>  | detector |
| <pre>pengcam kw</pre>  | detector |
| <pre>kengcam swfsc</pre>  | detector |
| <pre>scallop and flatfish</pre>  | detector |
| <pre>scallop and flatfish left</pre>  | detector |
| <pre>sea lion multi class</pre>  | detects bulls, cows, pups, etc |
| <pre>sea lion single class</pre>  | detector |
| <pre>sefsc bw *</pre>  | black-and-white multi-class fish |

## Tracking

Run full tracking pipelines on your data.  Appropriate for videos and image sequences that derive from a video.  Tracking involves first running a detection pipeline then performing detection linking to form connected object tracks.

| Pipeline | Use case |
| -------- | -------- |
| <pre>em tuna</pre>  | tracker |
| <pre>fish</pre>  | simple fish tracker |
| <pre>fish.sfd</pre>  | tracker |
| <pre>generic</pre>  | tracker |
| <pre>motion</pre>  | tracker |
| <pre>mouss</pre>  | tracker |
| <pre>sefsc bw *</pre>  | black-and-white multi-class fish |

## Utility

An assortment of other types of utility pipelines.  Utility piplines are named `utility_<name>.pipe` and are unique in that they _may_ take detections as inputs (but are not required to).  

| Pipeline | Use case |
| -------- | -------- |
| <pre>add segmentations watershed</pre>  | Transform existing bounding boxes into polygons |
| <pre>empty frame lbls {N}fr</pre> | Add an empty bounding box covering the whole media element for the purpose of adding full-frame classifier attributes. Unique tracks are created every N frames. |
| <pre>track user selections</pre> | Create tracks from user-initialized detection bounding boxes.  Draw a box on the first frame of a track, and the pipeline will continue tracking the selected object(s) |

## Training

Run model training on ground truth annotations you've created in order to generate a reusable pipe.

| Configuration | Use Case |
| ------------- | -------- |
| <pre>train_svm_over_fish_detections</pre>  | Support Vector Machine (SVM) for fish |
| <pre>train_svm_over_generic_detections</pre> | Support Vector Machine (SVM) for unspecialized objects |
| <pre>train_netharn_cascade</pre>  | [NetHarn](https://gitlab.kitware.com/computer-vision/netharn) Cascade |
| <pre>train_netharn_resnet</pre> | [NetHarn](https://gitlab.kitware.com/computer-vision/netharn) Resnet |
| <pre>train_svm_full_frame_classifier</pre> | full frame classifier, helpful to start with `empty frame lbls` utility pipe and add attributes |
