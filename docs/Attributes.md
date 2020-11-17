# Attributes

Attributes are properties that can be assigned to an entire track or a single detection within a track.  Attributes are created by users utilizing the Settings panel in the main file browser location.  New attributes can be added or existing ones can be modified.

### Quick Demos
* [Adding/Editing Attributes Demo](#adding-or-editing-attribute-demo)
* [Applying Attributes](#applying-attributes-demo)

**NOTE:**  Attributes are global on the server currently and can be seen or modified by anyone.  There are future plans to move attributes to be specific to projects or users.

### Adding/Editing Attributes
1. On the main browser of VIAME go to the Settings tab
   1. ![Placeholder](images/Attributes/SettingsBar.png| Settings Bar)
1. Click on the "+" button to indicate that you want to add a new attribute.
   1. ![Placeholder](images/Attributes/SettingsPanel.png| Settings Panel)
1. Provide a descriptive name for the attribute and then determine if it is going to be a track or detection attribute.
   1. *Track Attributes* - apply data to the entire track
   1. *Detection Attributes* - apply only to a specific detection on a track
1. Next choose a datatype: 
   1. Number
   1. Boolean - (True/False)
   1. Text 
       1. Custom text that the user provides
       1. A predefined list of text that can be chosen from
1. After choosing a Track/Detection and a Datatype click Add to add the attribute.
   1. ![Placeholder](images/Attributes/AddAttribute.png| Add Attribute)
1. Existing attributes will show up on the left side of the screen in a list.
    1. ![Placeholder](images/Attributes/AttributeList.png| AttributeList)

### *Adding or Editing Attribute Demo*
 ![Placeholder](/videos/Attributes/CreateAttributes.gif| Create Attributes)

### Setting Attributes on Tracks/Detections

1. Select a track or detection that attributes should be applied on
1. Click in the upper right of the track/type panel to go to the Attributes Interface
   1. ![Placeholder](images/Attributes/AttributesButton.png| Attributes Button)
1.  You are provided with some information about the currently selected track and it's attributes
   1. ![Placeholder](images/Attributes/AttributesSetting.png| Attributes Setting)
1.  Near the top is the Track ID, confidence pairs and then a list of Track Attributes that can be edited
1.  Further down is the current Frame number and the Detection attributes which are connected to that specific frame
1.  Attributes can be edited by clicking on the dropdowns and setting them
    1. Boolean attributes allows you select **blank** or **true** or **false**
       1. ![Placeholder](images/Attributes/BooleanAttribute.png| Boolean Attribute)
    1. Number attributes allow a numerical input
    1. Text attributes can either be custom text or selection from a predefined list of types
1. ![Placeholder](images/Attributes/AttributesSet.png| Attributes Set)
1.  **NOTE:**  Don't forget to save the data after changing track attributes.
    1. 1. ![Placeholder](images/NavBar/SaveIcon.png| Save Icon)

### *Applying Attributes Demo*
 ![Placeholder](/videos/Attributes/ApplyingAttributes.gif| Applying Attributes)


