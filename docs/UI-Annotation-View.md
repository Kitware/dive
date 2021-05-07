# Annotation View

![Annotaton View Hightlight](images/UIView/AnnotationViewHighlight.png)

The Annotation View is where images an the annotations reside.  Annotations have different states and properties based on the current mode.
**Left Click** - this will select an annotation and highlight cyan
**Right Click** - select an annotation and place it in editing mode allowing to edit existing geometry or create new ones
**Middle Click** - Pan the camera.  This is useful in polygon editing mode or while zoomen and creating annotations.

* **Default Mode** - In the default mode the annotation will have bounds associated with it as well as a text name for the type and an associated confidence level.  The color and styling will match what is specified in the TypeList Settings.  There are additional modes which can be toggled on and off in the ![Edit Bar](UI-Edit-Bar.md).
* **Selected Annotation** - selected annotations are cyan in color
    * ![Track Selected Mode](images/TrackSelectedMode.png)
* **Editing Annotation** - Editing annotations are cyan in color and provide handles to resize the annotation as well as a central handle to move the annotation to different spot.
    * ![Track Edit Mode](images/TrackEditMode.png)
* **Creating Annotation** - Creating an annotation requires clicking and dragging the mouse.  When the AnnotionView is ready to create the annotation the mouse will turn into a crosshair.
    * ![Track Creation Crosshair](images/TrackCreationCrosshair.png)
* **Interpolated Annotation** - If an annotation has interpolation and the current frame isn't a keyframe it will appear slightly faded and will become a keyframe if the user edits the size or position
    * ![Interpolated Editing](images/InterpolatedEditing.png)
