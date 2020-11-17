## Navigation Bar
<img src="https://raw.githubusercontent.com/wiki/VIAME/VIAME-Webimages/UIView/NavBarHighlight.png" width="400px">
![Placeholder](images/NavBar/Navbar.png| Navigation Bar)

* **Data Link** - Returns back to the folder which contains the current data.
    * ![Placeholder](images/NavBar/DataIcon.png| Data Icon)
* **Run Pipeline** - Will run a pipeline from the dropdown on the current data. 
    * NOTE: Current annotations will be backed-up and replaced by the pipeline when it is complete
    * ![Placeholder](images/NavBar/RunPipelinesMenu.png| Run Pipelines Menu)
* **Download** - Allows for downloading all data, the image-sequence/video or just the detections.
    * ![Placeholder](images/NavBar/DownloadMenu.png| Download Menu)
    * **Exclude Tracks** - this allows you to remove tracks below a specific confidence threshold when exporting the CSV.  It is how you can export only the higher detections/tracks after running a pipeline.
* **Help** - Provides a small indication of currently available mouse/keyboard shortcuts as well as a link to this documention.
* **Save** - This button is used to save the current annotations and any custom styles applied to the different types.  Changes are not immediately committed and will instead update the save icon with a number indicating the number of changes that have occured.  Clicking this button will reset the number and save the data at the same time.
    * ![Placeholder](images/NavBar/SaveIcon.png| SaveIcon)
