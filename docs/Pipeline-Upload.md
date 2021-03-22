# Custom Pipeline Upload

It's possible to upload custom pipes to DIVE Web through the girder interface.

!!! warning
    This feature is not yet standardized, and the instructions below may change.

1. Open the girder interface at `/girder` and create a new private folder called `MyPipelines`
    1. For our demo instance, open [https://viame.kitware.com/girder](https://viame.kitware.com/girder)
1. Create a new folder in that private folder, and give it a name you'd like to associate with your new pipeline.
1. Upload two or more files inside your new pipeline subfolder:
    1. A pipeline file named `detector.pipe`
    1. Whatever other `.zip` files are required by the pipe, named exactly as the appear in your `detector.pipe` file above.
1. Finally, tag the **folder** with key `trained_pipeline` and value `true`. **Be sure to use the JSON editor** to make sure the value is boolean `true` and not string `'true'`.
1. Your new pipeline will be available under the `Run Pipeline -> Trained` menu from the DIVE web app.

![Upload Pipeline](images/Misc/UploadPipeline.png)
