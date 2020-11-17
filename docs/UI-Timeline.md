## TimeLine

<img src="https://raw.githubusercontent.com/wiki/VIAME/VIAME-Webimages/UIView/TimelineHighlight.png" width="400px">

![Placeholder](images/Timeline/TimelineView.png| TimelineView)

The Timeline view provides an ability to quickly see data across the length of the video/image-sequence. Above it are standard video controls for controlling playback.  Additionally a "Left Click" anywhere within the timeline will automatically seek to that frame.  The current frame in the timeline is represented by a vertical cyan bar.

Switching between the different modes can be done by clicking on the text either for **Detections** or **Events**.  The Arrow on the left side of the timeline view can be used to minimize the view to provide more screen space for annotations.

On the right side of the Timeline is a button used to recenter the camera on the annotation.

### Event View 

![Placeholder](images/Timeline/EventViewerDefault.png| EventViewer)

The default event viewer shows a representation of the start/stop frames for the tracks filtered by the TypeList.  The Tracks are presented using their corresponding type colors.
When hovering over any Track the TrackID will display.  Clicking on that track will select the track and transition the current frame to that frame.

**Single Frame Detections** - Single frame detections are presented as single frames with spaces between.

![Placeholder](images/Timeline/EventViewerSingleFrameDetections.png| EventViewer Single Frame Detections)


**Selected Track View** - A selected track will be cyan and will cause the other tracks to fade out.

![Placeholder](images/Timeline/EventViewerSelectedTrack.png| EventViewer Selected Track)

**Selected Interpolated Track** - A selected track which has keyframes and interpolation will show the areas of interpolation, the keyframes and the track.

![Placeholder](images/Timeline/EventViewerInterpolatedTrack.png| EventViewer Interpolated Track)


### Detection Count

![Placeholder](images/Timeline/TimelineView.png| TimelineView)

This provides a count of the types over the duration of the track.  This is updated in realtime with the confidence slider so it can be used to filter out higher densities of types as well as get an indication of the number of the types visible at any one time.
