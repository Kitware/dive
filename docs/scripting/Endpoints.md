# GirderClient and DIVE REST Endpoints

DIVE can be interacted with programatically utizing both Girder and DIVE endpoints to upload data/download data modify annotations and run pipelines/training.

## Main DIVE Endpoints

Going the the `{URL}/api/v1` like [viame.kitware.com/api/v1](viame.kitware.com/api/v1) will provie a Swagger description of the all of the Girder endpoints

### dive_dataset/

Operating directly on  DIVE datasets for higher level information about the media, attributes and configuration.

#### `dive_dataset/`
- **Method:** GET
- **Usage:** List DIVE datasets in the system that the current user has access to.  By default it uses a limit of 50 to prevent listing a large number of datasets

#### `dive_dataset/`
- **Method:** POST
- **Usage:** This endpoint is used to create a new dataset in the system, by generating a clone of an existing DIVE dataset.

#### `dive_dataset/export`
- **Method:** GET
- **Usage:** This endpoint is used to export the entire dataset, including annotations and media files, in a specified format.  It will export the data in a zip file.  The input parameter of folderIds in an array of DIVE dataset FolderIds

#### `dive_dataset/{id}/configuration`
- **Method:** GET
- **Usage:** Gets the configuration for the DIVE dataset Id and returns a JSON file for downloading that contains the configuration options/

### dive_annotation/

Operating on the Annotations for a specific DIVE Dataset Id.  These incloude getting and modification of the DIVE Dataset annotation values.

#### `dive_annotation/track`
- **Method:** GET
- **Usage:** This endpoint is used to get detailed information about specific tracks within a dataset, including their attributes and associated detections.  There are options to retrieve the annotations at specific revisions

#### `dive_annotation/revision`
- **Method:** GET
- **Usage:** This endpoint is used to access the list of revisions for annotations.  I.E everytime a user modified the annotations through a pipeline or through saving changes

#### `dive_annotation/rollback`
- **Method:** POST
- **Usage:** Rolls back the Annotations to a specific revision version

#### `dive_annotation`
- **Method:** PATCH
- **Usage:** This endpoint is used to modify existing annotations, such as updating track information or adding new attributes.


####  `dive_annotation/export`
- **Method:** GET
- **Description:** Exports annotations for a given dataset.
- **Usage:** This endpoint is used to export annotations in a specified format (e.g., CSV, JSON) for a dataset.  This endpint is different from dive_annotation/track because it returns a file rather than direct JSON like dive_annotation/track does.

### dive_rpc/

These are remote procedural calls to run jobs or perform actions that may be a bit longer running than simple request.  This is where pipelines and training will be run or the initial transcoding for videos/images can be kicked off.

####  `dive_rpc/postprocess/{id}`
- **Method:** POST
- **Usage:** This endpoint is used to trigger postprocessing tasks on a dataset.  It is a requirement that after new data is uploaded this endpoint is called to transcode data and process any uploaded CSV or JSON files to generate attributes and the base annotations.  After uploading any data this endpoint should be called with `skipJobs = True` to process the annotation file and update the attributes.

#### `dive_rpc/pipeline`
- **Method:** POST
- **Usage:** This endpoint is used to execute a specified pipeline on a dataset, which can include tasks like object detection, tracking, and classification.

####  `dive_rpc/train`
- **Method:** POST
- **Usage:** This endpoint is used to train a machine learning model using the annotations and media in a dataset, allowing for the creation of custom models for specific tasks.
