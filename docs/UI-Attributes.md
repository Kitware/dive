# Attributes

## Concepts and Terms

- **Attribute Definitions** are templates.  They have a name and a value type, such as `String`, `Number`, or `Boolean`.  Definitions must be created before attribute values can be assigned.  Tracks and detections each have their own set of definitions.
- **Track Attributes** apply to an entire track. Each track can only have one value for each track attribute definition.
- **Detection Attributes** can be different for every frame in a track.

### Example Attribute Definition

- Track Attributes:
    - CompleteTrack: `Boolean`
    - FishLength: `number (cm)`
- Detection Attributes:
    - Swimming: `Boolean`
    - Eating: `Boolean`

### Example Attribute Values

- Fish Track 1
    - Track Attributes
        - `{ "FishLength": 20 }`
    - Detection Attributes
        - Frame 1
            - `{ "Eating": True }`
        - Frame 2
            - `{ "Swimming": False, "Eating": True }`

!!! Info

    All Attribute definitions do not need to be assigned to values.  CompleteTrack (Track Attribute) and Swimming for Frame 1 (Detection Attribute) weren't assigned in this example.

## Using the Attributes Panel

![Track Details Full Panel](images/Attributes/trackDetailsFull.png){ align=right width=260px }

1. Select an existing track or detection with left click.
1. Open the Track Details page by clicking on the ==:material-swap-horizontal:== button in the [Type List](UI-Type-List.md) area or pressing the ++a++ key.
1. Here you will see the track/detection type, confidence pairs associated with it and then a list of track and detection attributes.
1. For attributes there are two sections
    1. **Track Attributes** - All track level attributes
    1. **Detection Attributes** - attributes associated with the track on a per frame basis
1. Attributes can be sorted by their name (alphabetically) or by their numeric value.  Clicking on the ==:material-sort-alphabetical-ascending:== or the ==:material-sort-numeric-ascending:== button will swap between the two.
1. Attribute Filtering
    1. The Attribute filtering icon ==:material-filter:== will change color when filtering is being applied.
    1. Clicking on the filter icon will bring up the **[Attributes Details Panel](UI-AttributeDetails.md)**
<div style="clear: both;"/>

!!! info

    Attributes found during import in a [VIAME CSV](DataFormats.md#viame-csv) will automatically show up in the list.  The data type of the attribute is guessed by examining values and may need to be manually corrected.

By default, all attributes associated with the dataset are visible and editable.  You can hide unused attributes by clicking the ==:material-eye:== toggle next to ==:material-plus: Attribute==.

| Show Unused ==:material-eye:== | Hide Unused ==:material-eye-off:== |
|-------------|-------------|
!['Edit Attributes'](images/Attributes/trackDetailsFull.png) | !['View Attributes'](images/Attributes/trackDetailsView.png)

## Creating Attribute Definitions

1. Click on the ==:material-plus: Attribute== icon for in either the track or detection attribute area.
    1. ![New Attribute Panel](images/Attributes/newAttribute.png)
1. Enter a unique name (see [Reserved Attribute Names section](#reserved-attribute-names))
1. Choose a Datatype
    1. `Number`
    1. `Boolean` (True/False)
    1. `Text`
        1. Custom text that the user provides
        1. A predefined list of text to choose from, separated by newline.
1. Click ==Save== to add the new attribute

## Editing Attribute Definitions

Click the ==:material-cog:== button next to an existing attribute to edit its definition.

![Edit Attribute Panel](images/Attributes/editAttribute.png)

!!! warning

    Editing or deleting an attribute **definition** doesn’t change any existing attribute **values**.

    * **Deleting** an attribute definition will cause it to disappear from the list, but the values will remain in the database.
    * **Editing** an attribute definition will change the way the controls behave, but will not change any existing set values.

## Setting Attribute Values

1. Click on the attribute value when in viewing mode to edit and set the attribute
1. Or directly edit the value field when in the attribute editing mode
1. Setting an attribute to the empty value will remove the value from the track/detection

## Importing and Exporting Attributes

Attributes are part of the dataset configuration that can be imported and exported.

1. Set up a dataset with all the attributes you need
1. In the ==:material-download: Download== menu, choose ==Configuration==.
1. Use this configuration with other datasets
    1. Use the ==:material-application-import: Import== button to load this configuration to other datasets.
    1. Upload the configuration file when you create new datasets to initialize them with these attribute definitions.


## Reserved Attribute Names

Using certain import mode, attributes definitions might be created automatically. This is documented in this section.
- When importing using 'Stereoscopic Calibration' mode, the `stereo3d_x`, `stereo3d_y` and `stereo3d_z` detection attributes definitions will be created automatically.
They holds the 3d location of a detected fish and are used in the Track 3D Viewer.

## Applying Attributes Demo

![Applying Attributes Demo](videos/Attributes/ApplyingAttributes.gif)
