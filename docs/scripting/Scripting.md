# Scripting

The data managment system through DIVE and Girder may not be enough for very large datasets or complicated datasets.  Scripting the uploading/downloading and processing of data may become necessary.  This can be done utilizing the DIVE/Girder Rest Endpoints and a Python pacakge called 'GirderClient' that helps with interfacing these endpoints.





## [Endpoints](Endpoints.md)

The endpoints documentation provides a more comprehensive list of commonly used endpoints when scripting.  These are endpoints for uploading/downloading data as well as running postprocess, pipelines and training on DIVE Datasets.

## [GirderClient](GirderClient.md)

The documentation for GirderClient and some introductury scripts for authentication along with some commonly used functions for DIVE Scripting



There are several example scripts provided in the repository including:

* [userCount.py](https://github.com/Kitware/dive/blob/main/samples/scripts/userCount.py) - A script utilized by admins to download information about all of the datasets in the system and determine the ttoal number of users that are avaialable.
* [setAnnotationFPS.py](https://github.com/Kitware/dive/blob/main/samples/scripts/setAnnotationFPS.py) - Sets the annotation FPS on a sample folder by modification of the metdata on the DIVE Dataset Folder
* [uploadScript](https://github.com/Kitware/dive/blob/main/samples/scripts/uploadScript.py) - The process of uploading a new JSON or ViameCSV formatted file to a DIVE Dataset folder and running the `postprocess` endpoint to add these new annotations.
* [syncAnnotationsScrip.py](https://github.com/Kitware/dive/blob/main/samples/scripts/syncAnnotationsScript.py) - Script to sync a folder hierarchy of Annotation files with a similar folder structur within DIVE