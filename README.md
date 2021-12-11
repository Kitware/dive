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
* [Server Development Docs](server/README.md)
* [Deployment Overview](https://kitware.github.io/dive/Deployment-Overview/)
* [Running with Docker Compose](https://kitware.github.io/dive/Deployment-Docker-Compose/)

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


## Local Quickstart


### Prerequisites Ubuntu


```bash

# Dont use installs docker 1.25 on Ubuntu 21.04, not new enough 
# sudo apt install docker-compose

# Install 1.29 +
# https://docs.docker.com/compose/install/
sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
sudo ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose
docker-compose --version

```


https://kitware.github.io/dive/Deployment-Docker-Compose

```bash


git clone https://github.com/Kitware/dive 
cd dive/docker

cp .env.default .env

# Pull pre-built images
docker-compose pull

# Bring the services up (add -d CLI arg to run in the background)
docker-compose up 

docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# VIAME server will be running at http://localhost:8010. 
# You should see a page that looks like this. 
# The default username and password is admin:letmein.
```


### Restart server

docker-compose ps
docker-compose down 



### Documentation Wants:

* Installing a development instance on the local machine (in a way that ideally allows real-time hacking)

* If real-time hacking isn't a viable option, a quick guide on how to edit code
  and then see the changes on the local instance (to help new developers) would
be great.

* How to ingest a dataset (ideally you can either drag/drop a kwcoco file, a
  directory of images, a selection of images files), or point to it via a local
  path on the interface.



### Feature wants

* Without reading any of the documentation, it should be immediately obvious
  what button to click to upload a directory of images / kwcoco file / other
  common annotation format (that kwcoco could support conversion to/from),
  conversion between formats could be abstracted away from this repo.


### Questions / Notes

* Does the docker-compose up use the in-repo code (i.e. can I modify the local
  repo and expect things to change?)


* Ok, it wasnt too hard to figure out how to get a sequence of images in, but
  an immediately obvious button would be nice.


* It should also be immediately obvious how to add a box. I couldn't figure out
  why I wasn't in editing mode and why I couldn't draw a box.  I did figure out
  that I needed to add a track, but I think we can expedite that.


* Note: the viewer is super smooth, really good stuff. The interface feels very
  good, works perfectly with my kinds of data.


* Should be able to edit the category of a detection by simply clicking and
  typing in a new name. Should try to autocomplete from known names.


* The video play button should have a way of jumping to a frame index from text.
* The video play button button should have a to-start / to-end of video button.


* An shorter alternative to "Editing mode" might be referring to an annotation
  as "locked", similar to Photoshop layers. (Make the camera lock icon have a
  lock overlaid on a camera icon)

* Double clicking on an annotation (while not actively editing another
  annotation) should put me in edit mode for that annotation (or select it if
locked?)

* It was hard for me to figure out how to switch from line back to box-edit
  mode. Tried double clicking the box, but it didn't work. In addition to
  higlighting which editing mode you are in, it might be a good idea to allow
  them to be locked or not. If not locked and visible, when you double click on
  that type of annotation, it should put you in that editing mode.


* Unclear how to move a track forward in time.
