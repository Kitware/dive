<img src="http://www.viametoolkit.org/wp-content/uploads/2016/08/viami_logo.png" alt="VIAME Logo" width="200" height="78">

DIVE is a web interface for performing data management, video annotation, and running a portion of the algorithms stored within the [VIAME](https://github.com/VIAME/VIAME) repository. When compiled, docker instances for DIVE can be run either as local servers or online in web services. A sample instance of DIVE is running on a public server at [viame.kitware.com](https://viame.kitware.com).

![docs/images/Banner.png](docs/images/Banner.png)

## Features

* video annotation
* still image (and image sequence) annotation
* deep integration with [VIAME](https://github.com/VIAME/VIAME) computer vision analysis tools
* single-frame boxes, polygons, and lines
* multi-frame bounding box tracks with interpolation
* Automatic transcoding to support most video formats
* Customizable labeling with text, numeric, multiple-choice attributes

## Documentation

* [Client User Guide](https://kitware.github.io/dive/)
* [Client Development Docs](client/README.md)
* [Docker Getting Started Guide](docker/README.md)
* [Contributor Documentation](CONTRIBUTING.md)

## Technologies Used

DIVE uses [Girder](https://girder.readthedocs.io/en/stable/) for data management and has a typical girder + girder worker + docker architecture.  See docker scripts for additional details.

* The client application is a standard [@vue/cli](https://cli.vuejs.org/) application.
* The job runner is built on celery and [Girder Worker](https://girder-worker.readthedocs.io/en/latest/).  Command-line executables for VIAME and FFmpeg are built inside the worker docker image.

## Example Data

### Input

DIVE takes two different kinds of input data, either a video file (e.g. .mpg) or an image sequence. Both types can
be optionally accompanied with a CSV file containing video annotations. Example input sequences are available at
https://viame.kitware.com/girder#collections.

### Output

When running an algorithmic pipelines or performing manual video annotation (and saving the annotations with the save
button) output CSV files are produced containing output detections. Simultaneously a detection plot of results
is shown underneath each video sequence.
