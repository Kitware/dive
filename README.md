![viame logo](http://www.viametoolkit.org/wp-content/uploads/2016/08/viami_logo.png)

## Demo

A sample instance of VIAME-Web is running on a public server at https://viame.kitware.com

## About

VIAME Web is a web interface for performing data management, video annotation, and running the algorithms stored within the VIAME (https://github.com/VIAME/VIAME) repository. When compiled, docker instances for VIAME-Web can either be run as local servers, or online in web services.

![Dark Girder](http://www.viametoolkit.org/wp-content/uploads/2019/11/girder-dark-example.png)
![Example Tracks](http://www.viametoolkit.org/wp-content/uploads/2019/11/viame-web-prelim.png)

Additional documentation will be forthcoming for users wanting to stand up their own servers.

## Data

### Input

ViameWeb takes two different kinds of clips, video file, and image sequences. Both kinds could be accompanied with a CSV file for annotation data.

### Output

The system saves to CSV file directly when the save button is pressed

## Architecture

VIAMEWeb has a typical girder + girder worker + docker architecture. Command-line executable VIAME and FFmpeg are built inside the worker docker image. See related docker scripts for detail

### Client

The client application is a standard [@vue/cli](https://cli.vuejs.org/) application. 

### Server

The Rest API server is a typical Girder3 plugin. Generally, it needs a running MongoDB instance, Python3, and a python environment, Run `pip install` on the against the server directory. Then `girder build`, `girder serve` to start the girder server. Refer to [Girder3 documentation](https://girder.readthedocs.io/en/stable/) and the included docker scripts for details.

### Worker

The processing server is a typical Girder worker tasks. Generally, it needs a running RabbitMQ instance. Python3, and a python environment. Run `pip install` on the against the server directory. Then `girder-worker -l info` to start girder worker. 

## Future work

* The VIAME work needs some work to make running all different pipeline possible. The client app would need a small update to support more pipelines.
* The client app loads all annotations for a clip at once, which wouldn't scale when the clip is long or has many annotations. One possible solution is load annotations by chunk, this will need more logic in code and might need server-side help for anything that is needed such as the timeline.
* Reading and saving directly to CSV will have performance impact for longer clips and can't support chunk load or provide server side help for client functionality.
* The video/image sequence playback and the timeline at the bottom are created meant to be composable and reusable. The ImageAnnotator and VideoAnnotator probably should inherit from the same base class as they share a lot of code.
* Currently, the upload need to upload each image separately via girder endpoint, which has a large overhead making uploading large image sequence slow

## Running Locally

You can run VIAME Web locally with vanilla docker-compose.

```bash
docker-compose -f docker/docker-compose.yml up
```

VIAME server will be running at http://localhost:8010/

## Development

Install https://github.com/subdavis/ldc

```bash
# copy .env.example and make any changes
cp .env.example .env

# bring the server up
ldc up

# replace a pre-built image with the development version
# for example, here's how to work on the girder server code
ldc dev girder

# stop all containers and remove their volumes
ldc clean
```

To work on the Vue client, see development instructions in `./client`.

## Sample data

https://viame.kitware.com/girder#collection/5e4c256ca0fc86aa03120c34/
