# DIVE Command Line Tools

!!! note

    This page is **not related** to the VIAME command line (i.e. `kwiver`, `viame_train_detector`)

Some of the DIVE data conversion features are exposed through `dive`.  

## Features

* Convert between VIAME CSV, DIVE Json, kpf, and coco.
* Verify the integrity of a DIVE Json annotation file.

## Installation

``` bash
# Install the command line tools directly from source
pip3 install git+https://github.com/Kitware/dive.git@main#subdirectory=server

# Install development requirements
pip3 install opencv-python
```

## Usage

Every command comes with help documentation.

``` bash
~$ dive convert --help

# Usage: dive convert [OPTIONS] COMMAND [ARGS]...

# Options:
#   --version  Show the version and exit.
#   --help     Show this message and exit.

# Commands:
#   coco2dive    COCO or KWCOCO json to DIVE json
#   dive2viame   DIVE json to VIAME CSV
#   kpf2dive     Kitware Packet Format (KPF) to DIVE json
#   vertex2dive  Google Vertex AI Video Object Tracking to DIVE json.
#   viame2dive   VIAME csv to DIVE json

~$ dive convert viame2dive --help

# Usage: dive convert viame2dive [OPTIONS] INPUT

#   VIAME csv to DIVE json

# Options:
#   --output FILENAME
#   --output-attrs FILENAME
#   --help                   Show this message and exit.
```
