
<img src="http://www.viametoolkit.org/wp-content/uploads/2016/08/viami_logo.png" alt="VIAME Logo" width="200" height="78">
<br>
VIAME Web is a web interface for performing data management, video annotation, and running the algorithms stored within
the VIAME (https://github.com/VIAME/VIAME) repository. When compiled, docker instances for VIAME-Web can be run either as
local servers or online in web services. A sample instance of VIAME-Web is running on a public server at https://viame.kitware.com.
additional documentation will be available in the future for users wanting to stand up their own servers.
<br>
<br>
<p align="center">
<br>
<nobr>
<img src="http://www.viametoolkit.org/wp-content/uploads/2019/11/girder-dark-example.png" alt="Dark Girder" width="320" height="200" border="1">
&nbsp;&nbsp;&nbsp;&nbsp;
<img src="http://www.viametoolkit.org/wp-content/uploads/2019/11/viame-web-prelim.png" alt="Example Tracks" width="320" height="200" border="1">
</nobr>
</p>
<br>

## Architecture

VIAME-Web uses [girder](https://girder.readthedocs.io/en/stable/) for data management and has a typical girder + girder worker +
docker architecture. Command-line executables for VIAME and FFmpeg are built inside the worker docker image. See docker scripts 
for additional details.

### Client

The client application is a standard [@vue/cli](https://cli.vuejs.org/) application. 

### Server

The Rest API server is a typical Girder3 plugin. Generally, it needs a running MongoDB instance, Python3, and a python environment,
Run `pip install` on the against the server directory. Then `girder build`, `girder serve` to start the girder server. Refer to
[Girder3 documentation](https://girder.readthedocs.io/en/stable/) and the included docker scripts for details.

### Worker

The processing server is a typical Girder worker tasks. Generally, it needs a running RabbitMQ instance. Python3, and a python environment.
Run `pip install` on the against the server directory. Then `girder-worker -l info` to start girder worker. 

## Running Locally

You can run VIAME Web locally with vanilla docker-compose.

```bash
docker-compose -f docker/docker-compose.yml up
```

VIAME server will be running at http://localhost:8010/

## Example Data

### Input

VIAME-Web takes two different kinds of optional input clips, either a video file (e.g. .mpg) or and image sequences. Both kinds can
be accompanied with a CSV file for annotation data. An example clip is available here:
https://viame.kitware.com/girder#collection/5e4c256ca0fc86aa03120c34/.

### Output

The system saves to CSV file directly when the save button is pressed

