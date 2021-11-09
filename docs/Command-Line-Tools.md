# DIVE Command Line Tools

!!! note

    This page is **not related** to the VIAME command line (i.e. `kwiver`, `viame_train_detector`)

Some of the DIVE data conversion features are exposed through `dive`.  

## Features

* Convert between VIAME CSV, DIVE Json, and coco.
* Verify the integrity of a DIVE Json annotation file.

## Installation

``` bash
# Install the command line tools directly from source
pip3 install git+https://github.com/Kitware/dive.git@main#subdirectory=server
```

## Usage

``` bash
~$ dive convert --help

# Usage: dive convert [OPTIONS] COMMAND [ARGS]...

# Options:
#   --version  Show the version and exit.
#   --help     Show this message and exit.

# Commands:
#   coco2dive
#   dive2viame
#   viame2dive
```
