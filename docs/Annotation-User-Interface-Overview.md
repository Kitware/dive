# User Interface Guide Introduction

## Annotation User Interface Overview

This documentation section provides a reference guide to the annotation interface organized by screen region.

![UI Full View Highlighted](images/UIView/UIFullViewHighlight.png)

* **[Navigation Bar](UI-Navigation-Bar.md)** - Controls to return back to browser as well as perform higher level functions such as running pipelines.  Also the ability to save annotations to the server.
* **[Edit Bar](UI-Edit-Bar.md)** - Controls the viewing of annotations on screen and allows for the editing/creation of annotations.
* **[Annotation View](UI-Annotation-View.md)** - where the image/video is displayed as well as all annotations
* **[Type List](UI-Type-List.md)** - A list of all the types of tracks/detections on the page that can be used to filter the current view.
* **[Track List](UI-Track-List.md)** - List of all the tracks as well as providing a way to perform editing functions on those tracks.
* **[Timeline](UI-Timeline.md)** - timeline view of tracks and detections, as well as an interface to control the current frame along the video/image-sequence
* **[Attributes](Attributes.md)** - Attributes panel used to assign attributes to individual tracks or detections.

## Concepts and Definitions

**Detection** - A single annotation.  A detection could be associated with a point in time within a track, or it could have no temporal association.

**Features** - Bounding box, polygon, head/tail points or other visible elements of a detection.

**Track** - A collection of detections spanned over multiple frames in a video or image sequence.  Tracks include a start and end time and can have gap periods in which no detections exist.

**Types** - Every track (or detection, if tracks aren't applicable) has one or more types that should be used to annotate the primary characteristic you are interested in classifying.  Types are typically used to train a single or multi-class classifier.  A track (or detection) may have multiple types with confidence values associated.

**Frame** - a single image or point in time for a video or image sequence.

**Key Frame** - Every manually drawn annotation is considered a keyframe, and all automated pipelines produce keyframes. Only keyframes can have attributes.  Key frame detections are differentieated from interpolated detections, which are the implicit bounding boxes you see when linear interpolation is enabled.

**Interpolation** - The implicit bounding boxes between keyframes in a track.

**Attribute** - Attributes are free-form secondary annotations on both tracks and detections. For example, a `fish` type track may have an `is_adult` boolean attribute.
