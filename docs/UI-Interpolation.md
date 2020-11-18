# Interpolation

Interpolation allows the guessing of bounding boxes between sets of "keyframes".  The intermediate bounding boxes are calculated between the keyframes and are adjusted accordingly.  Interpolation allows a track to be created and edited much faster than drawing a detection for every single frame.

See the Annotation Quickstart for a quick overview of enabling and using interpolation.

Interpolation will be enabled on new tracks by default.  If it isn't enabled it can be found under the "+Track Settings".
Interpolation editing for existing tracks will only be enabled on tracks that span more than one frame.

## Basics

Interpolation is done by creating a detection then moving the current frame forward in time and placing the detection in a new spot.  Each time the detection is edited or moved it becomes a "locked" keyframe meaning it is used in the interpolation.

Interpolated Frame that is being edited has no name associated with it and has a light highlight for the bounds:

![Interpolated Editing](images/InterpolatedEditing.png)

## Track Interpolation Controls

If the selected track spans more than one frame there will be interpolation controls available.

![Interpolated Settings](images/CreationMode/InterpolateTrackSettings.png)
* Delete - Delete the entire track
* Split - Splits tracks that span more than one frame into two new tracks
* Star [KeyFrame] - Represents if the current frame is a keyframe or not.  Filled in means it is a keyframe
* Interpolation Mode - The dashed rectangles mean that the current space without keyframes is interpolated.  To show an occluded object this would be turned to off.
* First Frame - '<<'
* Previous Keyframe - '<'
* Next Keyframe - '> '
* Last Frame - '>>'
* Edit Toggle - will toggle the currently selected track edit mode

## Event Viewer

The event viewer provides a quick and concise view of an interpolated track.
* Keyframes - represented by solid individual markers in the track
* Interpolated Ranges - represented by a thin cyan line joining keyframes
* Blank Ranges - areas absent of keyframes and interpolated ranges.

![Interpolated EventViewer](images/Timeline/EventViewerInterpolatedTrack.png)

## Interpolated Extensive Demo

Below is a longer demo showing creation of interpolated tracks as well as converting some areas to Blank ranges which contain no annotations.

![Interpolated Demo](/videos/CreationModes/CreationModeInterpolation.gif)
