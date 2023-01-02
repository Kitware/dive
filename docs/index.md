# DIVE Documentation

<p>
  <img width="160" style="margin-right: 50px;" src="images/General/Kitware-Logo-Stacked.png">
  <img width="320" style="margin-right: 50px;" src="images/General/logo.png">
</p>

This is the documentation site for DIVE, a [**free and open-source**](https://www.kitware.com/open-philosophy/) annotation and analysis platform for web and desktop built by [Kitware](https://kitware.com). DIVE integrates with the [VIAME toolkit](https://www.viametoolkit.org/), but it can also be used on its own.

[:material-compass: Try the web version](Web-Version.md){ .md-button } [:fontawesome-solid-desktop: Get the desktop app](Dive-Desktop.md){ .md-button } [:material-lifebuoy: Get support](Support.md){ .md-button }


![Home](images/Banner.png)

## Feature Comparison

|         | Web | Desktop |
|---------|-----|---------|
| **Data** |
Load your own images and videos | ✔️ | ✔️
| &nbsp;&nbsp;&nbsp; Image and video transcoding | ✔️ | ✔️
| &nbsp;&nbsp;&nbsp; Import using image lists  | ❌ | ✔️
Load annotations from [supported formats](DataFormats) | ✔️ | ✔️
Create new object and track annotation | ✔️ | ✔️
Annotation export | ✔️ | ✔️
Dataset export for portability between web and desktop | ✔️ | ✔️
Permissions and sharing support for team collaboration | ✔️ | ❌
| **Annotation** |
Bounding boxes | ✔️ | ✔️
Polygons | ✔️ | ✔️
Head/Tail lines | ✔️ | ✔️
Linear interpolation | ✔️ | ✔️
Track split | ✔️ | ✔️
Multi-way track merge | ✔️ | ✔️
Complex Interactions and activity groups | ✔️ | ✔️
Freeform or multi-select attributes | ✔️ | ✔️
| **Data Review** |
Image enhancement (thresholding) | ✔️ | ✔️
Advanced per-type annotation confidence threshoding | ✔️ | ✔️
Review save history and load previous states | ✔️ | ❌
| **VIAME Integration** |
Run VIAME object detection and tracking | ✔️ | ✔️
Run VIAME detector and tracker **training** | ✔️ | ✔️
VIAME multi-camera pipelines  | ❌ | ✔️
Manual refinement of auto-generated annotations | ✔️ | ✔️

## Concepts and Definitions

**DIVE** is the annotator and data management software system.  It is our name for the code and capabilities, including both web and desktop, that can be deployed and configured for a variety of needs.

**VIAME** (Video and Image Analytics for Marine Environments) is a suite of computer vision tools for object detection, tracking, rapid model generation, and many other types of analysis.  Get more info at [viametoolkit.org](https://www.viametoolkit.org/)

**VIAME Web** is the *specific* DIVE Web deployment at [viame.kitware.com](https://viame.kitware.com). It includes a web-based annotator with the capabilities to run VIAME workflows on user-provided data.  You may deploy the web system into your own lab or cloud environment.

**Detection** - A single annotation.  A detection could be associated with a point in time within a track, or it could have no temporal association.

**Features** - Bounding box, polygon, head/tail points or other visible elements of a detection.

**Track** - A collection of detections spanned over multiple frames in a video or image sequence.  Tracks include a start and end time and can have gap periods in which no detections exist.

**Group** - A collection of one or more tracks, which can be given a definite frame range, type annotation, confidence, and attributes.
 
**Types** - Every track (or detection, if tracks aren't applicable) has one or more types that should be used to annotate the primary characteristic you are interested in classifying.  Types are typically used to train a single or multi-class classifier.  A track (or detection) may have multiple types with confidence values associated.

**Frame** - A single image or point in time for a video or image sequence.

**Key Frame** - Every manually drawn annotation is considered a keyframe, and all automated pipelines produce keyframes. Only keyframes can have attributes.  Key frame detections are differentiated from interpolated detections, which are the implicit bounding boxes you see when linear interpolation is enabled.

**Interpolation** - The implicit bounding boxes between keyframes in a track.

**Attributes** - Attributes are free-form secondary characteristics on both tracks and detections. For example, a `fish` type track may have an `is_adult` boolean attribute.
